import { Router } from "express";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import {
  getMyConversations,
  getConversationMessages,
  sendChatMessage,
  markConversationAsRead,
} from "./chat.controller.js";

const router = Router();

router.get("/conversations", authMiddleware, getMyConversations);

router.get(
  "/conversations/:conversationId/messages",
  authMiddleware,
  getConversationMessages
);

router.post(
  "/conversations/:conversationId/messages",
  authMiddleware,
  sendChatMessage
);

router.post(
  "/conversations/:conversationId/read",
  authMiddleware,
  markConversationAsRead
);

export default router;