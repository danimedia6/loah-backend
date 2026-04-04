import giftsService from "./gifts.service.js";

export async function sendGift(req, res) {
  try {
    const { story_id, sender_id, receiver_id, product_id } = req.body;
    if (!story_id || !sender_id || !receiver_id || !product_id)
      return res.status(400).json({ error: "Faltan campos requeridos" });

    const result = await giftsService.sendGift({
      story_id:    Number(story_id),
      sender_id:   Number(sender_id),
      receiver_id: Number(receiver_id),
      product_id:  Number(product_id),
    });
    return res.status(201).json(result);
  } catch (error) {
    console.error("Error sendGift:", error);
    return res.status(400).json({ error: error.message });
  }
}

export async function respondGift(req, res) {
  try {
    const gift_id     = Number(req.params.id);
    const { receiver_id, response, message } = req.body;

    if (!gift_id || !receiver_id || !response)
      return res.status(400).json({ error: "Faltan campos requeridos" });

    const result = await giftsService.respondGift({
      gift_id,
      receiver_id: Number(receiver_id),
      response,
      message,
    });
    return res.json(result);
  } catch (error) {
    console.error("Error respondGift:", error);
    return res.status(400).json({ error: error.message });
  }
}

export async function getPendingGifts(req, res) {
  try {
    const receiver_id = Number(req.query.receiver_id);
    if (!receiver_id)
      return res.status(400).json({ error: "receiver_id requerido" });

    const result = await giftsService.getPendingGifts({ receiver_id });
    return res.json(result);
  } catch (error) {
    console.error("Error getPendingGifts:", error);
    return res.status(500).json({ error: error.message });
  }
}

export async function getStoryReactions(req, res) {
  try {
    const story_id = Number(req.params.id);
    if (!story_id) return res.status(400).json({ error: "story_id requerido" });

    // importamos storiesService aquí para no duplicar archivos
    const { default: storiesService } = await import("../stories/stories.service.js");
    const result = await storiesService.getStoryReactions({ story_id });
    return res.json(result);
  } catch (error) {
    console.error("Error getStoryReactions:", error);
    return res.status(500).json({ error: error.message });
  }
}

export async function toggleReaction(req, res) {
  try {
    const story_id = Number(req.params.id);
    const { user_id, reaction } = req.body;

    if (!story_id || !user_id || !reaction)
      return res.status(400).json({ error: "Faltan campos requeridos" });

    const { default: storiesService } = await import("../stories/stories.service.js");
    const result = await storiesService.toggleReaction({ story_id, user_id, reaction });
    return res.json(result);
  } catch (error) {
    console.error("Error toggleReaction:", error);
    return res.status(500).json({ error: error.message });
  }
}