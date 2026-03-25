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
      .select("id_usuario, nombre")
      .in("id_usuario", userIds);

    if (usersError) throw new Error(usersError.message);

    const usersById = new Map((users || []).map(u => [u.id_usuario, u]));

    return userIds.map(userId => ({
      user_id: userId,
      nombre: usersById.get(userId)?.nombre ?? null,
      foto: null,
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

    const summary = new Map(); // category -> {activeUsers:Set, activeStories:number}
    for (const s of stories || []) {
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

    const { data, error } = await supabase
      .from("stories")
      .select("id, user_id, venue_id, venue_category, media_url, created_at, expires_at")
      .eq("venue_id", venue_id)
      .eq("user_id", user_id)
      .gt("expires_at", now)
      .order("created_at", { ascending: true });

    if (error) throw new Error(error.message);
    return data || [];
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
}

export default new StoriesService();