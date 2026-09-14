export class VenueOwnershipError extends Error {
  constructor(message, statusCode = 403) {
    super(message);
    this.name = "VenueOwnershipError";
    this.statusCode = statusCode;
  }
}

export function assertVenueAdmin(user, venueId) {
  const targetVenueId = Number(venueId);

  if (!Number.isFinite(targetVenueId) || targetVenueId <= 0) {
    throw new VenueOwnershipError("venue_id inválido", 400);
  }

  if (!user || user.rol !== "admin") {
    throw new VenueOwnershipError("No autorizado para modificar este venue");
  }

  const adminVenueId = Number(user.venue_id);

  if (!Number.isFinite(adminVenueId) || adminVenueId <= 0) {
    throw new VenueOwnershipError("Admin sin venue asignado");
  }

  if (adminVenueId !== targetVenueId) {
    throw new VenueOwnershipError("No autorizado para modificar este venue");
  }

  return targetVenueId;
}
