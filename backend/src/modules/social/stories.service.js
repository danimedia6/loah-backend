import supabase from "../../config/supabaseClient.js";
import { v4 as uuidv4 } from "uuid";

class StoriesService {
  async getPeopleWithStories({ venue_id }) {
    const now = new Date().toISOString();

    // 1) trae historias activas del venue
    const { data: stories, error } = await supabase
      .from("stories")
      .select("id, user_id, created_at")
      .eq("venue_id", venue_id)
      .gt("expires_at", now)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    // Agrupar por user_id (conteo + latestAt)
    const map = new Map();
    for (const s of stories || []) {
      if (!map.has(s.user_id)) {
        map.set(s.user_id, { user_id: s.user_id, storyCount: 1, latestAt: s.created_at });
      } else {
        const cur = map.get(s.user_id);
        cur.storyCount += 1;
      }
    }

    const userIds = [...map.keys()];
    if (!userIds.length) return [];

    // 2) trae nombres (y foto_url si luego existe)
    const { data: users, error: usersError } = await supabase
      .from("usuarios")
      .select("id_usuario, nombre, is_suspended")
      .in("id_usuario", userIds)
      .eq("is_suspended", false);

    if (usersError) throw new Error(usersError.message);

    const usersById = new Map((users || []).map(u => [u.id_usuario, u]));

    return userIds
      .filter((userId) => usersById.has(userId))
      .map(userId => ({
        user_id: userId,
        nombre: usersById.get(userId)?.nombre ?? null,
        foto:  null,
        hasStory: true,
        storyCount: map.get(userId)?.storyCount ?? 0,
        latestAt: map.get(userId)?.latestAt ?? null
      }));
  }

  async getThemesSummary({ venue_id }) {
    const now = new Date().toISOString();

    const { data: stories, error } = await supabase
      .from("stories")
      .select("venue_category, user_id")
      .eq("venue_id", venue_id)
      .gt("expires_at", now);

    if (error) throw new Error(error.message);

    const userIds = [...new Set((stories || []).map((s) => s.user_id))];

    if (!userIds.length) return [];

    const { data: users, error: usersError } = await supabase
      .from("usuarios")
      .select("id_usuario, is_suspended")
      .in("id_usuario", userIds)
      .eq("is_suspended", false);

    if (usersError) throw new Error(usersError.message);

    const allowedUserIds = new Set((users || []).map((u) => Number(u.id_usuario)));

    const summary = new Map(); // category -> {activeUsers:Set, activeStories:number}
    for (const s of stories || []) {
      if (!allowedUserIds.has(Number(s.user_id))) continue;
      const key = s.venue_category;
      if (!summary.has(key)) summary.set(key, { activeUsers: new Set(), activeStories: 0 });
      const item = summary.get(key);
      item.activeStories += 1;
      item.activeUsers.add(s.user_id);
    }

    const labelMap = {
      bares: "Bares",
      discotecas: "Discotecas",
      restaurantes: "Restaurantes",
      coworkings: "Coworkings"
    };

    return [...summary.entries()].map(([key, v]) => ({
      key,
      label: labelMap[key] ?? key,
      activeUsers: v.activeUsers.size,
      activeStories: v.activeStories
    }));
  }

  async getStoriesByUser({ venue_id, user_id }) {
    const now = new Date().toISOString();

    const { data: user, error: userError } = await supabase
      .from("usuarios")
      .select("id_usuario, is_suspended")
      .eq("id_usuario", user_id)
      .maybeSingle();

    if (userError) throw new Error(userError.message);
    if (!user || user.is_suspended) return [];

    const { data, error } = await supabase
      .from("stories")
      .select(`
        id, user_id, venue_id, venue_category, media_url, created_at, expires_at,
        view_count:story_views(count),
        like_count:story_likes(count)
      `)
      .eq("venue_id", venue_id)
      .eq("user_id", user_id)
      .gt("expires_at", now)
      .order("created_at", { ascending: true });

    if (error) throw new Error(error.message);

    // Supabase devuelve los counts como [{ count: N }], normalizamos
    return (data || []).map(s => ({
      ...s,
      view_count: s.view_count?.[0]?.count ?? 0,
      like_count: s.like_count?.[0]?.count ?? 0,
    }));
  }

  // Al inicio del archivo ya tienes estos imports, no los dupliques:
// import supabase from "../../config/supabaseClient.js";
// import { v4 as uuidv4 } from "uuid";

  async uploadStory({ file, user_id, venue_id, venue_category }) {
    const ext = file.originalname.split(".").pop().toLowerCase();
    const fileName = `stories/${user_id}/${uuidv4()}.${ext}`;

    // 1) Subir a Supabase Storage (bucket: "stories")
    const { error: uploadError } = await supabase.storage
      .from("stories")
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (uploadError) throw new Error(uploadError.message);

    // 2) URL pública
    const { data: urlData } = supabase.storage
      .from("stories")
      .getPublicUrl(fileName);

    const media_url = urlData.publicUrl;

    // 3) Insertar en tabla stories — expira en 24h
    const expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const { data, error: insertError } = await supabase
      .from("stories")
      .insert({ user_id, venue_id, venue_category: venue_category ?? "bares", media_url, expires_at })
      .select()
      .single();

    if (insertError) throw new Error(insertError.message);
    return data;
  }

