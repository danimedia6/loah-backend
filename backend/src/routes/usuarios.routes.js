import express from 'express'
import {
  getUsuarios,
  getUsuarioById,
  createUsuario,
  updateUsuario,
  deleteUsuario
} from '../controllers/usuarios.controller.js'
import { authMiddleware, requireRole } from '../middlewares/auth.middleware.js'
import { validate } from '../middlewares/validate.middleware.js'
import { createUsuarioSchema, updateUsuarioSchema } from '../schemas/usuario.schema.js'

const router = express.Router()

/**
 * @route GET /api/usuarios
 * @desc Obtener todos los usuarios
 * @access Private (Admin)
 */
router.get('/', authMiddleware, requireRole('admin'), getUsuarios)

/**
 * @route GET /api/usuarios/:id
 * @desc Obtener un usuario por ID
 * @access Private (Authenticated)
 */
router.get('/:id', authMiddleware, getUsuarioById)

/**
 * @route POST /api/usuarios
 * @desc Registrar un nuevo usuario cliente
 * @access Public
 */
router.post('/', validate(createUsuarioSchema), createUsuario)

/**
 * @route PUT /api/usuarios/:id
 * @desc Actualizar un usuario existente
 * @access Private (Authenticated)
 */
router.put('/:id', authMiddleware, validate(updateUsuarioSchema), updateUsuario)

/**
 * @route DELETE /api/usuarios/:id
 * @desc Eliminar un usuario
 * @access Private (Authenticated)
 */
router.delete('/:id', authMiddleware, deleteUsuario)

export default router
