import crypto from "crypto";
import supabase from "../../config/supabaseClient.js";
import chatService from "./chat.service.js";
import safetyService from "./safety.service.js";
import socialService from "./social.service.js";
import { NotificationsService } from "./notifications.service.js";
import { getSocketInstance } from "../../sockets/socketInstance.js";

async function getSocialProfile(userId) {
  const { data, error } = await supabase
    .from("social_profiles")
    .select("allow_gifts, allow_chat")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  return {
    allow_gifts: data?.allow_gifts ?? true,
    allow_chat: data?.allow_chat ?? true,
  };
}

async function getGiftActorIdentity(userId) {
  const [{ data: profile, error: profileError }, { data: user, error: userError }] =
    await Promise.all([
      supabase
        .from("social_profiles")
        .select("display_name, foto_url, avatar_url")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("usuarios")
        .select("nombre")
        .eq("id_usuario", userId)
        .maybeSingle(),
    ]);

  if (profileError) throw new Error(profileError.message);
  if (userError) throw new Error(userError.message);

  return {
    actor_name: profile?.display_name?.trim() || user?.nombre?.trim() || "Alguien",
    actor_photo: profile?.foto_url || profile?.avatar_url || null,
  };
}

class GiftsService {


    async _resolveGiftVenue({ story_id = null, venue_id = null, receiver_id }) {
        if (story_id) {
            const { data: story, error: storyError } = await supabase
                .from("stories")
                .select("id, user_id, venue_id")
                .eq("id", story_id)
                .single();

            if (storyError || !story?.venue_id) {
                console.error("[GIFT][VALIDATION] Error resolviendo venue de historia:", storyError?.message);
                throw new Error("No se pudo resolver el venue de la historia");
            }

            if (venue_id && Number(venue_id) !== Number(story.venue_id)) {
                throw new Error("venue_id no coincide con el venue de la historia");
            }

            if (receiver_id && Number(receiver_id) !== Number(story.user_id)) {
                throw new Error("El destinatario no coincide con el propietario de la historia");
            }

            return {
                story,
                story_id: Number(story_id),
                venue_id: Number(story.venue_id),
            };
        }

        const venueId = Number(venue_id);
        if (!venueId) {
            throw new Error("venue_id es requerido para regalos desde tarjeta");
        }

        const { data: venue, error: venueError } = await supabase
            .from("venues")
            .select("id")
            .eq("id", venueId)
            .single();

        if (venueError || !venue) {
            throw new Error("Venue no encontrado");
        }

        return {
            story: null,
            story_id: null,
            venue_id: venueId,
        };
    }

    async _validateActivePresence({ venue_id, sender_id, receiver_id }) {
        console.log("[GIFT][VALIDATION] Iniciando validación", {
            venue_id,
            sender_id,
            receiver_id,
        });

        const [senderPresence, receiverPresence] = await Promise.all([
            socialService.getActivePresenceSession({
                user_id: sender_id,
                venue_id,
            }),
            socialService.getActivePresenceSession({
                user_id: receiver_id,
                venue_id,
            }),
        ]);

        console.log("[GIFT][VALIDATION] Presencias encontradas:", {
            senderPresence,
            receiverPresence,
            venue_id,
        });

        if (!senderPresence) {
            console.warn("[GIFT][VALIDATION] Sender no activo", senderPresence);
            throw new Error("El remitente no está activo en el venue");
        }

        if (!receiverPresence) {
            console.warn("[GIFT][VALIDATION] Receiver no activo", receiverPresence);
            throw new Error("El destinatario no está activo en el venue");
        }

        if (Number(senderPresence.venue_id) !== Number(receiverPresence.venue_id)) {
            console.warn("[GIFT][VALIDATION] Venue mismatch", {
            senderVenue: senderPresence.venue_id,
            receiverVenue: receiverPresence.venue_id,
            });
            throw new Error("Ambos usuarios deben estar en el mismo lugar para enviar obsequios");
        }

        console.log("[GIFT][VALIDATION] ✅ Validación exitosa", {
            venue_id,
        });

        return {
            senderPresence,
            receiverPresence,
            venue_id,
        };
    }

