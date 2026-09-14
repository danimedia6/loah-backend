import supabase from "../../config/supabaseClient.js";
import safetyService from "./safety.service.js";
import socialService from "./social.service.js";

const CTA_SEND_GIFT = "send_gift";

function normalizeId(value) {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function errorWithStatus(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizePair(userAId, userBId) {
  const a = Number(userAId);
  const b = Number(userBId);

  return {
    user_a_id: Math.min(a, b),
    user_b_id: Math.max(a, b),
  };
}

class InterestsService {
  async _assertUsersAvailable(userIds) {
    const uniqueUserIds = [...new Set(userIds.map(Number).filter(Boolean))];

    const { data, error } = await supabase
      .from("usuarios")
      .select("id_usuario, is_suspended")
      .in("id_usuario", uniqueUserIds);

    if (error) throw new Error(error.message);

    const usersById = new Map((data || []).map((user) => [Number(user.id_usuario), user]));

    for (const userId of uniqueUserIds) {
      const user = usersById.get(userId);

      if (!user) {
        throw errorWithStatus("Usuario no encontrado", 404);
      }

      if (user.is_suspended) {
        throw errorWithStatus("No puedes interactuar con este usuario", 403);
      }
    }
  }

  async _assertCanCreateInterest({ venue_id, user_a_id, user_b_id }) {
    const venueId = normalizeId(venue_id);
    const userAId = normalizeId(user_a_id);
    const userBId = normalizeId(user_b_id);

    if (!venueId) throw errorWithStatus("venue_id inválido");
    if (!userAId || !userBId) throw errorWithStatus("Usuarios inválidos");
    if (userAId === userBId) throw errorWithStatus("No puedes mostrar interés por ti mismo");

    await this._assertUsersAvailable([userAId, userBId]);
    await safetyService.assertCanInteract(userAId, userBId);

    const [userAPresence, userBPresence] = await Promise.all([
      socialService.getActivePresenceSession({
        user_id: userAId,
        venue_id: venueId,
      }),
      socialService.getActivePresenceSession({
        user_id: userBId,
        venue_id: venueId,
      }),
    ]);

    if (!userAPresence || !userBPresence) {
      throw errorWithStatus("Ambos usuarios deben estar presentes en el venue", 403);
    }

    return {
      venue_id: venueId,
      user_a_id: userAId,
      user_b_id: userBId,
    };
  }

  async _getPublicUserIdentity(user_id) {
    const userId = normalizeId(user_id);
    if (!userId) {
      return { name: "Alguien" };
    }

    const [{ data: profile, error: profileError }, { data: user, error: userError }] =
      await Promise.all([
        supabase
          .from("social_profiles")
          .select("display_name")
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
      name:
        profile?.display_name?.trim() ||
        user?.nombre?.trim() ||
        "Alguien",
    };
  }

  async _getMutualInterest({ venue_id, user_a_id, user_b_id, level }) {
    const pair = normalizePair(user_a_id, user_b_id);

    const { data, error } = await supabase
      .from("social_mutual_interests")
      .select("*")
      .eq("venue_id", venue_id)
      .eq("user_a_id", pair.user_a_id)
      .eq("user_b_id", pair.user_b_id)
      .eq("level", level)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data || null;
  }

  async _createOrGetMutualInterest({
    venue_id,
    user_a_id,
    user_b_id,
    level,
    source_type,
    source_id = null,
  }) {
    const existing = await this._getMutualInterest({
      venue_id,
      user_a_id,
      user_b_id,
      level,
    });

    if (existing) {
      return { mutual_interest: existing, created: false };
    }

    const pair = normalizePair(user_a_id, user_b_id);
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("social_mutual_interests")
      .insert({
        venue_id,
        user_a_id: pair.user_a_id,
        user_b_id: pair.user_b_id,
        level,
        source_type,
        source_id,
        created_at: now,
        updated_at: now,
      })
      .select("*")
      .single();

    if (error) {
      if (error.code === "23505") {
        const mutualInterest = await this._getMutualInterest({
          venue_id,
          user_a_id,
          user_b_id,
          level,
        });

        if (mutualInterest) {
          return { mutual_interest: mutualInterest, created: false };
        }
      }

      throw new Error(error.message);
    }

    return { mutual_interest: data, created: true };
  }

  async correspondStoryReaction({ story_id, actor_id, current_user_id }) {
    const storyId = normalizeId(story_id);
    const actorId = normalizeId(actor_id);
    const currentUserId = normalizeId(current_user_id);

    if (!storyId) throw errorWithStatus("story_id inválido");
    if (!actorId) throw errorWithStatus("actor_id inválido");
    if (!currentUserId) throw errorWithStatus("No autenticado", 401);
    if (actorId === currentUserId) {
      throw errorWithStatus("No puedes corresponderte a ti mismo");
    }

    const { data: story, error: storyError } = await supabase
      .from("stories")
      .select("id, user_id, venue_id, expires_at")
      .eq("id", storyId)
      .maybeSingle();

    if (storyError) throw new Error(storyError.message);
    if (!story) throw errorWithStatus("Historia no encontrada", 404);
    if (Number(story.user_id) !== currentUserId) {
      throw errorWithStatus("Solo el autor de la historia puede corresponder esta reacción", 403);
    }
    if (new Date(story.expires_at).getTime() <= Date.now()) {
      throw errorWithStatus("La historia ya expiró", 410);
    }

    const { data: reaction, error: reactionError } = await supabase
      .from("story_reactions")
      .select("id, story_id, user_id, reaction, created_at")
      .eq("story_id", storyId)
      .eq("user_id", actorId)
      .maybeSingle();

    if (reactionError) throw new Error(reactionError.message);
    if (!reaction) throw errorWithStatus("Reacción no encontrada", 404);

    await this._assertCanCreateInterest({
      venue_id: story.venue_id,
      user_a_id: actorId,
      user_b_id: currentUserId,
    });

    const result = await this._createOrGetMutualInterest({
      venue_id: Number(story.venue_id),
      user_a_id: actorId,
      user_b_id: currentUserId,
      level: "story_mutual",
      source_type: "story_reaction",
      source_id: reaction.id,
    });

    return {
      ok: true,
      ...result,
      story,
      actor_id: actorId,
      reactor_id: actorId,
      author_id: currentUserId,
      initiator_id: actorId,
      receiver_id: currentUserId,
      reaction,
      cta: CTA_SEND_GIFT,
    };
  }

  async likeProfile({ venue_id, sender_id, receiver_id, photo_id = null }) {
    const venueId = normalizeId(venue_id);
    const senderId = normalizeId(sender_id);
    const receiverId = normalizeId(receiver_id);

    if (!venueId) throw errorWithStatus("venue_id es requerido");
    if (!senderId) throw errorWithStatus("No autenticado", 401);
    if (!receiverId) throw errorWithStatus("receiver_id es requerido");
    if (senderId === receiverId) {
      throw errorWithStatus("No puedes mostrar interés por ti mismo");
    }

    if (photo_id !== undefined && photo_id !== null && String(photo_id).trim() !== "") {
      throw errorWithStatus("photo_id de galería aún no es soportado porque gallery_urls no tiene IDs verificables");
    }

    await this._assertCanCreateInterest({
      venue_id: venueId,
      user_a_id: senderId,
      user_b_id: receiverId,
    });

    let { data: like, error: likeError } = await supabase
      .from("social_profile_likes")
      .select("*")
      .eq("venue_id", venueId)
      .eq("sender_id", senderId)
      .eq("receiver_id", receiverId)
      .maybeSingle();

    if (likeError) throw new Error(likeError.message);

    let likeCreated = false;

    if (like) {
      const { data: updatedLike, error: updateError } = await supabase
        .from("social_profile_likes")
        .update({
          photo_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", like.id)
        .select("*")
        .single();

      if (updateError) throw new Error(updateError.message);
      like = updatedLike;
    } else {
      const { data: createdLike, error: insertError } = await supabase
        .from("social_profile_likes")
        .insert({
          venue_id: venueId,
          sender_id: senderId,
          receiver_id: receiverId,
          photo_id: null,
          updated_at: new Date().toISOString(),
        })
        .select("*")
        .single();

      if (insertError) throw new Error(insertError.message);
      like = createdLike;
      likeCreated = true;
    }

    const { data: reciprocalLike, error: reciprocalError } = await supabase
      .from("social_profile_likes")
      .select("*")
      .eq("venue_id", venueId)
      .eq("sender_id", receiverId)
      .eq("receiver_id", senderId)
      .maybeSingle();

    if (reciprocalError) throw new Error(reciprocalError.message);

    if (!reciprocalLike) {
      return {
        ok: true,
        liked: true,
        like,
        like_created: likeCreated,
        mutual: false,
        initiator_id: senderId,
        receiver_id: receiverId,
      };
    }

    const result = await this._createOrGetMutualInterest({
      venue_id: venueId,
      user_a_id: senderId,
      user_b_id: receiverId,
      level: "profile_mutual",
      source_type: "profile_like",
      source_id: like.id,
    });
    const [firstLikerIdentity, secondLikerIdentity] = await Promise.all([
      this._getPublicUserIdentity(Number(reciprocalLike.sender_id)),
      this._getPublicUserIdentity(senderId),
    ]);

    return {
      ok: true,
      liked: true,
      like,
      like_created: likeCreated,
      reciprocal_like: reciprocalLike,
      mutual: true,
      ...result,
      initiator_id: senderId,
      receiver_id: receiverId,
      first_liker_id: Number(reciprocalLike.sender_id),
      first_liker_name: firstLikerIdentity.name,
      second_liker_id: senderId,
      second_liker_name: secondLikerIdentity.name,
      cta: CTA_SEND_GIFT,
    };
  }

  async unlikeProfile({ venue_id, sender_id, receiver_id }) {
    const venueId = normalizeId(venue_id);
    const senderId = normalizeId(sender_id);
    const receiverId = normalizeId(receiver_id);

    if (!venueId) throw errorWithStatus("venue_id es requerido");
    if (!senderId) throw errorWithStatus("No autenticado", 401);
    if (!receiverId) throw errorWithStatus("receiver_id inválido");

    const { error } = await supabase
      .from("social_profile_likes")
      .delete()
      .eq("venue_id", venueId)
      .eq("sender_id", senderId)
      .eq("receiver_id", receiverId);

    if (error) throw new Error(error.message);

    return {
      ok: true,
      liked: false,
      mutual_unchanged: true,
    };
  }

  async getMutualInterests({ venue_id, user_id }) {
    const venueId = normalizeId(venue_id);
    const userId = normalizeId(user_id);

    if (!venueId) throw errorWithStatus("venue_id es requerido");
    if (!userId) throw errorWithStatus("No autenticado", 401);

    const { data, error } = await supabase
      .from("social_mutual_interests")
      .select("id, venue_id, user_a_id, user_b_id, level, source_type, source_id, created_at, updated_at")
      .eq("venue_id", venueId)
      .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
      .order("updated_at", { ascending: false });

    if (error) throw new Error(error.message);

    return (data || []).map((item) => ({
      id: item.id,
      venue_id: item.venue_id,
      other_user_id:
        Number(item.user_a_id) === userId
          ? Number(item.user_b_id)
          : Number(item.user_a_id),
      level: item.level,
      source_type: item.source_type,
      source_id: item.source_id,
      created_at: item.created_at,
      updated_at: item.updated_at,
    }));
  }

  async getProfileLikeStatus({ venue_id, sender_id, receiver_id }) {
    const venueId = normalizeId(venue_id);
    const senderId = normalizeId(sender_id);
    const receiverId = normalizeId(receiver_id);

    if (!venueId) throw errorWithStatus("venue_id es requerido");
    if (!senderId) throw errorWithStatus("No autenticado", 401);
    if (!receiverId) throw errorWithStatus("receiver_id es requerido");

    const [{ data: like, error: likeError }, mutualInterest] = await Promise.all([
      supabase
        .from("social_profile_likes")
        .select("*")
        .eq("venue_id", venueId)
        .eq("sender_id", senderId)
        .eq("receiver_id", receiverId)
        .maybeSingle(),
      this._getMutualInterest({
        venue_id: venueId,
        user_a_id: senderId,
        user_b_id: receiverId,
        level: "profile_mutual",
      }),
    ]);

    if (likeError) throw new Error(likeError.message);

    return {
      ok: true,
      liked: Boolean(like),
      like: like || null,
      mutual: Boolean(mutualInterest),
      mutual_interest: mutualInterest,
      cta: mutualInterest ? CTA_SEND_GIFT : null,
    };
  }
}

export default new InterestsService();
