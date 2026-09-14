import mesaService from '../services/mesa.service.js'
import { assertVenueAdmin } from '../modules/social/venue-ownership.helper.js'

/**
 * Controlador para gestionar las mesas.
 */

/**
 * Obtiene todas las mesas.
 * @param {import('express').Request} req - Objeto de solicitud de Express.
 * @param {import('express').Response} res - Objeto de respuesta de Express.
 * @returns {Promise<void>}
 */
export const getMesas = async (req, res) => {
  try {
    const venueId = assertVenueAdmin(req.user, req.user?.venue_id)
    const mesas = await mesaService.getMesas({ venue_id: venueId })
    res.json(mesas)
  } catch (error) {
    console.error('Error al obtener mesas:', error)
    res.status(error.statusCode || 500).json({ error: error.message || 'Error interno del servidor' })
  }
}

/**
 * Obtiene una mesa por su ID.
 * @param {import('express').Request} req - Objeto de solicitud de Express.
 * @param {import('express').Response} res - Objeto de respuesta de Express.
 * @returns {Promise<void>}
 */
export const getMesaById = async (req, res) => {
  const { id } = req.params
  try {
    const mesa = await mesaService.getMesaById(id)
    res.json(mesa)
  } catch (error) {
    console.error('Error al obtener mesa:', error)
    if (error.message === 'Mesa no encontrada') {
      return res.status(404).json({ error: error.message })
    }
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

/**
 * Crea una nueva mesa.
 * @param {import('express').Request} req - Objeto de solicitud de Express.
 * @param {import('express').Response} res - Objeto de respuesta de Express.
 * @returns {Promise<void>}
 */
export const createMesa = async (req, res) => {
  try {
    const venueId = assertVenueAdmin(req.user, req.user?.venue_id)
    const nuevaMesa = await mesaService.createMesa(req.body, venueId)
    res.status(201).json(nuevaMesa)
  } catch (error) {
    console.error('Error al crear mesa:', error)
    res.status(error.statusCode || 500).json({ error: error.message || 'Error interno del servidor' })
  }
}

/**
 * Actualiza una mesa existente.
 * @param {import('express').Request} req - Objeto de solicitud de Express.
 * @param {import('express').Response} res - Objeto de respuesta de Express.
 * @returns {Promise<void>}
 */
export const updateMesa = async (req, res) => {
  const { id } = req.params
  try {
    const venueId = assertVenueAdmin(req.user, req.user?.venue_id)
    const mesaActualizada = await mesaService.updateMesa(id, req.body, venueId)
    res.json(mesaActualizada)
  } catch (error) {
    console.error('Error al actualizar mesa:', error)
    if (error.message === 'Mesa no encontrada') {
      return res.status(404).json({ error: error.message })
    }
    res.status(error.statusCode || 500).json({ error: error.message || 'Error interno del servidor' })
  }
}

/**
 * Elimina una mesa.
 * @param {import('express').Request} req - Objeto de solicitud de Express.
 * @param {import('express').Response} res - Objeto de respuesta de Express.
 * @returns {Promise<void>}
 */
export const deleteMesa = async (req, res) => {
  const { id } = req.params
  try {
    const venueId = assertVenueAdmin(req.user, req.user?.venue_id)
    await mesaService.deleteMesa(id, venueId)
    res.status(204).send()
  } catch (error) {
    console.error('Error al eliminar mesa:', error)
    if (error.message === 'Mesa no encontrada') {
      return res.status(404).json({ error: error.message })
    }
    res.status(error.statusCode || 500).json({ error: error.message || 'Error interno del servidor' })
  }
}
