import supabase from "../../config/supabaseClient.js";

function normalizeId(value) {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

class SafetyService {
  async blockUser({
    blocker_id,
    blocked_id,
    reason = null,
    visibility_mode = "contact_only",
    }) {
    const blockerId = normalizeId(blocker_id);
    const blockedId = normalizeId(blocked_id);

    if (!blockerId) throw new Error("Usuario autenticado inválido");
    if (!blockedId) throw new Error("Usuario a bloquear inválido");
    if (blockerId === blockedId) throw new Error("No puedes bloquearte a ti mismo");

    console.log("[safety block:service payload]", {
      blocker_id,
      blocked_id,
      reason,
      visibility_mode,
    });

    const blockPayload = {
      blocker_id: blockerId,
      blocked_id: blockedId,
      reason,
      visibility_mode,
      updated_at: new Date().toISOString(),
    };

    console.log("[safety block:persist payload]", blockPayload);

    const { data, error } = await supabase
      .from("social_user_blocks")
      .upsert(
        blockPayload,
        { onConflict: "blocker_id,blocked_id" }
      )
      .select()
      .single();

    if (error) throw new Error(error.message);

    return data;
  }

  async unblockUser({ blocker_id, blocked_id }) {
    const blockerId = normalizeId(blocker_id);
    const blockedId = normalizeId(blocked_id);

    if (!blockerId) throw new Error("Usuario autenticado inválido");
    if (!blockedId) throw new Error("Usuario a desbloquear inválido");

    const { error } = await supabase
      .from("social_user_blocks")
      .delete()
      .eq("blocker_id", blockerId)
      .eq("blocked_id", blockedId);

    if (error) throw new Error(error.message);

    return { ok: true };
  }

  async getBlockedUserIds(user_id) {
    const userId = normalizeId(user_id);
    if (!userId) return [];

    const { data, error } = await supabase
      .from("social_user_blocks")
      .select("blocked_id")
      .eq("blocker_id", userId);

    if (error) throw new Error(error.message);

    return (data || []).map((row) => Number(row.blocked_id));
  }

  async getBlockedRelationsForUser(user_id) {
    const userId = normalizeId(user_id);
    if (!userId) return [];

    const { data, error } = await supabase
      .from("social_user_blocks")
      .select("blocker_id, blocked_id, visibility_mode")
      .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`);

    if (error) throw new Error(error.message);

    return data || [];
  }

  async getHiddenUserIdsForViewer(user_id) {
    const userId = normalizeId(user_id);
    if (!userId) {
      console.log("[hidden debug:stored-blocks]", {
        userId,
        allBlocksForViewer: [],
      });
      console.log("[hidden debug:safety]", {
        user_id,
        rows: [],
        hiddenIds: [],
      });
      return [];
    }

    const { data, error } = await supabase
      .from("social_user_blocks")
      .select(`
        id,
        blocker_id,
        blocked_id,
        reason,
        visibility_mode,
        created_at
      `)
      .eq("blocker_id", userId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    const allBlocksForViewer = data || [];
    const hiddenRows = allBlocksForViewer.filter(
      (row) => String(row.visibility_mode || "").trim().toLowerCase() === "hidden"
    );
    const hiddenIds = hiddenRows.map((row) => Number(row.blocked_id));

    console.log("[hidden debug:stored-blocks]", {
      userId,
      allBlocksForViewer,
    });

    console.log("[hidden debug:safety]", {
      user_id,
      rows: hiddenRows,
      hiddenIds,
    });

    return hiddenIds;
  }

  async getBlockRelationship(user_a_id, user_b_id) {
    const userAId = normalizeId(user_a_id);
    const userBId = normalizeId(user_b_id);

    if (!userAId || !userBId) return null;

    const { data, error } = await supabase
        .from("social_user_blocks")
        .select("*")
        .or(
        `and(blocker_id.eq.${userAId},blocked_id.eq.${userBId}),and(blocker_id.eq.${userBId},blocked_id.eq.${userAId})`
        )
        .limit(1)
        .maybeSingle();

    if (error) throw new Error(error.message);

    return data || null;
    }

  async isContactBlocked(user_a_id, user_b_id) {
    const relationship = await this.getBlockRelationship(
        user_a_id,
        user_b_id
    );

        if (!relationship) return false;

        return [
            "contact_only",
            "hidden",
            "emergency",
        ].includes(relationship.visibility_mode);
        }


  async isHiddenBlocked(user_a_id, user_b_id) {
    const relationship = await this.getBlockRelationship(
        user_a_id,
        user_b_id
    );

    if (!relationship) return false;

    return [
        "hidden",
        "emergency",
    ].includes(relationship.visibility_mode);
    }

  async isBlockedBetween(user_a_id, user_b_id) {
    const userAId = normalizeId(user_a_id);
    const userBId = normalizeId(user_b_id);

    if (!userAId || !userBId) return false;
    if (userAId === userBId) return false;

    const { data, error } = await supabase
      .from("social_user_blocks")
      .select("id")
      .or(
        `and(blocker_id.eq.${userAId},blocked_id.eq.${userBId}),and(blocker_id.eq.${userBId},blocked_id.eq.${userAId})`
      )
      .limit(1);

    if (error) throw new Error(error.message);

    return Boolean(data?.length);
  }

  async assertCanInteract(user_a_id, user_b_id) {
    const blocked = await this.isContactBlocked(
        user_a_id,
        user_b_id
    );

    if (blocked) {
        throw new Error("No puedes interactuar con este usuario");
    }

    return true;
    }


  async getBlocksByUser(user_id) {
    const userId = normalizeId(user_id);
    if (!userId) throw new Error("Usuario autenticado inválido");

    const { data, error } = await supabase
      .from("social_user_blocks")
      .select(`
        id,
        blocker_id,
        blocked_id,
        reason,
        visibility_mode,
        created_at,
        usuarios:blocked_id (
          id_usuario,
          nombre
        )
      `)
      .eq("blocker_id", userId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    return (data || []).map((row) => ({
      id: row.id,
      blocked_id: row.blocked_id,
      reason: row.reason,
      visibility_mode: row.visibility_mode,
      created_at: row.created_at,
      nombre: row.usuarios?.nombre ?? "Usuario",
    }));
  }


  async reportProfile({
    reporter_id,
    reported_user_id,
    reason,
    description = null,
  }) {
    const reporterId = normalizeId(reporter_id);
    const reportedUserId = normalizeId(reported_user_id);

    if (!reporterId) throw new Error("Usuario autenticado inválido");
    if (!reportedUserId) throw new Error("Usuario reportado inválido");
    if (reporterId === reportedUserId) throw new Error("No puedes reportarte a ti mismo");
    if (!reason?.trim()) throw new Error("La razón del reporte es obligatoria");

    const { data, error } = await supabase
      .from("social_reports")
      .insert({
        reporter_id: reporterId,
        reported_user_id: reportedUserId,
        target_type: "profile",
        target_id: reportedUserId,
        reason: reason.trim(),
        description: description?.trim() || null,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);

    return data;
  }

  async reportMessage({
    reporter_id,
    message_id,
    reason,
    description = null,
  }) {
    const reporterId = normalizeId(reporter_id);
    const messageId = normalizeId(message_id);

    if (!reporterId) throw new Error("Usuario autenticado inválido");
    if (!messageId) throw new Error("Mensaje reportado inválido");
    if (!reason?.trim()) throw new Error("La razón del reporte es obligatoria");

    const { data: message, error: messageError } = await supabase
      .from("chat_messages")
      .select("id, sender_id, conversation_id")
      .eq("id", messageId)
      .maybeSingle();

    if (messageError) throw new Error(messageError.message);
    if (!message) throw new Error("Mensaje no encontrado");

    if (Number(message.sender_id) === reporterId) {
      throw new Error("No puedes reportar tu propio mensaje");
    }

    const { data: conversation, error: conversationError } = await supabase
      .from("conversations")
      .select("id, user_one_id, user_two_id")
      .eq("id", message.conversation_id)
      .maybeSingle();

    if (conversationError) throw new Error(conversationError.message);
    if (!conversation) throw new Error("Conversación no encontrada");

    const belongsToConversation =
      Number(conversation.user_one_id) === reporterId ||
      Number(conversation.user_two_id) === reporterId;

    if (!belongsToConversation) {
      throw new Error("No puedes reportar un mensaje de una conversación ajena");
    }

    const { data, error } = await supabase
      .from("social_reports")
      .insert({
        reporter_id: reporterId,
        reported_user_id: Number(message.sender_id),
        target_type: "message",
        target_id: messageId,
        reason: reason.trim(),
        description: description?.trim() || null,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);

    return data;
  }
}

export default new SafetyService();
