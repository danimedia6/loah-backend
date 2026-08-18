import storiesService from "./stories.service.js";
import multer from "multer";
import { getIO } from '../../sockets/socketStore.js'
import { NotificationsService } from "./notifications.service.js";
import supabase from "../../config/supabaseClient.js";



async function getReactionActorIdentity(actorId) {
  const [{ data: profile, error: profileError }, { data: user, error: userError }] =
    await Promise.all([
      supabase
        .from("social_profiles")
        .select("display_name, foto_url")
        .eq("user_id", actorId)
        .maybeSingle(),
      supabase
        .from("usuarios")
        .select("nombre")
        .eq("id_usuario", actorId)
        .maybeSingle(),
    ]);

  if (profileError) throw new Error(profileError.message);
  if (userError) throw new Error(userError.message);

  return {
    actor_name: profile?.display_name?.trim() || user?.nombre?.trim() || "Alguien",
    actor_photo: profile?.foto_url ?? null,
  };
}


export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (_, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime"];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error("Formato no permitido"));
  },
});

export async function getPeopleWithStories(req, res) {
  try {
    const venue_id = Number(req.query.venue_id);
    const viewer_user_id =
      Number(
        req.user?.id_usuario ||
          req.user?.id ||
          req.user?.user_id
      ) || null;

    if (!venue_id) return res.status(400).json({ error: "venue_id es requerido" });

    const result = await storiesService.getPeopleWithStories({ venue_id, viewer_user_id });
    return res.json(result);
  } catch (error) {
    console.error("Error getPeopleWithStories:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
}

export async function getThemesSummary(req, res) {
  try {
    const venue_id = Number(req.query.venue_id);
    if (!venue_id) return res.status(400).json({ error: "venue_id es requerido" });

    const result = await storiesService.getThemesSummary({ venue_id });
    return res.json(result);
  } catch (error) {
    console.error("Error getThemesSummary:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
}

export async function getStories(req, res) {
  try {
    const venue_id = Number(req.query.venue_id);
    const user_id = Number(req.query.user_id);
    const viewer_user_id =
      Number(req.user?.id_usuario || req.user?.id || req.user?.user_id) || null;

    if (!venue_id) return res.status(400).json({ error: "venue_id es requerido" });
    if (!user_id) return res.status(400).json({ error: "user_id es requerido" });

    const result = await storiesService.getStoriesByUser({ venue_id, user_id, viewer_user_id });
    return res.json(result);
  } catch (error) {
    console.error("Error getStories:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
}

export async function uploadStory(req, res) {
  try {
    const user_id = Number(req.body.user_id);
    const venue_id = Number(req.body.venue_id);
    const venue_category = req.body.venue_category ?? "bares";

    if (!user_id || !venue_id)
      return res.status(400).json({ error: "user_id y venue_id son requeridos" });

    if (!req.file)
      return res.status(400).json({ error: "No se recibió ningún archivo" });

    const story = await storiesService.uploadStory({
      file: req.file,
      user_id,
      venue_id,
      venue_category,
    });

    const userStories = await storiesService.getStoriesByUser({ venue_id, user_id });

    const io = getIO();

    if (io) {
      const socketsInVenue = await io.in(`venue:${venue_id}`).fetchSockets();
      const socketsByUserId = new Map();

      for (const venueSocket of socketsInVenue) {
        const viewerUserId = venueSocket.data.user_id;

        if (!viewerUserId) continue;

        const normalizedUserId = String(viewerUserId);
        const userSockets = socketsByUserId.get(normalizedUserId) || [];

        userSockets.push(venueSocket);
        socketsByUserId.set(normalizedUserId, userSockets);
      }

      for (const [viewerUserId, userSockets] of socketsByUserId.entries()) {
        const peopleWithStories = await storiesService.getPeopleWithStories({
          venue_id,
          viewer_user_id: Number(viewerUserId),
        });

        console.log("[stories filtered]", {
          venueId: venue_id,
          viewerUserId: Number(viewerUserId),
          visibleUserIds: peopleWithStories.map((item) => item.user_id),
        });

        for (const venueSocket of userSockets) {
          venueSocket.emit("stories:created", {
            venue_id,
            user_id,
            story,
            peopleWithStories,
            userStories,
          });
        }
      }
    }

    return res.status(201).json(story);
  } catch (error) {
    console.error("Error uploadStory:", error);
    return res.status(500).json({ error: error.message });
  }
}



export async function toggleLike(req, res) {
  try {
    const story_id = Number(req.params.id);
    const user_id = Number(req.body.user_id);

    if (!story_id || !user_id)
      return res.status(400).json({ error: "story_id y user_id son requeridos" });

    const result = await storiesService.toggleLike({ story_id, user_id });

    const story = await storiesService.getStoryById({ story_id });

    const io = getIO();

    if (story) {
      io?.to(`venue:${story.venue_id}`).emit("story:liked", {
        story_id,
        user_id,
        liked: result.liked,
        story,
      });
    }

    return res.json(result);
  } catch (error) {
    console.error("Error toggleLike:", error);
    return res.status(500).json({ error: error.message });
  }
}

export async function registerView(req, res) {
  try {
    const story_id = Number(req.params.id);
    const viewer_user_id =
      Number(req.user?.id_usuario || req.user?.id || req.user?.user_id || req.body.viewer_user_id) ||
      null;

    if (!story_id || !viewer_user_id)
      return res.status(400).json({ error: "story_id y viewer_user_id son requeridos" });

    const result = await storiesService.registerView({ story_id, viewer_user_id });

    const story = await storiesService.getStoryById({ story_id });

    const io = getIO();

    if (story) {
      io?.to(`user:${story.user_id}`).emit("story:viewed", {
        story_id,
        viewer_user_id,
        story,
      });
    }

    return res.json(result);
  } catch (error) {
    console.error("Error registerView:", error);
    return res.status(500).json({ error: error.message });
  }
}

export async function getStoryViews(req, res) {
  try {
    const story_id = Number(req.params.id);
    if (!story_id) return res.status(400).json({ error: "story_id requerido" });

    const result = await storiesService.getStoryViews({ story_id });
    return res.json(result);
  } catch (error) {
    console.error("Error getStoryViews:", error);
    return res.status(500).json({ error: error.message });
  }
}

export async function getStoryLikes(req, res) {
  try {
    const story_id = Number(req.params.id);
    if (!story_id) return res.status(400).json({ error: "story_id requerido" });

    const result = await storiesService.getStoryLikes({ story_id });
    return res.json(result);
  } catch (error) {
    console.error("Error getStoryLikes:", error);
    return res.status(500).json({ error: error.message });
  }
}

export async function toggleReaction(req, res) {
  try {
    const story_id = Number(req.params.id);
    const { user_id, reaction } = req.body;

    if (!story_id || !user_id || !reaction) {
      return res.status(400).json({
        error: "story_id, user_id y reaction son requeridos",
      });
    }

    const actorId = Number(user_id);

    const result = await storiesService.toggleReaction({
      story_id,
      user_id: actorId,
      reaction,
    });

    const story = await storiesService.getStoryById({ story_id });

    const io = getIO();

    if (story) {
      const isOwner = String(story.user_id) === String(actorId);

      let notification = null;

      if (!isOwner && result.reaction) {
        const actorIdentity = await getReactionActorIdentity(actorId);

        notification = await NotificationsService.createNotification({
          user_id: story.user_id,
          actor_id: actorId,
          venue_id: story.venue_id,
          type: "story_reaction",
          title: "Nueva reacción",
          message: `Alguien reaccionó ${result.reaction} a tu historia.`,
          metadata: {
            story_id,
            story_owner_id: story.user_id,
            reaction: result.reaction,
            ...actorIdentity,
          },
        });

        io?.to(`user:${story.user_id}`).emit("notification:new", notification);
      }

      io?.to(`user:${story.user_id}`).emit("story:reaction-updated", {
        story_id,
        user_id: actorId,
        reaction: result.reaction,
        story,
        notification,
      });
    }

    return res.json(result);
  } catch (error) {
    console.error("Error toggleReaction:", error);
    return res.status(500).json({ error: error.message });
  }
}
