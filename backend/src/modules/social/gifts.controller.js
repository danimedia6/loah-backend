import giftsService from "./gifts.service.js";
import { getIO } from '../../sockets/socketStore.js'
import { assertGiftFields, assertGiftIdentity, GiftError, giftHttpError } from "./gifts.security.js";

export async function sendGift(req, res) {
  try {
    assertGiftFields(req.body, ["story_id", "venue_id", "sender_id", "receiver_id", "product_id"]);
    const { story_id, venue_id, receiver_id, product_id } = req.body;
    const sender_id = assertGiftIdentity(req.user, req.body.sender_id);

    if (!sender_id) {
      return res.status(401).json({ error: "No autenticado" });
    }

    if (!receiver_id || !product_id) {
      return res.status(400).json({ error: "Faltan campos requeridos" });
    }

    if (!story_id && !venue_id) {
      return res.status(400).json({ error: "venue_id es requerido para regalos desde tarjeta" });
    }

    const result = await giftsService.sendGift({
      actor: req.user,
      story_id,
      venue_id,
      sender_id,
      receiver_id,
      product_id,
    });
    
    return res.status(201).json(result);
  } catch (error) {
    return giftHttpError(res, error);
  }
}

export async function respondGift(req, res) {
  try {
    const gift_id = req.params.id;
    assertGiftFields(req.body, ["receiver_id", "response", "message"]);
    const { response, message } = req.body;
    const receiver_id = assertGiftIdentity(req.user, req.body.receiver_id);

    if (!gift_id || !receiver_id || !response)
      return res.status(400).json({ error: "Faltan campos requeridos" });

    const result = await giftsService.respondGift({
      actor: req.user,
      gift_id,
      receiver_id: Number(receiver_id),
      response,
      message,
    });


    const io = getIO();

    const pendingGifts = await giftsService.getPendingGifts({
      actor: req.user,
      receiver_id: Number(receiver_id),
    });

    io?.to(`user:${receiver_id}`).emit(
      'gift:pending-updated',
      pendingGifts
    );

    io?.to(`user:${receiver_id}`).emit(
      'gift:responded',
      result
    );

    if (result.sender_id) {
      const { redeem_token, redeem_expires_at, notification, ...senderResult } = result;
      io?.to(`user:${result.sender_id}`).emit(
        'gift:responded',
        senderResult
      );

      if (result.notification) {
        io?.to(`user:${result.sender_id}`).emit(
          'notification:new',
          result.notification
        );
      }
    }

    return res.json(result);
  } catch (error) {
    return giftHttpError(res, error);
  }
}

export async function getPendingGifts(req, res) {
  try {
    const receiver_id = assertGiftIdentity(req.user, req.query.receiver_id);
    if (!receiver_id)
      return res.status(400).json({ error: "receiver_id requerido" });

    const result = await giftsService.getPendingGifts({ actor: req.user, receiver_id });
    return res.json(result);
  } catch (error) {
    return giftHttpError(res, error);
  }
}

export async function getStoryReactions(req, res) {
  return giftHttpError(res, new GiftError("Ruta heredada no disponible", 410));
}

export async function toggleReaction(req, res) {
  return giftHttpError(res, new GiftError("Ruta heredada no disponible", 410));
}

export async function getRedeemGift(req, res) {
  try {
    const { token } = req.params;

    const gift = await giftsService.getRedeemGiftByToken({ token, actor: req.user });

    return res.json(gift);
  } catch (error) {
    return giftHttpError(res, error);
  }
}

export async function redeemGift(req, res) {
  try {
    const { token } = req.params;

    const result = await giftsService.redeemGiftByToken({
      token,
      actor: req.user,
    });

    return res.json(result);
  } catch (error) {
    return giftHttpError(res, error);
  }
}
