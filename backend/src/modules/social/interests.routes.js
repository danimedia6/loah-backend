import { Router } from "express";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import {
  correspondStoryReaction,
  getMutualInterests,
  getProfileLikeStatus,
  likeProfile,
  unlikeProfile,
} from "./interests.controller.js";

const router = Router();

router.post(
  "/stories/:storyId/reactions/:actorId/correspond",
  authMiddleware,
  correspondStoryReaction
);

router.post("/profile-likes", authMiddleware, likeProfile);
router.delete("/profile-likes/:receiverId", authMiddleware, unlikeProfile);
router.get("/profile-likes/status", authMiddleware, getProfileLikeStatus);
router.get("/mutual-interests", authMiddleware, getMutualInterests);

export default router;
