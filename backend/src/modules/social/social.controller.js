import socialService from './social.service.js'

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
    console.error('Error al obtener usuarios activos:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

export async function heartbeat(req, res) {
  try {
    const { user_id, venue_id, table_id } = req.body

    if (!user_id) {
      return res.status(400).json({ error: 'user_id es requerido' })
    }

    if (!venue_id) {
      return res.status(400).json({ error: 'venue_id es requerido' })
    }

    await socialService.heartbeat({
      user_id: Number(user_id),
      venue_id: Number(venue_id),
      table_id: table_id ?? null,
    })

    return res.json({ ok: true })
  } catch (error) {
    console.error('Error en heartbeat:', error)
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
}
