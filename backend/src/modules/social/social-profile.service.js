import supabase from "../../config/supabaseClient.js";

class SocialProfileService {
  async getProfileByUserId(userId) {
    const { data, error } = await supabase
      .from("social_profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw new Error(error.message);

    return data;
  }

  async upsertProfile(userId, payload) {
    const allowedPayload = {
      user_id: userId,
      display_name: payload.display_name ?? null,
      foto_url: payload.foto_url ?? null,
      card_background_url: payload.card_background_url ?? null,
      bio: payload.bio ?? null,
      mood: payload.mood ?? "Disponible 🍻",
      favorite_drink: payload.favorite_drink ?? null,
      instagram: payload.instagram ?? null,
      tags: Array.isArray(payload.tags) ? payload.tags : [],
      allow_gifts: payload.allow_gifts ?? true,
      allow_chat: payload.allow_chat ?? true,
      visibility: payload.visibility ?? "public",
      theme: payload.theme ?? "default",
      updated_at: new Date().toISOString(),
      gallery_urls: Array.isArray(payload.gallery_urls)
      ? payload.gallery_urls.slice(0, 6)
      : [],
    };

    const { data, error } = await supabase
      .from("social_profiles")
      .upsert(allowedPayload, { onConflict: "user_id" })
      .select()
      .single();

    if (error) throw new Error(error.message);

    return data;
  }
}

export default new SocialProfileService();