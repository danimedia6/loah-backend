import { Router } from "express";
import {
  sendGift,
  respondGift,
  getPendingGifts,
  toggleReaction,
  getStoryReactions,
} from "./gifts.controller.js";

const router = Router();

router.post("/send", sendGift);
router.post("/:id/respond", respondGift);
router.get("/pending", getPendingGifts);
router.post("/:id/reaction", toggleReaction);
router.get("/:id/reactions", getStoryReactions);

export default router;