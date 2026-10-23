import { Router } from 'express'
import { authMiddleware, requireRole } from '../middlewares/auth.middleware.js'

export function debugRoutesEnabled() {
  return process.env.NODE_ENV === 'development' && process.env.ENABLE_DEBUG_ROUTES === 'true'
}

const router = Router()
router.use((req, res, next) => {
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
  if (!debugRoutesEnabled() || !local) return res.sendStatus(404)
  next()
})
router.use(authMiddleware, requireRole('admin'))
// Legacy order debug endpoints are retired, including in development.
router.get('/pedidos/:id', (req, res) => res.sendStatus(410))
router.post('/pedidos/:id/update', (req, res) => res.sendStatus(410))

export function mountDebugRoutes(app) {
  if (debugRoutesEnabled()) app.use('/api/debug', router)
}

export default router
