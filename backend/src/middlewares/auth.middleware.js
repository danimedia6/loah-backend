import jwt from 'jsonwebtoken'

/**
 * Middleware para verificar el token JWT.
 * @param {import('express').Request} req - Objeto de solicitud de Express.
 * @param {import('express').Response} res - Objeto de respuesta de Express.
 * @param {import('express').NextFunction} next - Función para pasar al siguiente middleware.
 */
export const authMiddleware = (req, res, next) => {
  try {
    const auth = req.headers.authorization || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
    if (!token) return res.status(401).json({ error: 'No autorizado' })

    const payload = jwt.verify(token, process.env.JWT_SECRET || 'secret')
    // small debug: attach and log basic user info to help debug role/permissions
    req.user = payload
    try {
      console.debug('[auth] token payload:', {
        id: payload.id || payload.user_id || null,
        rol: payload.rol || payload.role || null,
        venue_id: payload.venue_id || null,
      })
    } catch (e) {}
    next()
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado' })
  }
}

export const optionalAuthMiddleware = (req, res, next) => {
  try {
    const auth = req.headers.authorization || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null

    if (!token) {
      console.log('[hidden debug:auth]', {
        path: req.originalUrl || req.url,
        receivedToken: false,
        userId: null,
      })
      return next()
    }

    req.user = jwt.verify(token, process.env.JWT_SECRET || 'secret')
    console.log('[hidden debug:auth]', {
      path: req.originalUrl || req.url,
      receivedToken: true,
      userId: req.user?.id_usuario || req.user?.id || req.user?.user_id || null,
    })
    return next()
  } catch (err) {
    console.log('[hidden debug:auth]', {
      path: req.originalUrl || req.url,
      receivedToken: true,
      userId: null,
      error: err.message,
    })
    return next()
  }
}

/**
 * Middleware para requerir un rol específico.
 * @param {string} role - Rol requerido.
 * @returns {Function} Middleware de Express.
 */
export const requireRole = (role) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'No autenticado' })
  if (req.user.rol !== role) {
    try { console.warn('[auth] requireRole failed', { expected: role, actual: req.user.rol }) } catch (e) {}
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
    try { console.warn('[auth] requireAnyRole failed', { expectedAny: roles, actual: req.user.rol }) } catch (e) {}
    return res.status(403).json({ error: 'No autorizado' })
  }
  next()
}
