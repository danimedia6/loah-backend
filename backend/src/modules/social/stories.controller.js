import storiesService from "./stories.service.js";
import multer from "multer";


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
    if (!venue_id) return res.status(400).json({ error: "venue_id es requerido" });

    const result = await storiesService.getPeopleWithStories({ venue_id });
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

    if (!venue_id) return res.status(400).json({ error: "venue_id es requerido" });
    if (!user_id) return res.status(400).json({ error: "user_id es requerido" });

    const result = await storiesService.getStoriesByUser({ venue_id, user_id });
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

    const story = await storiesService.uploadStory({ file: req.file, user_id, venue_id, venue_category });
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
    return res.json(result);
  } catch (error) {
    console.error("Error toggleLike:", error);
    return res.status(500).json({ error: error.message });
  }
}

export async function registerView(req, res) {
  try {
    const story_id = Number(req.params.id);
    const viewer_user_id = Number(req.body.viewer_user_id);

    if (!story_id || !viewer_user_id)
      return res.status(400).json({ error: "story_id y viewer_user_id son requeridos" });

    const result = await storiesService.registerView({ story_id, viewer_user_id });
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