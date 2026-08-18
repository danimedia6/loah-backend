import supabase from '../../config/supabaseClient.js'
import safetyService from './safety.service.js'


class SocialService {
  /**
   * Obtiene presencia de usuarios y calcula si están en línea.
   * Filtra por venue cuando se envía venue_id.
   * @param {{ venue_id?: number | null }} params
   * @returns {Promise<Array<{user_id:number,nombre:string|null,foto:string|null,isOnline:boolean}>>}
   */
 async getActiveUsers({ venue_id = null, user_id = null } = {}) {
  let presenceQuery = supabase
    .from("user_presence")
    .select("user_id, venue_id, last_heartbeat_at")
    .order("last_heartbeat_at", { ascending: false });

  if (venue_id) {
    presenceQuery = presenceQuery.eq("venue_id", venue_id);
  }

  const { data: presenceRows, error: presenceError } = await presenceQuery;

  if (presenceError) throw new Error(presenceError.message);

  const latestPresenceByUser = new Map();

  for (const row of presenceRows || []) {
    if (!latestPresenceByUser.has(row.user_id)) {
      latestPresenceByUser.set(row.user_id, row);
    }
  }

  let userIds = [...latestPresenceByUser.keys()];
    if (!userIds.length) return [];

    const userIdsBeforeHiddenFilter = [...userIds];
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

    console.log("[hidden debug:active-users]", {
      user_id,
      userIdsBeforeHiddenFilter,
      hiddenUserIds: [...hiddenUserIds],
      userIdsAfterHiddenFilter: userIds,
    });

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
      instagram,
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

  const nowMs = Date.now();

  userIds = userIds.filter((userId) => usersById.has(Number(userId)));

  if (!userIds.length) return [];

  return userIds.map((userId) => {
    const presence = latestPresenceByUser.get(userId);
    const user = usersById.get(Number(userId));
    const profile = profilesByUserId.get(Number(userId));

    const lastHeartbeat = presence?.last_heartbeat_at
      ? new Date(presence.last_heartbeat_at).getTime()
      : 0;

    return {
      user_id: Number(userId),
      nombre: profile?.display_name || user?.nombre || "Usuario",
      real_nombre: user?.nombre ?? null,
      foto: profile?.foto_url ?? null,
      isOnline: nowMs - lastHeartbeat < 300000,
      card_background_url: profile?.card_background_url ?? null,
      display_name: profile?.display_name ?? null,
      bio: profile?.bio ?? null,
      mood: profile?.mood ?? "Disponible 🍻",
      favorite_drink: profile?.favorite_drink ?? null,
      instagram: profile?.instagram ?? null,
      tags: profile?.tags ?? [],
      allow_gifts: profile?.allow_gifts ?? true,
      allow_chat: profile?.allow_chat ?? true,
      gallery_urls: profile?.gallery_urls ?? [],
    };
  });
}
  async heartbeat({ user_id, venue_id, table_id }) {
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
