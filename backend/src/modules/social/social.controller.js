import socialService from './social.service.js'

const isAdminForVenue = (user, venueId) =>
  (user?.rol || user?.role) === 'admin' &&
  Number(user?.venue_id) === Number(venueId)

export const getActiveUsers = async (req, res) => {
  try {
    const { venue_id, user_id } = req.query
    const viewer_user_id =
      Number(req.user?.id_usuario || req.user?.id || req.user?.user_id || user_id) || null

    const activeUsers = await socialService.getActiveUsers({
      venue_id: venue_id ? Number(venue_id) : null,
      user_id: viewer_user_id,
    })

    res.json(activeUsers)
  } catch (error) {
    console.error('Error al obtener usuarios activos:')
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

export async function heartbeat(req, res) {
  try {
    const { venue_id, table_id } = req.body
    const user_id = Number(
      req.user?.id_usuario ||
        req.user?.id ||
        req.user?.user_id
    ) || null

    if (!user_id) {
      return res.status(401).json({ error: 'Usuario autenticado requerido' })
    }

    if (!venue_id) {
      return res.status(400).json({ error: 'venue_id es requerido' })
    }

    const venueId = Number(venue_id)
    const result = isAdminForVenue(req.user, venueId)
      ? await socialService.ensureVenueAdminPresence({
          user_id,
          authenticatedUser: req.user,
          venue_id: venueId,
          table_id: table_id ?? null,
        })
      : await socialService.heartbeat({
          user_id,
          authenticatedUser: req.user,
          venue_id: venueId,
          table_id: table_id ?? null,
        })

    return res.json(result)
  } catch (error) {
    console.error('Error en heartbeat:')
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: error.code || error.message,
        message: error.message,
      })
    }

    return res.status(500).json({ error: 'Error interno del servidor' })
  }
}