  async registerView({ story_id, viewer_user_id }) {
    const { error } = await supabase
      .from("story_views")
      .upsert(
        { story_id, viewer_user_id },
        { onConflict: "story_id,viewer_user_id" }
      );

    if (error) throw new Error(error.message);
    return { ok: true };
  }

  async toggleLike({ story_id, user_id }) {
    // Verificar si ya dio like
    const { data: existing } = await supabase
      .from("story_likes")
      .select("id")
      .eq("story_id", story_id)
      .eq("user_id", user_id)
      .single();

    if (existing) {
      // Ya tiene like → quitar
      await supabase
        .from("story_likes")
        .delete()
        .eq("story_id", story_id)
        .eq("user_id", user_id);

      return { liked: false };
    } else {
      // No tiene like → agregar
      await supabase
        .from("story_likes")
        .insert({ story_id, user_id });

      return { liked: true };
    }
  }

  async getStoryViews({ story_id }) {
  const { data, error } = await supabase
    .from("story_views")
    .select("viewer_user_id, viewed_at")
    .eq("story_id", story_id)
    .order("viewed_at", { ascending: false });

  if (error) throw new Error(error.message);

  const userIds = (data || []).map(v => v.viewer_user_id);
  if (!userIds.length) return [];

  const { data: users, error: usersError } = await supabase
    .from("usuarios")
    .select("id_usuario, nombre")
    .in("id_usuario", userIds);

  if (usersError) throw new Error(usersError.message);

  const usersById = new Map((users || []).map(u => [u.id_usuario, u]));

  return (data || []).map(v => ({
    user_id: v.viewer_user_id,
    nombre: usersById.get(v.viewer_user_id)?.nombre ?? null,
    foto:  null,
    viewed_at: v.viewed_at,
  }));
}

  async getStoryLikes({ story_id }) {
    const { data, error } = await supabase
      .from("story_likes")
      .select("user_id, created_at")
      .eq("story_id", story_id)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    const userIds = (data || []).map(l => l.user_id);
    if (!userIds.length) return [];

    const { data: users, error: usersError } = await supabase
      .from("usuarios")
      .select("id_usuario, nombre")
      .in("id_usuario", userIds);

    if (usersError) throw new Error(usersError.message);

    const usersById = new Map((users || []).map(u => [u.id_usuario, u]));

    return (data || []).map(l => ({
      user_id: l.user_id,
      nombre: usersById.get(l.user_id)?.nombre ?? null,
      foto: null,
      liked_at: l.created_at,
    }));
  }
  // ── Reacciones ────────────────────────────────────────────────────────────────

  async toggleReaction({ story_id, user_id, reaction }) {
    // Si ya tiene la misma reacción → la quita (toggle)
    // Si tiene otra reacción → la reemplaza
    const { data: existing } = await supabase
      .from("story_reactions")
      .select("id, reaction")
      .eq("story_id", story_id)
      .eq("user_id", user_id)
      .single();

    if (existing) {
      if (existing.reaction === reaction) {
        // Misma reacción → quitar
        await supabase.from("story_reactions").delete().eq("id", existing.id);
        return { reaction: null };
      } else {
        // Distinta reacción → reemplazar
        await supabase
          .from("story_reactions")
          .update({ reaction })
          .eq("id", existing.id);
        return { reaction };
      }
    } else {
      await supabase.from("story_reactions").insert({ story_id, user_id, reaction });
      return { reaction };
    }
  }

  async getStoryReactions({ story_id }) {
    const { data, error } = await supabase
      .from("story_reactions")
      .select("user_id, reaction, created_at")
      .eq("story_id", story_id)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    if (!data?.length) return [];

    const userIds = data.map(r => r.user_id);
    const { data: users } = await supabase
      .from("usuarios")
      .select("id_usuario, nombre")
      .in("id_usuario", userIds);

    const usersById = new Map((users || []).map(u => [u.id_usuario, u]));

    return data.map(r => ({
      user_id:   r.user_id,
      nombre:    usersById.get(r.user_id)?.nombre ?? null,
      foto:      null,
      reaction:  r.reaction,
      created_at: r.created_at,
    }));
  }

  async getStoryById({ story_id }) {
    const { data, error } = await supabase
      .from("stories")
      .select(`
        id,
        user_id,
        venue_id,
        venue_category,
        media_url,
        created_at,
        expires_at,
        view_count:story_views(count),
        like_count:story_likes(count)
      `)
      .eq("id", story_id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return null;

    return {
      ...data,
      view_count: data.view_count?.[0]?.count ?? 0,
      like_count: data.like_count?.[0]?.count ?? 0,
    };
  }

}



export default new StoriesService();