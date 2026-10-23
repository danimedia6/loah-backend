import supabase from '../../config/supabaseClient.js'
import safetyService from './safety.service.js'
import { getVenueOpenWindow } from './presence-hours.helper.js'
import { getCurrentAuthUser } from '../../services/auth-context.service.js'
import { assertVenueAdmin } from './venue-ownership.helper.js'

async function requireCurrentVenueAdmin(userId, venueId, user) {
  // Optional context comes only from the current HTTP/socket authentication, never payloads.
  const current = user || await getCurrentAuthUser({ id: userId })
  if (Number(current.id) !== Number(userId) || current.is_suspended !== false) {
    throw Object.assign(new Error('No autorizado'), { statusCode: 403 })
  }
  assertVenueAdmin(current, venueId)
}

const PRESENCE_TTL_MS = 30 * 60 * 1000
const PRESENCE_EXPIRED_EVENT = 'social:presence-expired'

function emitPresenceExpired(sessions) {
  const expiredSessions = Array.isArray(sessions) ? sessions : [sessions]
  const payload = expiredSessions.filter(Boolean)

  if (payload.length) {
    process.emit(PRESENCE_EXPIRED_EVENT, payload)
  }
}

class PresenceError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message)
    this.code = code
    this.statusCode = statusCode
  }
}

