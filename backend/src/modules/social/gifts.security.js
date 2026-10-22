import { assertVenueAdmin } from "./venue-ownership.helper.js";

export class GiftError extends Error {
  constructor(message, statusCode = 400, code = "GIFT_INVALID_REQUEST") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function giftId(value, field = "id") {
  if (!["string", "number"].includes(typeof value) ||
      !/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) {
    throw new GiftError(`${field} invalido`);
  }
  return Number(value);
}

export function giftActor(actor) {
  const value = actor?.id_usuario ?? actor?.id ?? actor?.user_id;
  try {
    return giftId(value);
  } catch {
    throw new GiftError("No autenticado", 401, "GIFT_AUTH_REQUIRED");
  }
}

export function giftRecordId(value) {
  // Preserve opaque gift IDs: the repository does not declare the original PK type.
  if (typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    return value;
  }
  return giftId(value, "gift_id");
}

export function assertGiftIdentity(actor, claimedId) {
  const id = giftActor(actor);
  if (claimedId !== undefined && giftId(claimedId) !== id) {
    throw new GiftError("No autorizado", 403, "GIFT_FORBIDDEN");
  }
  return id;
}

export function giftAdminVenue(actor) {
  giftActor(actor);
  if (actor.rol !== "admin" || !actor.venue_id) {
    throw new GiftError("No autorizado", 403, "GIFT_FORBIDDEN");
  }
  return assertVenueAdmin(actor, giftId(actor.venue_id, "venue_id"));
}

export function assertGiftFields(body, allowed) {
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new GiftError("Campos no permitidos");
  }
}

// Fail closed until Block 3 provides verified funding. No environment bypass.
export function assertGiftPaymentsAvailable() {
  throw new GiftError(
    "Envios, aceptaciones y redenciones suspendidos hasta habilitar pagos seguros.",
    409,
    "GIFTS_PAYMENTS_UNAVAILABLE"
  );
}

export function pickGiftFields(value, fields) {
  return Object.fromEntries(fields.filter((key) => value[key] !== undefined)
    .map((key) => [key, value[key]]));
}

export const pendingGiftFields = [
  "id", "story_id", "sender_id", "product_nombre", "product_precio", "status",
  "receiver_message", "venue_id", "redeem_token", "redeem_expires_at",
  "redeemed_at", "created_at", "responded_at",
];

export const staffGiftFields = [
  "id", "venue_id", "product_nombre", "product_precio", "status", "redeem_token",
  "redeem_expires_at", "redeemed_at", "created_at", "responded_at",
];

export function giftNotification(notification) {
  if (!notification) return null;
  return {
    ...pickGiftFields(notification, ["id", "user_id", "actor_id", "venue_id", "type",
      "title", "message", "is_read", "created_at"]),
    metadata: pickGiftFields(notification.metadata || {}, ["gift_id", "product_id",
      "product_nombre", "product_name", "response", "actor_name", "actor_photo",
      "venue_id", "sender_id", "receiver_id", "story_id", "message", "conversation_id",
      "redeemed_at"]),
  };
}

export function giftHttpError(res, error) {
  if (error instanceof GiftError || error.name === "VenueOwnershipError") {
    return res.status(error.statusCode).json({ error: error.message, code: error.code });
  }
  // Database errors can contain tokens and participant identifiers.
  console.error("[gifts] Operacion fallida");
  return res.status(500).json({ error: "No se pudo procesar el obsequio" });
}
