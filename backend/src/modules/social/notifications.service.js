import supabase from "../../config/supabaseClient.js";

export class NotificationsService {
  static async createNotification({
    user_id,
    actor_id = null,
    venue_id = null,
    type,
    title,
    message = null,
    metadata = {},
  }) {
    const { data, error } = await supabase
      .from("social_notifications")
      .insert({
        user_id,
        actor_id,
        venue_id,
        type,
        title,
        message,
        metadata,
      })
      .select()
      .single();

    if (error) throw error;

    return data;
  }

  static async findNotification({ user_id, actor_id, type, metadataContains = null }) {
    let query = supabase
      .from("social_notifications")
      .select("*")
      .eq("user_id", user_id)
      .eq("actor_id", actor_id)
      .eq("type", type)
      .order("created_at", { ascending: false })
      .limit(1);

    if (metadataContains) {
      query = query.contains("metadata", metadataContains);
    }

    const { data, error } = await query.maybeSingle();

    if (error) throw error;

    return data || null;
  }

  static async updateNotification({ id, title, message, metadata, is_read }) {
    const updates = {
      title,
      message,
      metadata,
    };

    if (typeof is_read === "boolean") {
      updates.is_read = is_read;
    }

    const { data, error } = await supabase
      .from("social_notifications")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    return data;
  }

  static async getMyNotifications(user_id) {
    const { data, error } = await supabase
      .from("social_notifications")
      .select("*")
      .eq("user_id", user_id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw error;

    return data ?? [];
  }

  static async markAllAsRead(user_id) {
    const { error } = await supabase
      .from("social_notifications")
      .update({ is_read: true })
      .eq("user_id", user_id)
      .eq("is_read", false);

    if (error) throw error;

    return { success: true };
  }
}
