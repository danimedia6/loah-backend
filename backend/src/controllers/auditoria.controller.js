import auditoriaService from '../services/auditoria.service.js'

/**
 * Obtiene el historial de eventos de auditoría.
 * 
 * @param {import('express').Request} req - Objeto de solicitud Express.
 * @param {import('express').Response} res - Objeto de respuesta Express.
 * @returns {Promise<void>}
 */
export const getEventos = async (req, res) => {
  try {
    const { page, limit, id_pedido, from, to } = req.query
    const result = await auditoriaService.getEventos({ page, limit, id_pedido, from, to })
    res.status(200).json(result)
  } catch (err) {
    console.error('Error obteniendo auditoría:')
    res.status(500).json({ error: 'Error interno' })
  }
}
