import express from 'express'
import {
  getMesas,
  getMesaById,
  createMesa,
  updateMesa,
  deleteMesa
} from '../controllers/mesas.controller.js'
import { authMiddleware, requireRole } from '../middlewares/auth.middleware.js'
import { validate } from '../middlewares/validate.middleware.js'
import { createMesaSchema, updateMesaSchema } from '../schemas/mesa.schema.js'
import { generateQr, generateVenueQr } from '../controllers/qr.controller.js'

const router = express.Router()

/**
 * @route GET /api/mesas
 * @desc Obtener todas las mesas
 * @access Private (Admin)
 */
router.get('/', authMiddleware, requireRole('admin'), getMesas)

/**
 * @route GET /api/mesas/generate-venue-qr
 * @desc Generar QR del venue actual del admin
 * @access Private (Admin)
 */
router.get('/generate-venue-qr', authMiddleware, requireRole('admin'), generateVenueQr)

/**
 * @route GET /api/mesas/:id
 * @desc Obtener una mesa por ID
 * @access Public
 */
router.get('/:id', getMesaById)

/**
 * @route POST /api/mesas
 * @desc Crear una nueva mesa
 * @access Private (Admin)
 */
router.post('/', authMiddleware, requireRole('admin'), validate(createMesaSchema), createMesa)

/**
 * @route PUT /api/mesas/:id
 * @desc Actualizar una mesa existente
 * @access Private (Admin)
 */
router.put('/:id', authMiddleware, requireRole('admin'), validate(updateMesaSchema), updateMesa)

/**
 * @route DELETE /api/mesas/:id
 * @desc Eliminar una mesa
 * @access Private (Admin)
 */
router.delete('/:id', authMiddleware, requireRole('admin'), deleteMesa)

/**
 * @route GET /api/mesas/:id/generate-qr
 * @desc Generar QR para una mesa específica del venue del admin
 * @access Private (Admin)
 */
router.get('/:id/generate-qr', authMiddleware, requireRole('admin'), generateQr)

export default router
