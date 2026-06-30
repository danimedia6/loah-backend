import express from "express";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { NotificationsService } from "./notifications.service.js";

const router = express.Router();

const getAuthUserId = (req) => {
  return (
    req.user?.id_usuario ??
    req.user?.user_id ??
    req.user?.id ??
    req.user?.id_cliente ??
    req.user?.sub ??
    null
  );
};

router.get("/", authMiddleware, async (req, res) => {
  try {
    const userId = getAuthUserId(req);

        if (!userId) {
        return res.status(401).json({
            error: "No se pudo identificar el usuario autenticado",
            payload: req.user,
        });
        }

    const notifications =
      await NotificationsService.getMyNotifications(userId);

    res.json(notifications);
  } catch (err) {
    console.error("Error cargando notificaciones:", err);
    res.status(500).json({ error: "Error cargando notificaciones" });
  }
});

router.patch("/read", authMiddleware, async (req, res) => {
  try {
    const userId = getAuthUserId(req);

    if (!userId) {
    return res.status(401).json({
        error: "No se pudo identificar el usuario autenticado",
        payload: req.user,
    });
    }

    const result = await NotificationsService.markAllAsRead(userId);

    res.json(result);
  } catch (err) {
    console.error("Error cargando notificaciones:", err);
    res.status(500).json({
        error: "Error cargando notificaciones",
        details: err?.message ?? err,
    });
    }
});

export default router;