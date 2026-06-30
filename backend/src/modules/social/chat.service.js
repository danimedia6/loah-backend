import supabase from "../../config/supabaseClient.js";
import safetyService from "./safety.service.js";

async function getSocialProfile(userId) {
  const { data, error } = await supabase
    .from("social_profiles")
    .select("allow_chat")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  return {
    allow_chat: data?.allow_chat ?? true,
  };
}

async function assertCanChat(userAId, userBId) {
  const [userAProfile, userBProfile] = await Promise.all([
    getSocialProfile(userAId),
    getSocialProfile(userBId),
  ]);

  if (!userAProfile.allow_chat || !userBProfile.allow_chat) {
    throw new Error("No se puede enviar el mensaje porque uno de los usuarios tiene el chat desactivado.");
  }

  return true;
}

class ChatService {
  async createConversationFromGift({ gift, firstMessage }) {
    await safetyService.assertCanInteract(gift.sender_id, gift.receiver_id);
    await assertCanChat(gift.sender_id, gift.receiver_id);

    const { data: story, error: storyError } = await supabase
        .from("stories")
        .select("venue_id")
        .eq("id", gift.story_id)
        .maybeSingle();

    if (storyError) throw new Error(storyError.message);

    const venue_id = story?.venue_id ?? null;

    const userA = Math.min(Number(gift.sender_id), Number(gift.receiver_id));
    const userB = Math.max(Number(gift.sender_id), Number(gift.receiver_id));

    // 1. Buscar conversación existente entre las dos personas, sin importar el venue
    const { data: existingConversations, error: existingError } = await supabase
    .from("conversations")
    .select("*")
    .eq("user_one_id", userA)
    .eq("user_two_id", userB)
    .order("updated_at", { ascending: false })
    .limit(1);

    if (existingError) throw new Error(existingError.message);

    let conversation = existingConversations?.[0] ?? null;

    // 2. Si no existe, crearla
    if (!conversation) {
        const { data: createdConversation, error: conversationError } = await supabase
        .from("conversations")
        .insert({
            gift_id: gift.id,
            venue_id,
            user_one_id: userA,
            user_two_id: userB,
        })
        .select()
        .single();

        if (conversationError) throw new Error(conversationError.message);

        conversation = createdConversation;
    }

    if (conversation) {
      const { error: updateConversationError } = await supabase
        .from("conversations")
        .update({
          gift_id: gift.id,
          venue_id: conversation.venue_id ?? venue_id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", conversation.id);

      if (updateConversationError) {
        throw new Error(updateConversationError.message);
      }
    }

    // 3. Insertar evento automático del gift
    const { error: giftMessageError } = await supabase
        .from("chat_messages")
        .insert({
        conversation_id: conversation.id,
        sender_id: gift.sender_id,
        message: `🎁 Envió un obsequio: ${gift.product_nombre}`,
        message_type: "gift_event",
        gift_id: gift.id,
        });

    if (giftMessageError) throw new Error(giftMessageError.message);

    // 4. Insertar mensaje inicial del receptor si existe
    if (firstMessage?.trim()) {
        const { error: messageError } = await supabase
        .from("chat_messages")
        .insert({
            conversation_id: conversation.id,
            sender_id: gift.receiver_id,
            message: firstMessage.trim(),
            message_type: "text",
        });

        if (messageError) throw new Error(messageError.message);
    }

    return conversation;
    }

    async getConversationsByUser({ user_id }) {
      const blockedRelations = await safetyService.getBlockedRelationsForUser(user_id);

      const blockedUserIds = new Set(
        blockedRelations.map((relation) =>
          Number(relation.blocker_id) === Number(user_id)
            ? Number(relation.blocked_id)
            : Number(relation.blocker_id)
        )
      );

      const { data, error } = await supabase
        .from("conversations")
        .select(`
          id,
          gift_id,
          venue_id,
          user_one_id,
          user_two_id,
          created_at,
          updated_at
        `)
        .or(`user_one_id.eq.${user_id},user_two_id.eq.${user_id}`)
        .order("updated_at", { ascending: false });

      if (error) throw new Error(error.message);
      if (!data?.length) return [];

      const visibleConversations = data.filter((conv) => {
        const otherUserId =
          Number(conv.user_one_id) === Number(user_id)
            ? Number(conv.user_two_id)
            : Number(conv.user_one_id);

        return !blockedUserIds.has(Number(otherUserId));
      });

      if (!visibleConversations.length) return [];

      const conversationIds = visibleConversations.map((c) => c.id);

      const otherUserIds = visibleConversations.map((conv) =>
        Number(conv.user_one_id) === Number(user_id)
          ? conv.user_two_id
          : conv.user_one_id
      );

      const { data: users, error: usersError } = await supabase
        .from("usuarios")
        .select("id_usuario, nombre")
        .in("id_usuario", otherUserIds);

      if (usersError) throw new Error(usersError.message);

      const { data: profiles, error: profilesError } = await supabase
        .from("social_profiles")
        .select("user_id, display_name, foto_url")
        .in("user_id", otherUserIds);

      if (profilesError) throw new Error(profilesError.message);

      const { data: messages, error: messagesError } = await supabase
        .from("chat_messages")
        .select("id, conversation_id, sender_id, message, created_at, read_at")
        .in("conversation_id", conversationIds)
        .order("created_at", { ascending: false });

      if (messagesError) throw new Error(messagesError.message);

      const usersById = new Map((users || []).map((u) => [Number(u.id_usuario), u]));

      const profilesByUserId = new Map(
        (profiles || []).map((profile) => [Number(profile.user_id), profile])
      );

      const lastMessageByConversation = new Map();
      const unreadCountByConversation = new Map();

      for (const msg of messages || []) {
        if (!lastMessageByConversation.has(msg.conversation_id)) {
          lastMessageByConversation.set(msg.conversation_id, msg);
        }

        const isUnreadForUser =
          Number(msg.sender_id) !== Number(user_id) && !msg.read_at;

        if (isUnreadForUser) {
          unreadCountByConversation.set(
            msg.conversation_id,
            (unreadCountByConversation.get(msg.conversation_id) || 0) + 1
          );
        }
      }

      return visibleConversations.map((conv) => {
        const otherUserId =
          Number(conv.user_one_id) === Number(user_id)
            ? Number(conv.user_two_id)
            : Number(conv.user_one_id);

        const otherUser = usersById.get(otherUserId);
        const otherProfile = profilesByUserId.get(Number(otherUserId));
        const lastMessage = lastMessageByConversation.get(conv.id);

        return {
          ...conv,
          other_user_id: otherUserId,
          other_user_nombre:
            otherProfile?.display_name || otherUser?.nombre || "Usuario",
          other_user_foto: otherProfile?.foto_url ?? null,
          is_blocked: false,

          last_message: lastMessage?.message ?? null,
          last_message_at: lastMessage?.created_at ?? conv.updated_at,
          last_message_sender_id: lastMessage?.sender_id ?? null,
          unread_count: unreadCountByConversation.get(conv.id) || 0,
        };
      });
    }

  async getMessages({ conversation_id, user_id }) {
    const conversation = await this._getConversationForUser({
      conversation_id,
      user_id,
    });

    const { data, error } = await supabase
      .from("chat_messages")
      .select("id, conversation_id, sender_id, message, created_at, read_at")
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: true });

    if (error) throw new Error(error.message);
    return data || [];
  }