class SocialService {
  /**
   * Obtiene presencia de usuarios y calcula si están en línea.
   * Filtra por venue cuando se envía venue_id.
   * @param {{ venue_id?: number | null }} params
   * @returns {Promise<Array<{user_id:number,nombre:string|null,foto:string|null,isOnline:boolean}>>}
   */
 async getActiveUsers({
  venue_id = null,
  user_id = null,
  onSessionsExpired = null,
  suppressPresenceExpiredEvent = false,
} = {}) {
  const now = new Date();
  console.log("[getActiveUsers presence source]");

  let presenceQuery = supabase
    .from("venue_presence_sessions")
    .select("id, user_id, venue_id, last_activity_at, valid_until, hard_expires_at")
    .eq("status", "active")
    .order("last_activity_at", { ascending: false });

  if (venue_id) {
    presenceQuery = presenceQuery.eq("venue_id", venue_id);
  }

  const { data: presenceRows, error: presenceError } = await presenceQuery;

  if (presenceError) throw new Error(presenceError.message);

  console.log("[presence expiry debug]");

  const expiredSessions = (presenceRows || [])
    .filter((row) =>
      now >= new Date(row.valid_until) ||
      now >= new Date(row.hard_expires_at)
    )
  const expiredSessionIds = expiredSessions.map((row) => row.id);
  const expiredSessionIdSet = new Set(expiredSessionIds);

  console.log("[presence expiry candidates]");

  if (expiredSessionIds.length) {
    const { data: expireData, error: expireError } = await supabase
      .from("venue_presence_sessions")
      .update({ status: "expired" })
      .in("id", expiredSessionIds)
      .eq("status", "active");

    console.log("[presence expiry update]");

    if (expireError) throw new Error(expireError.message);

    if (!suppressPresenceExpiredEvent) {
      emitPresenceExpired(expiredSessions)
    }

    if (typeof onSessionsExpired === "function") {
      await onSessionsExpired(expiredSessions)
    }
  }

  const latestPresenceByUser = new Map();

  for (const row of (presenceRows || [])) {
    if (
      expiredSessionIdSet.has(row.id) ||
      now >= new Date(row.valid_until) ||
      now >= new Date(row.hard_expires_at)
    ) {
      continue;
    }

    if (!latestPresenceByUser.has(row.user_id)) {
      latestPresenceByUser.set(row.user_id, row);
    }
  }

  let userIds = [...latestPresenceByUser.keys()];
    if (!userIds.length) return [];

    let hiddenUserIds = new Set();

    if (user_id) {
      hiddenUserIds = new Set(
        await safetyService.getHiddenUserIdsForViewer(user_id)
      );

      userIds = userIds.filter(
        (activeUserId) =>
          Number(activeUserId) !== Number(user_id) &&
          !hiddenUserIds.has(Number(activeUserId))
      );
    }

    if (!userIds.length) return [];

  const { data: users, error: usersError } = await supabase
    .from("usuarios")
    .select("id_usuario, nombre, is_suspended")
    .in("id_usuario", userIds)
    .eq("is_suspended", false);

  if (usersError) throw new Error(usersError.message);

  const { data: profiles, error: profilesError } = await supabase
    .from("social_profiles")
    .select(`
      user_id,
      display_name,
      foto_url,
      bio,
      mood,
      favorite_drink,
      tags,
      card_background_url,
      allow_gifts,
      allow_chat,
      gallery_urls
    `)
    .in("user_id", userIds);

  if (profilesError) throw new Error(profilesError.message);

  const usersById = new Map(
    (users || []).map((user) => [Number(user.id_usuario), user])
  );

  const allowedUserIds = new Set(
    (users || []).map((u) => Number(u.id_usuario))
  );

  userIds = userIds.filter((userId) =>
    allowedUserIds.has(Number(userId))
  );

  if (!userIds.length) return [];

  const profilesByUserId = new Map(
    (profiles || []).map((profile) => [Number(profile.user_id), profile])
  );

  userIds = userIds.filter((userId) => usersById.has(Number(userId)));

  if (!userIds.length) return [];

  return userIds.map((userId) => {
    const user = usersById.get(Number(userId));
    const profile = profilesByUserId.get(Number(userId));

    return {
      user_id: Number(userId),
      nombre: profile?.display_name || user?.nombre || "Usuario",
      real_nombre: user?.nombre ?? null,
      foto: profile?.foto_url ?? null,
      isOnline: true,
      card_background_url: profile?.card_background_url ?? null,
      display_name: profile?.display_name ?? null,
      bio: profile?.bio ?? null,
      mood: profile?.mood ?? "Disponible 🍻",
      favorite_drink: profile?.favorite_drink ?? null,
      tags: profile?.tags ?? [],
      allow_gifts: profile?.allow_gifts ?? true,
      allow_chat: profile?.allow_chat ?? true,
      gallery_urls: profile?.gallery_urls ?? [],
    };
  });
}
  async getActivePresenceSession({
    user_id,
    venue_id,
    authenticatedUser = null,
    onExpired = null,
    suppressPresenceExpiredEvent = false,
  }) {
    const userId = Number(user_id)
    const venueId = Number(venue_id)

    if (!userId || !venueId) return null

    const { data: session, error } = await supabase
      .from("venue_presence_sessions")
      .select(`
        id,
        user_id,
        venue_id,
        access_token_id,
        source,
        table_id,
        validated_at,
        last_activity_at,
        valid_until,
        hard_expires_at,
        status
      `)
      .eq("user_id", userId)
      .eq("venue_id", venueId)
      .eq("status", "active")
      .order("validated_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) throw new Error(error.message)
    if (!session) return null

    const now = new Date()
    const validUntil = new Date(session.valid_until)
    const hardExpiresAt = new Date(session.hard_expires_at)

    if (now >= validUntil || now >= hardExpiresAt) {
      const { error: expireError } = await supabase
        .from("venue_presence_sessions")
        .update({ status: "expired" })
        .eq("id", session.id)
        .eq("status", "active")

      if (expireError) throw new Error(expireError.message)

      if (!suppressPresenceExpiredEvent) {
        emitPresenceExpired(session)
      }

      if (typeof onExpired === "function") {
        await onExpired(session)
      }

      return null
    }

    if (session.source === 'venue_admin') {
      await requireCurrentVenueAdmin(userId, venueId, authenticatedUser)
    }
    return session
  }

  async getActivePresenceUserIdsForVenue({
    venue_id,
    onSessionsExpired = null,
    suppressPresenceExpiredEvent = false,
  }) {
    const venueId = Number(venue_id)
    if (!venueId) return new Set()

    const now = new Date()
    const { data: sessions, error } = await supabase
      .from("venue_presence_sessions")
      .select("id, user_id, venue_id, valid_until, hard_expires_at")
      .eq("venue_id", venueId)
      .eq("status", "active")

    if (error) throw new Error(error.message)

    const expiredSessions = (sessions || [])
      .filter((session) =>
        now >= new Date(session.valid_until) ||
        now >= new Date(session.hard_expires_at)
      )
    const expiredSessionIds = expiredSessions.map((session) => session.id)

    if (expiredSessionIds.length) {
      const { error: expireError } = await supabase
        .from("venue_presence_sessions")
        .update({ status: "expired" })
        .in("id", expiredSessionIds)
        .eq("status", "active")

      if (expireError) throw new Error(expireError.message)

      if (!suppressPresenceExpiredEvent) {
        emitPresenceExpired(expiredSessions)
      }

      if (typeof onSessionsExpired === "function") {
        await onSessionsExpired(expiredSessions)
      }
    }

    const expiredSessionIdSet = new Set(expiredSessionIds)

    return new Set(
      (sessions || [])
        .filter((session) =>
          !expiredSessionIdSet.has(session.id) &&
          now < new Date(session.valid_until) &&
          now < new Date(session.hard_expires_at)
        )
        .map((session) => Number(session.user_id))
    )
  }

  async ensureVenueAdminPresence({ user_id, venue_id, table_id = null, authenticatedUser = null }) {
    const userId = Number(user_id)
    const venueId = Number(venue_id)
    const finalTableId = table_id ?? null
    await requireCurrentVenueAdmin(userId, venueId, authenticatedUser)

    if (!userId) {
      throw new PresenceError(
        "PRESENCE_REQUIRED",
        "Usuario autenticado requerido",
        401
      )
    }

    if (!venueId) {
      throw new PresenceError(
        "VENUE_MISMATCH",
        "venue_id es requerido",
        400
      )
    }

    const { data: venue, error: venueError } = await supabase
      .from("venues")
      .select("id, timezone, weekly_hours")
      .eq("id", venueId)
      .maybeSingle()

    if (venueError) throw new Error(venueError.message)

    if (!venue) {
      throw new PresenceError(
        "VENUE_NOT_FOUND",
        "Venue no encontrado",
        404
      )
    }

    const now = new Date()
    const openWindow = getVenueOpenWindow(venue, now)

    if (!openWindow.isOpen || !openWindow.hardExpiresAt || openWindow.hardExpiresAt <= now) {
      throw new PresenceError(
        "VENUE_CLOSED",
        "Venue fuera de horario para presencia social",
        403
      )
    }

    const { data: existingSession, error: existingError } = await supabase
      .from("venue_presence_sessions")
      .select("id, user_id, venue_id, valid_until, hard_expires_at")
      .eq("user_id", userId)
      .eq("venue_id", venueId)
      .eq("status", "active")
      .order("validated_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existingError) throw new Error(existingError.message)

    if (existingSession) {
      const currentValidUntil = new Date(existingSession.valid_until)
      const currentHardExpiresAt = new Date(existingSession.hard_expires_at)

      if (now < currentValidUntil && now < currentHardExpiresAt) {
        const validUntil = new Date(Math.min(
          now.getTime() + PRESENCE_TTL_MS,
          currentHardExpiresAt.getTime()
        ))

        const { data: updatedSession, error: updateError } = await supabase
          .from("venue_presence_sessions")
          .update({
            table_id: finalTableId,
            last_activity_at: now.toISOString(),
            valid_until: validUntil.toISOString(),
          })
          .eq("id", existingSession.id)
          .eq("status", "active")
          .select("id, venue_id, valid_until, hard_expires_at")
          .single()

        if (updateError) throw new Error(updateError.message)

        await this.mirrorUserPresence({
          user_id: userId,
          venue_id: venueId,
          table_id: finalTableId,
        })

        return {
          ok: true,
          source: "venue_admin",
          venue_id: updatedSession.venue_id,
          presence_session_id: updatedSession.id,
          valid_until: updatedSession.valid_until,
          hard_expires_at: updatedSession.hard_expires_at,
        }
      }

      const { error: expireError } = await supabase
        .from("venue_presence_sessions")
        .update({ status: "expired" })
        .eq("id", existingSession.id)
        .eq("status", "active")

      if (expireError) throw new Error(expireError.message)
      emitPresenceExpired(existingSession)
    }

    const validUntil = new Date(Math.min(
      now.getTime() + PRESENCE_TTL_MS,
      openWindow.hardExpiresAt.getTime()
    ))

    const { data: session, error: sessionError } = await supabase
      .from("venue_presence_sessions")
      .insert({
        user_id: userId,
        venue_id: venueId,
        access_token_id: null,
        source: "venue_admin",
        table_id: finalTableId,
        validated_at: now.toISOString(),
        last_activity_at: now.toISOString(),
        valid_until: validUntil.toISOString(),
        hard_expires_at: openWindow.hardExpiresAt.toISOString(),
        status: "active",
      })
      .select("id, venue_id, validated_at, valid_until, hard_expires_at")
      .single()

    if (sessionError) throw new Error(sessionError.message)

    await this.mirrorUserPresence({
      user_id: userId,
      venue_id: venueId,
      table_id: finalTableId,
    })

    return {
      ok: true,
      source: "venue_admin",
      venue_id: session.venue_id,
      presence_session_id: session.id,
      validated_at: session.validated_at,
      valid_until: session.valid_until,
      hard_expires_at: session.hard_expires_at,
    }
  }

  async mirrorUserPresence({ user_id, venue_id, table_id }) {
    const { error } = await supabase
      .from("user_presence")
      .upsert(
        {
          user_id,
          venue_id,
          table_id,
          last_heartbeat_at: new Date().toISOString(),
        },
        { onConflict: "user_id,venue_id" }
      );

    if (error) throw new Error(error.message);
  }

  async heartbeat({
    user_id,
    venue_id,
    table_id,
    authenticatedUser = null,
    onExpired = null,
    suppressPresenceExpiredEvent = false,
  }) {
    const userId = Number(user_id)
    const venueId = Number(venue_id)
    const finalTableId = table_id ?? null

    if (!userId) {
      throw new PresenceError(
        "PRESENCE_REQUIRED",
        "Usuario autenticado requerido",
        401
      )
    }

    if (!venueId) {
      throw new PresenceError(
        "VENUE_MISMATCH",
        "venue_id es requerido",
        400
      )
    }

    let expiredSessionDetected = false
    const session = await this.getActivePresenceSession({
      user_id: userId,
      venue_id: venueId,
      authenticatedUser,
      suppressPresenceExpiredEvent,
      onExpired: async (expiredSession) => {
        expiredSessionDetected = true
        if (typeof onExpired === "function") {
          await onExpired(expiredSession)
        }
      },
    })

    if (!session) {
      if (expiredSessionDetected) {
        throw new PresenceError(
          "PRESENCE_EXPIRED",
          "La presencia expiró. Debes validar nuevamente con el QR.",
          403
        )
      }

      throw new PresenceError(
        "PRESENCE_REQUIRED",
        "Debes validar tu presencia mediante el QR del establecimiento.",
        403
      )
    }

    const now = new Date()
    const hardExpiresAt = new Date(session.hard_expires_at)

    if (hardExpiresAt <= now) {
      const { error: expireError } = await supabase
        .from("venue_presence_sessions")
        .update({ status: "expired" })
        .eq("id", session.id)
        .eq("status", "active")

      if (expireError) throw new Error(expireError.message)

      if (!suppressPresenceExpiredEvent) {
        emitPresenceExpired(session)
      }

      if (typeof onExpired === "function") {
        await onExpired(session)
      }

      throw new PresenceError(
        "PRESENCE_EXPIRED",
        "La presencia expiró. Debes validar nuevamente con el QR.",
        403
      )
    }

    const validUntil = new Date(Math.min(
      now.getTime() + PRESENCE_TTL_MS,
      hardExpiresAt.getTime()
    ))

    const { data: updatedSession, error: updateError } = await supabase
      .from("venue_presence_sessions")
      .update({
        last_activity_at: now.toISOString(),
        valid_until: validUntil.toISOString(),
      })
      .eq("id", session.id)
      .eq("status", "active")
      .select("id, venue_id, valid_until, hard_expires_at")
      .single()

    if (updateError) throw new Error(updateError.message)

    await this.mirrorUserPresence({
      user_id: userId,
      venue_id: venueId,
      table_id: finalTableId,
    })

    return {
      ok: true,
      presence_session_id: updatedSession.id,
      venue_id: updatedSession.venue_id,
      valid_until: updatedSession.valid_until,
      hard_expires_at: updatedSession.hard_expires_at,
    }
  }

  async markOffline({ user_id, venue_id }) {
    const offlineAt = new Date(Date.now() - 301000).toISOString();

    const { error } = await supabase
      .from("user_presence")
      .update({ last_heartbeat_at: offlineAt })
      .eq("user_id", user_id)
      .eq("venue_id", venue_id);

    if (error) throw new Error(error.message);
  }
}

export default new SocialService()
