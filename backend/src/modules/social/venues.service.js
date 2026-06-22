import supabase from "../../config/supabaseClient.js";

class VenuesService {
  async getVenueById(id) {
    const { data, error } = await supabase
      .from("venues")
      .select("id, name, category, city")
      .eq("id", id)
      .single();

    if (error) throw new Error(error.message);
    return data;
  }
}

export default new VenuesService();