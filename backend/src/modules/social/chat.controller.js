import chatService from "./chat.service.js";

function getAuthUserId(req) {
  return req.user?.id || req.user?.id_usuario || req.user?.user_id;
}

export async function getMyConversations(req, res) {
  try {
    const user_id = getAuthUserId(req);

    if (!user_id) {
      return res.status(401).json({ error: "No autenticado" });
    }

    const conversations = await chatService.getConversationsByUser({
      user_id,
    });

    return res.json(conversations);
  } catch (error) {
    console.error("Error getMyConversations:", error);
    return res.status(400).json({ error: error.message });
  }
}

export async function getConversationMessages(req, res) {
  try {
    const user_id = getAuthUserId(req);
    const { conversationId } = req.params;

    if (!user_id) {
      return res.status(401).json({ error: "No autenticado" });
    }

    const messages = await chatService.getMessages({
      conversation_id: conversationId,
      user_id,
    });

    return res.json(messages);
  } catch (error) {
    console.error("Error getConversationMessages:", error);
    return res.status(400).json({ error: error.message });
  }
}

export async function sendChatMessage(req, res) {
  try {
    const sender_id = getAuthUserId(req);
    const { conversationId } = req.params;
    const { message } = req.body;

    if (!sender_id) {
      return res.status(401).json({ error: "No autenticado" });
    }

    const createdMessage = await chatService.sendMessage({
      conversation_id: conversationId,
      sender_id,
      message,
    });

    return res.status(201).json(createdMessage);
  } catch (error) {
    console.error("Error sendChatMessage:", error);
    return res.status(400).json({ error: error.message });
  }
}

export async function markConversationAsRead(req, res) {
  try {
    const user_id = getAuthUserId(req);
    const { conversationId } = req.params;

    if (!user_id) {
      return res.status(401).json({ error: "No autenticado" });
    }

    const result = await chatService.markMessagesAsRead({
      conversation_id: conversationId,
      user_id,
    });

    return res.json(result);
  } catch (error) {
    console.error("Error markConversationAsRead:", error);
    return res.status(400).json({ error: error.message });
  }
}