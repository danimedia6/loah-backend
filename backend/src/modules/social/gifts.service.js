import supabase from "../../config/supabaseClient.js";

class GiftsService {


    async _validateActivePresence({ sender_id, receiver_id }) {
        console.log("[GIFT][VALIDATION] Iniciando validación", {
            sender_id,
            receiver_id,
        });

        const { data: presences, error } = await supabase
            .from("user_presence")
            .select("user_id, venue_id, last_heartbeat_at")
            .in("user_id", [sender_id, receiver_id]);

        if (error) {
            console.error("[GIFT][VALIDATION] Error consultando presencia:", error.message);
            throw new Error(error.message);
        }

        const senderPresence = (presences || []).find(
            (p) => Number(p.user_id) === Number(sender_id)
        );
        const receiverPresence = (presences || []).find(
            (p) => Number(p.user_id) === Number(receiver_id)
        );

        console.log("[GIFT][VALIDATION] Presencias encontradas:", {
            senderPresence,
            receiverPresence,
        });

        const nowMs = Date.now();
        const MAX_HEARTBEAT_AGE_MS = 5 * 60 * 1000;

        const isPresenceActive = (presence) => {
            if (!presence?.last_heartbeat_at) return false;
            const lastHeartbeatMs = new Date(presence.last_heartbeat_at).getTime();
            return nowMs - lastHeartbeatMs < MAX_HEARTBEAT_AGE_MS;
        };

        if (!senderPresence || !isPresenceActive(senderPresence)) {
            console.warn("[GIFT][VALIDATION] Sender no activo", senderPresence);
            throw new Error("El remitente no está activo en el venue");
        }

        if (!receiverPresence || !isPresenceActive(receiverPresence)) {
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
            venue_id: senderPresence.venue_id,
        });

        return {
            senderPresence,
            receiverPresence,
            venue_id: senderPresence.venue_id,
        };
    }

  // Remitente envía un obsequio — solo guarda en gifts, NO toca pedidos aún
  async sendGift({ story_id, sender_id, receiver_id, product_id }) {
  await this._validateActivePresence({ sender_id, receiver_id });
    // 1. Obtener datos del producto (snapshot)
    const { data: product, error: productError } = await supabase
      .from("productos")
      .select("id_producto, nombre, precio")
      .eq("id_producto", product_id)
      .single();

    if (productError || !product) throw new Error("Producto no encontrado");

    // 2. Verificar que no haya un gift pendiente del mismo sender a la misma historia
    const { data: existing } = await supabase
      .from("gifts")
      .select("id")
      .eq("story_id", story_id)
      .eq("sender_id", sender_id)
      .eq("status", "pending")
      .single();

    if (existing) throw new Error("Ya tienes un obsequio pendiente en esta historia");

    // 3. Crear el regalo en estado pending
    const { data, error } = await supabase
      .from("gifts")
      .insert({
        story_id,
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
    return data;
  }

  // Destinatario responde al obsequio
  async respondGift({ gift_id, receiver_id, response, message }) {
    // Validar que el gift pertenece a este receiver y está pending
    const { data: gift, error: giftError } = await supabase
      .from("gifts")
      .select("*")
      .eq("id", gift_id)
      .eq("receiver_id", receiver_id)
      .eq("status", "pending")
      .single();

    if (giftError || !gift) throw new Error("Obsequio no encontrado o ya respondido");

    const validResponses = ["accepted_anon", "accepted_id", "accepted_chat", "declined"];
    if (!validResponses.includes(response)) throw new Error("Respuesta inválida");

    // Actualizar status del gift
    const updatePayload = {
      status:       response,
      responded_at: new Date().toISOString(),
      ...(message ? { receiver_message: message } : {}),
    };

    await supabase.from("gifts").update(updatePayload).eq("id", gift_id);

    // Si aceptó (cualquier variante) → crear el pedido para el remitente
    if (response !== "declined") {
      await this._createGiftOrder(gift);
    }

    return { ok: true, status: response };
  }

  // Crea el pedido en nombre del remitente
  async _createGiftOrder(gift) {
    // Buscar si el sender tiene un pedido activo (no pagado) en el venue
    // Obtenemos el venue_id desde la historia
    const { data: story } = await supabase
      .from("stories")
      .select("venue_id")
      .eq("id", gift.story_id)
      .single();

    const venue_id = story?.venue_id;

    const { data: activePedido } = await supabase
      .from("pedidos")
      .select("id_pedido, items")
      .eq("id_cliente", gift.sender_id)
      .eq("pago", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (activePedido) {
      // Agregar el producto al pedido existente
      const items = Array.isArray(activePedido.items) ? activePedido.items : [];
      items.push({
        id_producto: gift.product_id,
        nombre:      gift.product_nombre,
        precio:      gift.product_precio,
        cantidad:    1,
        es_obsequio: true,
        gift_id:     gift.id,
      });

      const newTotal = items.reduce((acc, i) => acc + (i.precio * i.cantidad), 0);

      await supabase
        .from("pedidos")
        .update({ items, total: newTotal })
        .eq("id_pedido", activePedido.id_pedido);
    } else {
      // Crear pedido nuevo para el sender
      await supabase.from("pedidos").insert({
        id_cliente: String(gift.sender_id),
        ...(venue_id ? { venue_id } : {}),
        items: [{
          id_producto: gift.product_id,
          nombre:      gift.product_nombre,
          precio:      gift.product_precio,
          cantidad:    1,
          es_obsequio: true,
          gift_id:     gift.id,
        }],
        total:  gift.product_precio,
        estado: "pendiente",
        pago:   false,
      });
    }
  }

  // Obsequios pendientes para el receiver
  async getPendingGifts({ receiver_id }) {
    const { data, error } = await supabase
      .from("gifts")
      .select("id, story_id, sender_id, product_nombre, product_precio, created_at")
      .eq("receiver_id", receiver_id)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    if (!data?.length) return [];

    // Enriquecer con nombre del sender
    const senderIds = [...new Set(data.map(g => g.sender_id))];
    const { data: users } = await supabase
      .from("usuarios")
      .select("id_usuario, nombre")
      .in("id_usuario", senderIds);

    const usersById = new Map((users || []).map(u => [u.id_usuario, u]));

    return data.map(g => ({
      ...g,
      sender_nombre: usersById.get(g.sender_id)?.nombre ?? null,
      sender_foto:   usersById.get(g.sender_id)?.foto_url ?? null,
    }));
  }
}

export default new GiftsService();