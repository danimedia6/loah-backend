import venuesService from "./venues.service.js";

export const getVenueById = async (req, res) => {
  try {
    const { id } = req.params;

    const venue = await venuesService.getVenueById(id);

    res.json(venue);
  } catch (error) {
    console.error("Error obteniendo venue:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
};