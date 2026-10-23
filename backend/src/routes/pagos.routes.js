import express from 'express'
import { createPayment, wompiWebhook } from '../controllers/pagos.controller.js'
import { authMiddleware } from '../middlewares/auth.middleware.js'
import { validate } from '../middlewares/validate.middleware.js'
import { createPagoSchema } from '../schemas/pago.schema.js'

const router = express.Router()

// Create payment (authenticated)
router.post('/create', authMiddleware, validate(createPagoSchema), createPayment)

// Webhook (public, verified by signature)
// Note: Ensure express.raw() is used for this route in server.js if needed, 
// or handle raw body parsing in the controller if middleware allows.
router.post('/webhooks/wompi', express.raw({ type: 'application/json', limit: '64kb' }), wompiWebhook)

export default router
