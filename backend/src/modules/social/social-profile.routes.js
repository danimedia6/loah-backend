import { Router } from "express";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import {
  getMySocialProfile,
  saveMySocialProfile,
} from "./social-profile.controller.js";

const router = Router();

router.get("/me", authMiddleware, getMySocialProfile);
router.put("/me", authMiddleware, saveMySocialProfile);

export default router;