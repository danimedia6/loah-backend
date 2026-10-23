import { Router, raw } from 'express'
import { authMiddleware } from '../middlewares/auth.middleware.js'
import { crearTransaccion, webhookWompi } from '../controllers/wompi.controller.js'

const router = Router()

// Crear link de pago
router.post('/crear-transaccion', authMiddleware, crearTransaccion)

// Webhook de Wompi
router.post('/webhook', raw({ type: 'application/json', limit: '64kb' }), webhookWompi)

export default router