  // Remitente envía un obsequio — solo guarda en gifts, NO toca pedidos aún
  async sendGift({ story_id = null, venue_id = null, sender_id, receiver_id, product_id }) {
    await safetyService.assertCanInteract(sender_id, receiver_id);

    const receiverProfile = await getSocialProfile(receiver_id);

    if (!receiverProfile.allow_gifts) {
      throw new Error("Este usuario no está recibiendo obsequios.");
    }

    const giftContext = await this._resolveGiftVenue({
      story_id,
      venue_id,
      receiver_id,
    });

    const presenceContext = await this._validateActivePresence({
      venue_id: giftContext.venue_id,
      sender_id,
      receiver_id,
    });

    const { data: product, error: productError } = await supabase
      .from("productos")
      .select("id_producto, nombre, precio, disponible, venue_id")
      .eq("id_producto", product_id)
      .single();

    if (productError || !product) throw new Error("Producto no encontrado");
    if (product.disponible === false) throw new Error("Producto no disponible");
    if (Number(product.venue_id) !== Number(giftContext.venue_id)) {
      throw new Error("El producto no pertenece al venue seleccionado");
    }

    let existingQuery = supabase
      .from("gifts")
      .select("id")
      .eq("sender_id", sender_id)
      .eq("status", "pending");

    if (giftContext.story_id) {
      existingQuery = existingQuery.eq("story_id", giftContext.story_id);
    } else {
      const duplicateWindowStart = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      existingQuery = existingQuery
        .is("story_id", null)
        .eq("receiver_id", receiver_id)
        .eq("product_id", product_id)
        .eq("venue_id", giftContext.venue_id)
        .gte("created_at", duplicateWindowStart);
    }

    const { data: existingRows, error: existingError } = await existingQuery.limit(1);
    const existing = existingRows?.[0] ?? null;

    if (existingError) throw new Error(existingError.message);
    if (existing) {
      throw new Error(
        giftContext.story_id
          ? "Ya tienes un obsequio pendiente en esta historia"
          : "Ya enviaste este obsequio recientemente"
      );
    }

    const { data, error } = await supabase
      .from("gifts")
      .insert({
        story_id: giftContext.story_id,
        venue_id: giftContext.venue_id,
        sender_id,
        receiver_id,
        product_id,
        product_nombre: product.nombre,
        product_precio: product.precio,
        status: "pending",
      })
      .select()
      .single();

    if (error) throw new Error(error.message);

    const senderIdentity = await getGiftActorIdentity(sender_id);

    const notification = await NotificationsService.createNotification({
      user_id: receiver_id,
      actor_id: sender_id,
      venue_id: presenceContext.venue_id,
      type: "gift_received",
      title: "Nuevo obsequio",
      message: `Te enviaron un ${product.nombre}.`,
      metadata: {
        gift_id: data.id,
        product_id,
        product_nombre: product.nombre,
        product_name: product.nombre,
        response: null,
        ...senderIdentity,
        venue_id: giftContext.venue_id,
        sender_id,
        receiver_id,
        story_id: giftContext.story_id,
      },
    });

    const io = getSocketInstance();

    if (io) {
      io.to(`user:${receiver_id}`).emit("notification:new", notification);
      io.to(`user:${receiver_id}`).emit("gift:created", data);
    }

    return data;
  }

  // Destinatario responde al obsequio
  
