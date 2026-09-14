import { Router } from "express";
import { authMiddleware, requireRole } from "../../middlewares/auth.middleware.js";
import upload from "../../middlewares/upload.middleware.js";
import {
  getMyVenue,
  getVenueById,
  generatePresenceQr,
  updateVenueSettings,
  updateVenueProfile,
  uploadVenueLogo,
  uploadVenueCover,
} from "./venues.controller.js";

const router = Router();

router.get("/me", authMiddleware, requireRole("admin"), getMyVenue);
router.get("/:id", getVenueById);
router.patch("/:id/profile", authMiddleware, requireRole("admin"), updateVenueProfile);
router.post("/:id/logo", authMiddleware, requireRole("admin"), upload.single("file"), uploadVenueLogo);
router.post("/:id/cover", authMiddleware, requireRole("admin"), upload.single("file"), uploadVenueCover);
router.patch("/:id/settings", authMiddleware, requireRole("admin"), updateVenueSettings);
router.post("/:id/presence-qr", authMiddleware, requireRole("admin"), generatePresenceQr);

export default router;
