import interestsService from "./interests.service.js";
import { NotificationsService } from "./notifications.service.js";
import { getIO } from "../../sockets/socketStore.js";

const CTA_SEND_GIFT = "send_gift";

const getAuthUserId = (req) =>
  Number(
    req.user?.id_usuario ||
      req.user?.id ||
      req.user?.user_id ||
      req.user?.id_cliente ||
      req.user?.sub
  ) || null;

const handleInterestError = (res, error) => {
  return res
    .status(error.statusCode || 500)
    .json({ error: error.message || "Error interno del servidor" });
};

const buildRealtimePayload = ({
  mutualInterest,
  userId,
  initiatorId,
  receiverId,
}) => ({
  id: mutualInterest.id,
  venue_id: mutualInterest.venue_id,
  level: mutualInterest.level,
  source_type: mutualInterest.source_type,
  source_id: mutualInterest.source_id,
  initiator_id: Number(initiatorId) || null,
  receiver_id: Number(receiverId) || null,
  other_user_id:
    Number(mutualInterest.user_a_id) === Number(userId)
      ? Number(mutualInterest.user_b_id)
      : Number(mutualInterest.user_a_id),
  cta: CTA_SEND_GIFT,
  created_at: mutualInterest.created_at,
});

const emitMutualInterestCreated = ({
  mutualInterest,
  initiatorId,
  receiverId,
}) => {
  const io = getIO();
  if (!io) return;

  const participantIds = [
    Number(mutualInterest.user_a_id),
    Number(mutualInterest.user_b_id),
  ].filter(Boolean);

  for (const userId of participantIds) {
    io.to(`user:${userId}`).emit(
      "mutual-interest:created",
      buildRealtimePayload({ mutualInterest, userId, initiatorId, receiverId })
    );
  }
};

const createStoryMutualNotification = async ({
  mutualInterest,
  actorId,
  authorId,
  initiatorId,
  receiverId,
  storyId,
}) => {
  const notification = await NotificationsService.createNotification({
    user_id: actorId,
    actor_id: authorId,
    venue_id: mutualInterest.venue_id,
    type: "story_interest_mutual",
    title: "🔥 Hay química",
    message: "El interés fue correspondido.",
    metadata: {
      initiator_id: initiatorId,
      receiver_id: receiverId,
      mutual_interest_id: mutualInterest.id,
      venue_id: mutualInterest.venue_id,
      story_id: storyId,
      other_user_id: authorId,
      level: "story_mutual",
      cta: CTA_SEND_GIFT,
    },
  });

  getIO()?.to(`user:${actorId}`).emit("notification:new", notification);
  return notification;
};

const profileMutualNotificationNeedsRepair = (notification, expected) => {
  const metadata = notification?.metadata || {};

  return (
    notification.title !== expected.title ||
    notification.message !== expected.message ||
    Number(metadata.mutual_interest_id) !== Number(expected.metadata.mutual_interest_id) ||
    Number(metadata.venue_id) !== Number(expected.metadata.venue_id) ||
    Number(metadata.other_user_id) !== Number(expected.metadata.other_user_id) ||
    metadata.other_user_name !== expected.metadata.other_user_name ||
    metadata.level !== expected.metadata.level ||
    metadata.cta !== expected.metadata.cta ||
    notification.is_read !== expected.is_read
  );
};

const ensureProfileMutualNotification = async ({
  mutualInterest,
  ownerUserId,
  actorUserId,
  actorName,
  isRead,
  emitWhenUnchanged = false,
}) => {
  const payload = {
    user_id: ownerUserId,
    actor_id: actorUserId,
    venue_id: mutualInterest.venue_id,
    type: "profile_interest_mutual",
    title: "Interés correspondido",
    message: `También le interesas a ${actorName}.`,
    is_read: isRead,
    metadata: {
      mutual_interest_id: mutualInterest.id,
      venue_id: mutualInterest.venue_id,
      other_user_id: actorUserId,
      other_user_name: actorName,
      level: "profile_mutual",
      cta: CTA_SEND_GIFT,
    },
  };

  const existingNotification = await NotificationsService.findNotification({
    user_id: ownerUserId,
    actor_id: actorUserId,
    type: "profile_interest_mutual",
    metadataContains: {
      mutual_interest_id: mutualInterest.id,
    },
  });

  let notification = existingNotification;
  let shouldEmit = emitWhenUnchanged;

  if (!existingNotification) {
    notification = await NotificationsService.createNotification(payload);
    shouldEmit = true;
  } else if (profileMutualNotificationNeedsRepair(existingNotification, payload)) {
    notification = await NotificationsService.updateNotification({
      id: existingNotification.id,
      title: payload.title,
      message: payload.message,
      metadata: {
        ...(existingNotification.metadata || {}),
        ...payload.metadata,
      },
      is_read: payload.is_read,
    });
    shouldEmit = true;
  }

  if (shouldEmit && notification) {
    const io = getIO();
    const room = `user:${ownerUserId}`;

    if (io) {
      io.to(room).emit("notification:new", notification);
    }
  }

  return notification;
};

