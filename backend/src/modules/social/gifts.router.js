import { Router } from "express";
import {
  sendGift,
  respondGift,
  getPendingGifts,
  toggleReaction,
  getStoryReactions,
  getRedeemGift,
  redeemGift,
 } from "./gifts.controller.js";
 import { authMiddleware, requireRole } from "../../middlewares/auth.middleware.js";

const router = Router();

router.get("/redeem/:token", getRedeemGift);
router.post(
  "/redeem/:token",
  authMiddleware,
  requireRole("admin"),
  redeemGift
);

router.post("/send", sendGift);
router.post("/:id/respond", respondGift);
router.get("/pending", getPendingGifts);
router.post("/:id/reaction", toggleReaction);
router.get("/:id/reactions", getStoryReactions);

export default router;