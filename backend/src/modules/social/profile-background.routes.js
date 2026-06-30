import { Router } from "express";
import multer from "multer";
import supabase from "../../config/supabaseClient.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    allowed.includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error("Formato no permitido"));
  },
});

const getAuthUserId = (req) =>
  req.user?.id_usuario ??
  req.user?.user_id ??
  req.user?.id ??
  req.user?.id_cliente ??
  req.user?.sub ??
  null;

router.post("/background", authMiddleware, upload.single("file"), async (req, res) => {
  try {
    const userId = getAuthUserId(req);

    if (!userId) {
      return res.status(401).json({ error: "No se pudo identificar el usuario" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No se recibió ninguna imagen" });
    }

    const ext =
      req.file.mimetype === "image/png"
        ? "png"
        : req.file.mimetype === "image/webp"
        ? "webp"
        : "jpg";

    const filePath = `social-card-backgrounds/${userId}-${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("stories")
      .upload(filePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true,
      });

    if (uploadError) throw uploadError;

    const { data: publicData } = supabase.storage
      .from("stories")
      .getPublicUrl(filePath);

    const backgroundUrl = publicData.publicUrl;

    const { data: profile, error: updateError } = await supabase
      .from("social_profiles")
      .update({
        card_background_url: backgroundUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .select("*")
      .single();

    if (updateError) throw updateError;

    res.json(profile);
  } catch (err) {
    console.error("Error subiendo fondo de tarjeta:", err);
    res.status(500).json({
      error: "Error subiendo fondo de tarjeta",
      details: err?.message ?? err,
    });
  }
});

router.post("/avatar", authMiddleware, upload.single("file"), async (req, res) => {
  try {
    const userId = getAuthUserId(req);

    if (!userId) {
      return res.status(401).json({ error: "No se pudo identificar el usuario" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No se recibió ninguna imagen" });
    }

    const ext =
      req.file.mimetype === "image/png"
        ? "png"
        : req.file.mimetype === "image/webp"
        ? "webp"
        : "jpg";

    const filePath = `social-avatars/${userId}-${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("stories")
      .upload(filePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true,
      });

    if (uploadError) throw uploadError;

    const { data: publicData } = supabase.storage
      .from("stories")
      .getPublicUrl(filePath);

    const avatarUrl = publicData.publicUrl;

    const { data: profile, error: updateError } = await supabase
        .from("social_profiles")
        .update({
            avatar_url: avatarUrl,
            updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .select("*")
        .single();

        if (updateError) throw updateError;

        res.json({
        user_id: profile.user_id,
        avatar_url: profile.avatar_url,
        foto_url: profile.avatar_url,
        });
  } catch (err) {
    console.error("Error subiendo avatar social:", err);
    res.status(500).json({
      error: "Error subiendo avatar social",
      details: err?.message ?? err,
    });
  }
});

router.post(
  "/gallery",
  authMiddleware,
  upload.array("files", 6),
  async (req, res) => {
    try {
      const userId = getAuthUserId(req);

      if (!userId) {
        return res.status(401).json({ error: "No se pudo identificar el usuario" });
      }

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: "No se recibieron imágenes" });
      }

      const uploadedUrls = [];

      for (const file of req.files) {
        const ext =
          file.mimetype === "image/png"
            ? "png"
            : file.mimetype === "image/webp"
            ? "webp"
            : "jpg";

        const filePath = `social-gallery/${userId}-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2)}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from("stories")
          .upload(filePath, file.buffer, {
            contentType: file.mimetype,
            upsert: true,
          });

        if (uploadError) throw uploadError;

        const { data: publicData } = supabase.storage
          .from("stories")
          .getPublicUrl(filePath);

        uploadedUrls.push(publicData.publicUrl);
      }

      const { data: currentProfile, error: currentError } = await supabase
        .from("social_profiles")
        .select("gallery_urls")
        .eq("user_id", userId)
        .single();

      if (currentError) throw currentError;

      const currentGallery = Array.isArray(currentProfile?.gallery_urls)
        ? currentProfile.gallery_urls
        : [];

      const nextGallery = [...currentGallery, ...uploadedUrls].slice(0, 6);

      const { data: profile, error: updateError } = await supabase
        .from("social_profiles")
        .update({
          gallery_urls: nextGallery,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .select("*")
        .single();

      if (updateError) throw updateError;

      res.json({
        user_id: profile.user_id,
        gallery_urls: profile.gallery_urls ?? [],
      });
    } catch (err) {
      console.error("Error subiendo galería social:", err);
      res.status(500).json({
        error: "Error subiendo galería social",
        details: err?.message ?? err,
      });
    }
  }
);

export default router;