  async respondGift({ gift_id, receiver_id, response, message }) {
    const cleanMessage = typeof message === "string" ? message.trim() : "";

    console.log("[GIFT] respondGift input:", {
      gift_id,
      receiver_id,
      response,
      message: cleanMessage || null,
    });

    const validResponses = ["accepted_anon", "accepted_id", "accepted_chat", "declined"];
    if (!validResponses.includes(response)) {
      throw new Error("Respuesta inválida");
    }

    const { data: gift, error: giftError } = await supabase
      .from("gifts")
      .select("*")
      .eq("id", gift_id)
      .eq("receiver_id", receiver_id)
      .eq("status", "pending")
      .single();

    if (giftError || !gift) {
      throw new Error("Obsequio no encontrado o ya respondido");
    }

    let redeemToken = null;
    let redeemExpiresAt = null;

    if (response !== "declined") {
      redeemToken = crypto.randomUUID();
      redeemExpiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
    }

    let conversation = null;

    if (response !== "declined") {
      // 🔹 Si es chat → crear conversación
      if (response === "accepted_chat") {
        await safetyService.assertCanInteract(gift.sender_id, gift.receiver_id);

        const [senderProfile, receiverProfile] = await Promise.all([
          getSocialProfile(gift.sender_id),
          getSocialProfile(gift.receiver_id),
        ]);

        if (!senderProfile.allow_chat || !receiverProfile.allow_chat) {
          throw new Error("Uno de los usuarios tiene el chat desactivado.");
        }

        conversation = await chatService.createConversationFromGift({
          gift,
          firstMessage: cleanMessage,
        });

        // guardar relación en gift
        await supabase
          .from("gifts")
          .update({ conversation_id: conversation.id })
          .eq("id", gift.id);
      }

      // 🔹 (por ahora dejamos esto comentado si ya migraste a QR)
      // await this._createGiftOrder(gift);
    }

    const updatePayload = {
      status: response,
      responded_at: new Date().toISOString(),
      ...(cleanMessage ? { receiver_message: cleanMessage } : {}),
      ...(redeemToken ? { redeem_token: redeemToken } : {}),
      ...(redeemExpiresAt ? { redeem_expires_at: redeemExpiresAt.toISOString() } : {}),
    };

    const { error: updateError } = await supabase
      .from("gifts")
      .update(updatePayload)
      .eq("id", gift_id);

    if (updateError) {
      console.error("[GIFT] Error actualizando estado del gift:", updateError);
      throw new Error(updateError.message);
    }

    
    let notification = null;

    if (response === "declined") {
      notification = await NotificationsService.createNotification({
        user_id: gift.sender_id,
        actor_id: null,
        type: "gift_responded",
        title: "Lo sentimos",
        message: "Tu obsequio no fue aceptado.",
        metadata: {
          gift_id: gift.id,
          product_name: gift.product_nombre,
          response: "declined",
          venue_id: gift.venue_id ?? null,
          sender_id: gift.sender_id,
          receiver_id: gift.receiver_id,
        },
      });
    } else {
      const receiverIdentity = await getGiftActorIdentity(gift.receiver_id);
      const isAcceptedChat = response === "accepted_chat";
      const notificationTitle = isAcceptedChat
        ? "Obsequio aceptado 💬"
        : "Obsequio aceptado";
      const notificationMessage = isAcceptedChat
        ? `${receiverIdentity.actor_name} aceptó tu obsequio y te respondió. Toca para abrir el chat.`
        : response === "accepted_id"
        ? `${receiverIdentity.actor_name} aceptó tu obsequio.`
        : cleanMessage
        ? `${receiverIdentity.actor_name} aceptó tu obsequio: ${cleanMessage}`
        : `${receiverIdentity.actor_name} aceptó tu obsequio.`;

      notification = await NotificationsService.createNotification({
        user_id: gift.sender_id,
        actor_id: gift.receiver_id,
        type: "gift_responded",
        title: notificationTitle,
        message: notificationMessage,
        metadata: {
          gift_id: gift.id,
          product_name: gift.product_nombre,
          response,
          ...receiverIdentity,
          venue_id: gift.venue_id ?? null,
          sender_id: gift.sender_id,
          receiver_id: gift.receiver_id,
          message: cleanMessage || null,
          conversation_id: conversation?.id ?? null,
        },
      });
    }

    return {
      ok: true,
      gift_id: gift.id,
      sender_id: gift.sender_id,
      receiver_id: gift.receiver_id,
      venue_id: gift.venue_id ?? null,
      response,
      message: cleanMessage || null,
      status: response,
      redeem_token: redeemToken,
      redeem_expires_at: redeemExpiresAt?.toISOString() ?? null,
      conversation_id: conversation?.id ?? null,
      notification,
    };
  }

  // Crea el pedido en nombre del remitente
  async _createGiftOrder(gift) {
    let venue_id = gift.venue_id ? Number(gift.venue_id) : null;

    if (!venue_id && gift.story_id) {
      const { data: story, error: storyError } = await supabase
        .from("stories")
        .select("venue_id")
        .eq("id", gift.story_id)
        .single();

      if (storyError || !story) {
        console.error("[GIFT] Error resolviendo story para pedido:", storyError);
        throw new Error("No se pudo resolver el venue de la historia");
      }

      venue_id = story.venue_id;
    }

    if (!venue_id) {
      throw new Error("No se pudo resolver el venue del obsequio");
    }

    console.log("[GIFT] venue_id resuelto para pedido:", venue_id);

    const { data: activePedido, error: activePedidoError } = await supabase
      .from("pedidos")
      .select("id_pedido, items, total")
      .eq("id_cliente", String(gift.sender_id))
      .eq("pago", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activePedidoError) {
      console.error("[GIFT] Error buscando pedido activo:", activePedidoError);
      throw new Error(activePedidoError.message);
    }

    console.log("[GIFT] pedido activo encontrado:", activePedido);

    if (activePedido) {
      console.log("[GIFT] actualizando pedido existente con gift:", {
        pedido_id: activePedido.id_pedido,
        items_antes: activePedido.items,
      });

      const items = Array.isArray(activePedido.items) ? [...activePedido.items] : [];

      items.push({
        id_producto: gift.product_id,
        nombre: gift.product_nombre,
        precio: Number(gift.product_precio || 0),
        cantidad: 1,
        es_obsequio: true,
        gift_id: gift.id,
      });

      const newTotal = items.reduce(
        (acc, i) => acc + Number(i.precio || 0) * Number(i.cantidad || 1),
        0
      );

      const { error: updateError } = await supabase
        .from("pedidos")
        .update({
          items,
          total: newTotal,
        })
        .eq("id_pedido", activePedido.id_pedido);

      if (updateError) {
        console.error("[GIFT] Error actualizando pedido:", updateError);
        throw new Error(updateError.message);
      }

      console.log("[GIFT] pedido actualizado correctamente:", {
        pedido_id: activePedido.id_pedido,
        total: newTotal,
      });
    } else {
      console.log("[GIFT] creando pedido nuevo para sender:", {
        id_cliente: String(gift.sender_id),
        venue_id,
        product_id: gift.product_id,
      });

      const { error: insertError } = await supabase
        .from("pedidos")
        .insert({
          id_cliente: String(gift.sender_id),
          venue_id,
          items: [
            {
              id_producto: gift.product_id,
              nombre: gift.product_nombre,
              precio: Number(gift.product_precio || 0),
              cantidad: 1,
              es_obsequio: true,
              gift_id: gift.id,
            },
          ],
          total: Number(gift.product_precio || 0),
          estado: "pendiente",
          pago: false,
        });

      if (insertError) {
        console.error("[GIFT] Error creando pedido nuevo:", insertError);
        throw new Error(insertError.message);
      }

      console.log("[GIFT] pedido nuevo creado correctamente");
    }
  }

