import { Router } from "express";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { validatePresenceQr } from "./presence.controller.js";

const router = Router();

router.post("/validate-qr", authMiddleware, validatePresenceQr);

export default router;