export async function correspondStoryReaction(req, res) {
  try {
    const currentUserId = getAuthUserId(req);
    const storyId = Number(req.params.storyId);
    const actorId = Number(req.params.actorId);

    const result = await interestsService.correspondStoryReaction({
      story_id: storyId,
      actor_id: actorId,
      current_user_id: currentUserId,
    });

    let notification = null;

    if (result.created) {
      emitMutualInterestCreated({
        mutualInterest: result.mutual_interest,
        initiatorId: result.initiator_id,
        receiverId: result.receiver_id,
      });
      notification = await createStoryMutualNotification({
        mutualInterest: result.mutual_interest,
        actorId: result.actor_id,
        authorId: result.author_id,
        initiatorId: result.initiator_id,
        receiverId: result.receiver_id,
        storyId: result.story.id,
      });
    }

    return res.json({
      ok: true,
      mutual_interest: result.mutual_interest,
      initiator_id: result.initiator_id,
      receiver_id: result.receiver_id,
      cta: CTA_SEND_GIFT,
      notification,
    });
  } catch (error) {
    console.error("Error correspondStoryReaction:", error);
    return handleInterestError(res, error);
  }
}

export async function likeProfile(req, res) {
  try {
    const senderId = getAuthUserId(req);
    const { venue_id, receiver_id, photo_id = null } = req.body ?? {};

    const result = await interestsService.likeProfile({
      venue_id,
      sender_id: senderId,
      receiver_id,
      photo_id,
    });

    let notifications = [];

    if (result.mutual && result.created) {
      emitMutualInterestCreated({
        mutualInterest: result.mutual_interest,
        initiatorId: result.initiator_id,
        receiverId: result.receiver_id,
      });
    }

    if (result.mutual && (result.created || result.like_created)) {
      const firstLikerNotification = await ensureProfileMutualNotification({
        mutualInterest: result.mutual_interest,
        ownerUserId: result.first_liker_id,
        actorUserId: result.second_liker_id,
        actorName: result.second_liker_name,
        isRead: false,
        emitWhenUnchanged: true,
      });
      const secondLikerNotification = await ensureProfileMutualNotification({
        mutualInterest: result.mutual_interest,
        ownerUserId: result.second_liker_id,
        actorUserId: result.first_liker_id,
        actorName: result.first_liker_name,
        isRead: true,
        emitWhenUnchanged: true,
      });
      notifications = [firstLikerNotification, secondLikerNotification].filter(Boolean);
    }

    return res.status(201).json({
      ok: true,
      liked: result.liked,
      mutual: result.mutual,
      mutual_interest: result.mutual_interest ?? null,
      initiator_id: result.initiator_id ?? null,
      receiver_id: result.receiver_id ?? null,
      cta: result.mutual ? CTA_SEND_GIFT : null,
      notifications,
    });
  } catch (error) {
    console.error("Error likeProfile:", error);
    return handleInterestError(res, error);
  }
}

export async function unlikeProfile(req, res) {
  try {
    const senderId = getAuthUserId(req);
    const receiverId = Number(req.params.receiverId);
    const venueId = Number(req.query.venue_id);

    const result = await interestsService.unlikeProfile({
      venue_id: venueId,
      sender_id: senderId,
      receiver_id: receiverId,
    });

    return res.json(result);
  } catch (error) {
    console.error("Error unlikeProfile:", error);
    return handleInterestError(res, error);
  }
}

export async function getMutualInterests(req, res) {
  try {
    const userId = getAuthUserId(req);
    const venueId = Number(req.query.venue_id);

    const result = await interestsService.getMutualInterests({
      venue_id: venueId,
      user_id: userId,
    });

    return res.json(result);
  } catch (error) {
    console.error("Error getMutualInterests:", error);
    return handleInterestError(res, error);
  }
}

export async function getProfileLikeStatus(req, res) {
  try {
    const senderId = getAuthUserId(req);
    const venueId = Number(req.query.venue_id);
    const receiverId = Number(req.query.receiver_id);

    const result = await interestsService.getProfileLikeStatus({
      venue_id: venueId,
      sender_id: senderId,
      receiver_id: receiverId,
    });

    return res.json(result);
  } catch (error) {
    console.error("Error getProfileLikeStatus:", error);
    return handleInterestError(res, error);
  }
}