  // Obsequios pendientes para el receiver
  async getPendingGifts({ receiver_id }) {
    const nowIso = new Date().toISOString();

    const { data, error } = await supabase
      .from("gifts")
      .select(`
        id,
        story_id,
        sender_id,
        product_nombre,
        product_precio,
        status,
        receiver_message,
        venue_id,
        redeem_token,
        redeem_expires_at,
        redeemed_at,
        created_at,
        responded_at
      `)
      .eq("receiver_id", receiver_id)
      .or(
        `status.eq.pending,and(status.in.(accepted_anon,accepted_id,accepted_chat),redeem_expires_at.gt.${nowIso})`
      )
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    if (!data?.length) return [];

    const senderIds = [...new Set(data.map(g => g.sender_id))];

    const [{ data: users }, { data: profiles }] = await Promise.all([
      supabase
        .from("usuarios")
        .select("id_usuario, nombre")
        .in("id_usuario", senderIds),
      supabase
        .from("social_profiles")
        .select("user_id, display_name, foto_url, avatar_url")
        .in("user_id", senderIds),
    ]);

    const usersById = new Map((users || []).map(u => [u.id_usuario, u]));
    const profilesById = new Map((profiles || []).map(p => [p.user_id, p]));

    return data.map(g => ({
      ...g,
      sender_nombre:
        profilesById.get(g.sender_id)?.display_name?.trim() ||
        usersById.get(g.sender_id)?.nombre?.trim() ||
        "Alguien",
      sender_foto:
        profilesById.get(g.sender_id)?.foto_url ||
        profilesById.get(g.sender_id)?.avatar_url ||
        null,
    }));
  }
 
  async getRedeemGiftByToken({ token }) {
    const { data: gift, error } = await supabase
      .from("gifts")
      .select(`
        id,
        sender_id,
        receiver_id,
        product_nombre,
        product_precio,
        status,
        redeem_token,
        redeem_expires_at,
        redeemed_at,
        redeemed_by,
        created_at,
        responded_at
      `)
      .eq("redeem_token", token)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!gift) throw new Error("Código de canje no encontrado");

    const now = new Date();
    const expiresAt = gift.redeem_expires_at
      ? new Date(gift.redeem_expires_at)
      : null;

    const isExpired = expiresAt ? expiresAt < now : true;
    const isRedeemed = Boolean(gift.redeemed_at);
    const isRedeemable =
      ["accepted_anon", "accepted_id", "accepted_chat"].includes(gift.status) &&
      !isExpired &&
      !isRedeemed;

    return {
      ...gift,
      isExpired,
      isRedeemed,
      isRedeemable,
    };
  }

  async redeemGiftByToken({ token, admin_id }) {
    const gift = await this.getRedeemGiftByToken({ token });

    if (!gift.isRedeemable) {
      throw new Error("Este obsequio no está disponible para redimir");
    }

    const { data, error } = await supabase
      .from("gifts")
      .update({
        status: "redeemed",
        redemption_status: "redeemed",
        redeemed_at: new Date().toISOString(),
        redeemed_by: admin_id,
      })
      .eq("redeem_token", token)
      .is("redeemed_at", null)
      .select()
      .single();

    if (error) throw new Error(error.message);

    const productName = data.product_nombre || "obsequio";
    const notification = await NotificationsService.createNotification({
      user_id: data.receiver_id,
      actor_id: admin_id,
      type: "gift_redeemed",
      title: "Obsequio redimido",
      message: `Tu obsequio ${productName} fue redimido correctamente.`,
      metadata: {
        gift_id: data.id,
        product_name: productName,
        redeemed_at: data.redeemed_at,
      },
    });

    const io = getSocketInstance();
    io?.to(`user:${data.receiver_id}`).emit("notification:new", notification);

    return {
      ok: true,
      gift: data,
    };
  }

}

export default new GiftsService();
