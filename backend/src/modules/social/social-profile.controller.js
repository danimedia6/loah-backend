import socialProfileService from "./social-profile.service.js";

function getAuthUserId(req) {
  return req.user?.id || req.user?.id_usuario || req.user?.user_id;
}

export async function getMySocialProfile(req, res) {
  try {
    const userId = getAuthUserId(req);

    if (!userId) {
      return res.status(401).json({ error: "No autenticado" });
    }

    const profile = await socialProfileService.getProfileByUserId(userId);

    return res.json(profile || null);
  } catch (error) {
    console.error("Error getMySocialProfile:", error);
    return res.status(400).json({ error: error.message });
  }
}

export async function saveMySocialProfile(req, res) {
  try {
    const userId = getAuthUserId(req);

    if (!userId) {
      return res.status(401).json({ error: "No autenticado" });
    }

    const profile = await socialProfileService.upsertProfile(userId, req.body);

    return res.json(profile);
  } catch (error) {
    console.error("Error saveMySocialProfile:", error);
    return res.status(400).json({ error: error.message });
  }
}