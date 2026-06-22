import express from "express";
import safetyController from "./safety.controller.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";

const router = express.Router();

router.get("/blocks", authMiddleware, safetyController.listBlocks);

router.post("/blocks", authMiddleware, safetyController.blockUser);
router.delete("/blocks/:blocked_id", authMiddleware, safetyController.unblockUser);

router.post("/reports/profile", authMiddleware, safetyController.reportProfile);
router.post("/reports/message", authMiddleware, safetyController.reportMessage);

export default router;