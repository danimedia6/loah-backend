import venueAccessService from "./venue-access.service.js";

export const validatePresenceQr = async (req, res) => {
  try {
    const result = await venueAccessService.validateQr({
      user: req.user,
      venue_id: req.body?.venue_id,
      token: req.body?.token,
      table_id: req.body?.table_id,
    });

    res.json(result);
  } catch (error) {
    console.error("Error validando QR de presencia:", error);

    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }

    res.status(500).json({ error: "Error interno del servidor" });
  }
};
