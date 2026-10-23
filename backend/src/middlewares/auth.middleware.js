import { authenticateAccessToken } from '../services/auth-context.service.js'
import { limitAuthenticatedRequest } from './abuse-protection.js'

/**
 * Middleware para verificar el token JWT.
 * @param {import('express').Request} req - Objeto de solicitud de Express.
 * @param {import('express').Response} res - Objeto de respuesta de Express.
 * @param {import('express').NextFunction} next - Función para pasar al siguiente middleware.
 */
export const authMiddleware = async (req, res, next) => {
  try {
    const auth = req.headers.authorization || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
    if (!token) return res.status(401).json({ error: 'No autorizado' })

    req.user = await authenticateAccessToken(token)
    if (!limitAuthenticatedRequest(req, res)) return
    next()
  } catch (err) {
    return res.status(err.statusCode || 401).json({ error: err.message, code: err.code || 'AUTH_REQUIRED' })
  }
}

export const optionalAuthMiddleware = (req, res, next) => {
  if (!req.headers.authorization) return next()
  // Invalid or suspended identities must not silently become anonymous viewers.
  return authMiddleware(req, res, next)
}

/**
 * Middleware para requerir un rol específico.
 * @param {string} role - Rol requerido.
 * @returns {Function} Middleware de Express.
 */
export const requireRole = (role) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'No autenticado' })
  if (req.user.rol !== role) {
    return res.status(403).json({ error: 'No autorizado' })
  }
  next()
}

/**
 * Middleware para requerir cualquiera de los roles especificados.
 * @param {...string} roles - Roles permitidos.
 * @returns {Function} Middleware de Express.
 */
export const requireAnyRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'No autenticado' })
  if (!roles.includes(req.user.rol)) {
    return res.status(403).json({ error: 'No autorizado' })
  }
  next()
}
