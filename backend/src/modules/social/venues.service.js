import supabase from "../../config/supabaseClient.js";

const PUBLIC_VENUE_FIELDS = `
  id,
  name,
  category,
  city,
  description,
  logo_url,
  cover_url,
  address,
  slug,
  instagram,
  timezone,
  weekly_hours
`;

const ADMIN_VENUE_FIELDS = `
  ${PUBLIC_VENUE_FIELDS},
  updated_at
`;

const getImageExtension = (mimetype) => {
  if (mimetype === "image/png") return "png";
  if (mimetype === "image/webp") return "webp";
  return "jpg";
};

class VenuesService {
  async getVenueById(id) {
    const { data, error } = await supabase
      .from("venues")
      .select(PUBLIC_VENUE_FIELDS)
      .eq("id", id)
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async getAdminVenueById(id) {
    const { data, error } = await supabase
      .from("venues")
      .select(ADMIN_VENUE_FIELDS)
      .eq("id", id)
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async updateVenueSettings(id, { timezone, weekly_hours }) {
    const { data, error } = await supabase
      .from("venues")
      .update({
        timezone,
        weekly_hours,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select(ADMIN_VENUE_FIELDS)
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async updateVenueProfile(id, updates) {
    const { data, error } = await supabase
      .from("venues")
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select(ADMIN_VENUE_FIELDS)
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async updateVenueImage(id, kind, file) {
    const field = kind === "logo" ? "logo_url" : "cover_url";
    const ext = getImageExtension(file.mimetype);
    const bucket = process.env.VENUE_MEDIA_BUCKET || "stories";
    const filePath = `venue-media/${id}/${kind}-${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: true,
      });

    if (uploadError) throw new Error(uploadError.message);

    const { data: publicData } = supabase.storage
      .from(bucket)
      .getPublicUrl(filePath);

    const publicUrl = publicData?.publicUrl;

    const { data, error } = await supabase
      .from("venues")
      .update({
        [field]: publicUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select(ADMIN_VENUE_FIELDS)
      .single();

    if (error) throw new Error(error.message);
    return data;
  }
}

export default new VenuesService();
