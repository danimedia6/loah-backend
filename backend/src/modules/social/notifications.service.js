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