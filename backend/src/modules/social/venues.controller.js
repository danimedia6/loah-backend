import venuesService from "./venues.service.js";
import venueAccessService from "./venue-access.service.js";
import { isValidTimezone, validateWeeklyHours } from "./presence-hours.helper.js";
import { assertVenueAdmin } from "./venue-ownership.helper.js";

const PROFILE_FIELDS = ["name", "category", "city", "description", "address", "instagram"];

const sendVenueError = (res, error) => {
  if (error.statusCode) {
    return res.status(error.statusCode).json({ error: error.message });
  }

  return res.status(500).json({ error: "Error interno del servidor" });
};

const isStringOrNull = (value) => typeof value === "string" || value === null;

const cleanOptionalText = (value) => {
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
};

const cleanRequiredText = (value) => String(value ?? "").trim();

const normalizeInstagram = (value) => {
  const cleaned = cleanOptionalText(value);
  if (!cleaned) return null;

  const withoutAt = cleaned.startsWith("@") ? cleaned.slice(1) : cleaned;

  try {
    const parsed = new URL(withoutAt);
    if (!parsed.hostname.includes("instagram.com")) return null;
    const handle = parsed.pathname.split("/").filter(Boolean)[0];
    return handle || null;
  } catch {
    return withoutAt;
  }
};

const validateVenueProfilePayload = (body = {}) => {
  const extraField = Object.keys(body).find((field) => !PROFILE_FIELDS.includes(field));
  if (extraField) {
    return { error: `${extraField} no es permitido` };
  }

  const updates = {};

  if (Object.prototype.hasOwnProperty.call(body, "name")) {
    if (!isStringOrNull(body.name)) return { error: "name debe ser texto" };
    const name = cleanRequiredText(body.name);
    if (!name) return { error: "name no puede estar vacío" };
    if (name.length > 120) return { error: "name no puede superar 120 caracteres" };
    updates.name = name;
  }

  if (Object.prototype.hasOwnProperty.call(body, "category")) {
    if (!isStringOrNull(body.category)) return { error: "category debe ser texto" };
    const category = cleanRequiredText(body.category);
    if (!category) return { error: "category no puede estar vacío" };
    if (category.length > 80) return { error: "category no puede superar 80 caracteres" };
    updates.category = category;
  }

  if (Object.prototype.hasOwnProperty.call(body, "city")) {
    if (!isStringOrNull(body.city)) return { error: "city debe ser texto" };
    const city = cleanRequiredText(body.city);
    if (!city) return { error: "city no puede estar vacío" };
    if (city.length > 120) return { error: "city no puede superar 120 caracteres" };
    updates.city = city;
  }

  if (Object.prototype.hasOwnProperty.call(body, "description")) {
    if (!isStringOrNull(body.description)) return { error: "description debe ser texto" };
    const description = cleanOptionalText(body.description);
    if (description && description.length > 500) {
      return { error: "description no puede superar 500 caracteres" };
    }
    updates.description = description;
  }

  if (Object.prototype.hasOwnProperty.call(body, "address")) {
    if (!isStringOrNull(body.address)) return { error: "address debe ser texto" };
    const address = cleanOptionalText(body.address);
    if (address && address.length > 200) {
      return { error: "address no puede superar 200 caracteres" };
    }
    updates.address = address;
  }

  if (Object.prototype.hasOwnProperty.call(body, "instagram")) {
    if (!isStringOrNull(body.instagram)) return { error: "instagram debe ser texto" };
    const instagram = normalizeInstagram(body.instagram);
    if (instagram && !/^[a-zA-Z0-9._]{1,30}$/.test(instagram)) {
      return { error: "instagram inválido" };
    }
    updates.instagram = instagram;
  }

  if (Object.keys(updates).length === 0) {
    return { error: "No hay campos para actualizar" };
  }

  return { updates };
};

export const getVenueById = async (req, res) => {
  try {
    const { id } = req.params;

    const venue = await venuesService.getVenueById(id);

    res.json(venue);
  } catch (error) {
    console.error("Error obteniendo venue:");
    res.status(500).json({ error: "Error interno del servidor" });
  }
};

export const getMyVenue = async (req, res) => {
  try {
    const venueId = assertVenueAdmin(req.user, req.user?.venue_id);
    const venue = await venuesService.getAdminVenueById(venueId);

    res.json(venue);
  } catch (error) {
    console.error("Error obteniendo venue administrado:");
    sendVenueError(res, error);
  }
};

export const updateVenueSettings = async (req, res) => {
  try {
    const venueId = assertVenueAdmin(req.user, req.params.id);

    const allowedFields = ["timezone", "weekly_hours"];
    const extraField = Object.keys(req.body ?? {}).find((field) => !allowedFields.includes(field));
    if (extraField) {
      return res.status(400).json({ error: `${extraField} no es permitido` });
    }

    const { timezone, weekly_hours } = req.body ?? {};

    if (!isValidTimezone(timezone)) {
      return res.status(400).json({ error: "timezone inválida" });
    }

    const weeklyHoursError = validateWeeklyHours(weekly_hours);
    if (weeklyHoursError) {
      return res.status(400).json({ error: weeklyHoursError });
    }

    const venue = await venuesService.updateVenueSettings(venueId, {
      timezone: timezone.trim(),
      weekly_hours,
    });

    res.json(venue);
  } catch (error) {
    console.error("Error actualizando configuración del venue:");
    sendVenueError(res, error);
  }
};

export const updateVenueProfile = async (req, res) => {
  try {
    const venueId = assertVenueAdmin(req.user, req.params.id);
    const { updates, error } = validateVenueProfilePayload(req.body ?? {});

    if (error) {
      return res.status(400).json({ error });
    }

    const venue = await venuesService.updateVenueProfile(venueId, updates);

    res.json(venue);
  } catch (error) {
    console.error("Error actualizando perfil del venue:");
    sendVenueError(res, error);
  }
};

export const uploadVenueLogo = async (req, res) => {
  try {
    const venueId = assertVenueAdmin(req.user, req.params.id);

    if (!req.file) {
      return res.status(400).json({ error: "No se recibió ninguna imagen" });
    }

    const venue = await venuesService.updateVenueImage(venueId, "logo", req.file);

    res.json(venue);
  } catch (error) {
    console.error("Error subiendo logo del venue:");
    sendVenueError(res, error);
  }
};

export const uploadVenueCover = async (req, res) => {
  try {
    const venueId = assertVenueAdmin(req.user, req.params.id);

    if (!req.file) {
      return res.status(400).json({ error: "No se recibió ninguna imagen" });
    }

    const venue = await venuesService.updateVenueImage(venueId, "cover", req.file);

    res.json(venue);
  } catch (error) {
    console.error("Error subiendo cover del venue:");
    sendVenueError(res, error);
  }
};

export const generatePresenceQr = async (req, res) => {
  try {
    const venueId = assertVenueAdmin(req.user, req.params.id);

    const result = await venueAccessService.generatePresenceQr({ venue_id: venueId });

    res.status(201).json(result);
  } catch (error) {
    console.error("Error generando QR de presencia:");
    sendVenueError(res, error);
  }
};