  async sendMessage({ conversation_id, sender_id, message }) {
    if (!message?.trim()) {
      throw new Error("El mensaje no puede estar vacío");
    }

    const conversation = await this._getConversationForUser({
      conversation_id,
      user_id: sender_id,
    });

    const receiverId =
      Number(conversation.user_one_id) === Number(sender_id)
        ? Number(conversation.user_two_id)
        : Number(conversation.user_one_id);

    await safetyService.assertCanInteract(sender_id, receiverId);
    await assertCanChat(sender_id, receiverId);

    const { data, error } = await supabase
      .from("chat_messages")
      .insert({
        conversation_id,
        sender_id,
        message: message.trim(),
      })
      .select()
      .single();

    if (error) throw new Error(error.message);

    await supabase
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversation_id);

    return data;
  }

  async _getConversationForUser({ conversation_id, user_id }) {
    const { data, error } = await supabase
      .from("conversations")
      .select("*")
      .eq("id", conversation_id)
      .or(`user_one_id.eq.${user_id},user_two_id.eq.${user_id}`)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) throw new Error("Conversación no encontrada");

    return data;
  }

  async markMessagesAsRead({ conversation_id, user_id }) {
    await this._getConversationForUser({
        conversation_id,
        user_id,
    });

    const { error } = await supabase
        .from("chat_messages")
        .update({
        read_at: new Date().toISOString(),
        })
        .eq("conversation_id", conversation_id)
        .neq("sender_id", user_id)
        .is("read_at", null);

    if (error) throw new Error(error.message);

    return { ok: true };
    }
}

export default new ChatService();