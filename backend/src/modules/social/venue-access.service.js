import crypto from "crypto";
import supabase from "../../config/supabaseClient.js";
import { getVenueOpenWindow } from "./presence-hours.helper.js";

const TOKEN_TTL_MS = 60 * 60 * 1000;
const PRESENCE_TTL_MS = 30 * 60 * 1000;

class VenueAccessError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

const hashToken = (token) => crypto
  .createHash("sha256")
  .update(String(token))
  .digest("hex");

const generateRawToken = () => crypto.randomBytes(32).toString("base64url");

const buildPresenceQrUrl = ({ venue_id, token }) => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const baseUrl = frontendUrl.replace(/\/$/, "");

  return `${baseUrl}/m/${encodeURIComponent(String(venue_id))}/social?presence_token=${encodeURIComponent(token)}`;
};

const getAuthenticatedUserId = (user) => Number(
  user?.id_usuario ||
    user?.id ||
    user?.user_id
) || null;

class VenueAccessService {
  async getVenueOrThrow(venue_id) {
    const { data, error } = await supabase
      .from("venues")
      .select("id, name, category, city, timezone, weekly_hours")
      .eq("id", venue_id)
      .single();

    if (error) {
      throw new VenueAccessError("Venue no encontrado", 404);
    }

    return data;
  }

  async generatePresenceQr({ venue_id }) {
    const venueId = Number(venue_id);
    if (!venueId) {
      throw new VenueAccessError("venue_id inválido", 400);
    }

    await this.getVenueOrThrow(venueId);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + TOKEN_TTL_MS);
    const token = generateRawToken();
    const tokenHash = hashToken(token);

    const { error: revokeError } = await supabase
      .from("venue_access_tokens")
      .update({ revoked_at: now.toISOString() })
      .eq("venue_id", venueId)
      .is("revoked_at", null);

    if (revokeError) {
      throw new Error(revokeError.message);
    }

    const { error: insertError } = await supabase
      .from("venue_access_tokens")
      .insert({
        venue_id: venueId,
        token_hash: tokenHash,
        issued_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        revoked_at: null,
      })
      .select("id")
      .single();

    if (insertError) {
      throw new Error(insertError.message);
    }

    return {
      venue_id: venueId,
      expires_at: expiresAt.toISOString(),
      qr_url: buildPresenceQrUrl({ venue_id: venueId, token }),
      token,
    };
  }

  async validateQr({ user, venue_id, token, table_id = null }) {
    const userId = getAuthenticatedUserId(user);
    const venueId = Number(venue_id);
    const normalizedToken = typeof token === "string" ? token.trim() : "";
    const tableId = table_id === undefined || table_id === null || table_id === ""
      ? null
      : Number(table_id);

    if (!userId) {
      throw new VenueAccessError("Usuario autenticado requerido", 401);
    }

    if (!venueId) {
      throw new VenueAccessError("venue_id es requerido", 400);
    }

    if (!normalizedToken) {
      throw new VenueAccessError("token es requerido", 400);
    }

    if (tableId !== null && !tableId) {
      throw new VenueAccessError("table_id inválido", 400);
    }

    const now = new Date();
    const tokenHash = hashToken(normalizedToken);

    const { data: accessToken, error: accessTokenError } = await supabase
      .from("venue_access_tokens")
      .select("id, venue_id, expires_at, revoked_at")
      .eq("venue_id", venueId)
      .eq("token_hash", tokenHash)
      .is("revoked_at", null)
      .maybeSingle();

    if (accessTokenError) {
      throw new Error(accessTokenError.message);
    }

    if (!accessToken) {
      throw new VenueAccessError("QR inválido o revocado", 401);
    }

    if (now >= new Date(accessToken.expires_at)) {
      throw new VenueAccessError("QR expirado", 401);
    }

    const venue = await this.getVenueOrThrow(venueId);
    const openWindow = getVenueOpenWindow(venue, now);

    if (!openWindow.isOpen) {
      throw new VenueAccessError("Venue fuera de horario para iniciar presencia", 403);
    }

    if (!openWindow.hardExpiresAt || openWindow.hardExpiresAt <= now) {
      throw new VenueAccessError("La jornada del venue ya expiró", 403);
    }

    const validUntil = new Date(Math.min(
      now.getTime() + PRESENCE_TTL_MS,
      openWindow.hardExpiresAt.getTime()
    ));

    const { error: closeSessionError } = await supabase
      .from("venue_presence_sessions")
      .update({
        status: "ended",
        ended_at: now.toISOString(),
      })
      .eq("user_id", userId)
      .eq("venue_id", venueId)
      .eq("status", "active");

    if (closeSessionError) {
      throw new Error(closeSessionError.message);
    }

    const { data: session, error: sessionError } = await supabase
      .from("venue_presence_sessions")
      .insert({
        user_id: userId,
        venue_id: venueId,
        access_token_id: accessToken.id,
        table_id: tableId,
        validated_at: now.toISOString(),
        last_activity_at: now.toISOString(),
        valid_until: validUntil.toISOString(),
        hard_expires_at: openWindow.hardExpiresAt.toISOString(),
        status: "active",
      })
      .select("id, venue_id, validated_at, valid_until, hard_expires_at")
      .single();

    if (sessionError) {
      throw new Error(sessionError.message);
    }

    return {
      ok: true,
      venue_id: session.venue_id,
      presence_session_id: session.id,
      validated_at: session.validated_at,
      valid_until: session.valid_until,
      hard_expires_at: session.hard_expires_at,
    };
  }
}

export default new VenueAccessService();
