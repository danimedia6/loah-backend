import { JWT_SECRET } from '../config/security.config.js'
import jwt from 'jsonwebtoken'
import supabase from '../config/supabaseClient.js'

export class AuthenticationError extends Error {
  constructor(message, statusCode = 401, code = 'AUTH_REQUIRED') {
    super(message)
    this.statusCode = statusCode
    this.code = code
  }
}

export function verifyAccessToken(token) {
  try {
    if (typeof token !== 'string' || !token) throw new Error()
    const claims = jwt.verify(token, JWT_SECRET)
    if (!claims || typeof claims !== 'object') throw new Error()
    return claims
  } catch {
    throw new AuthenticationError('Token invalido o expirado')
  }
}

export async function getCurrentAuthUser(claims) {
  const rawId = claims?.id_usuario ?? claims?.id ?? claims?.user_id
  const id = Number(rawId)
  if (!['number', 'string'].includes(typeof rawId) || !/^[1-9]\d*$/.test(String(rawId)) ||
      !Number.isSafeInteger(id) || id <= 0 ||
      (claims?.exp !== undefined && Date.now() >= claims.exp * 1000)) {
    throw new AuthenticationError('Identidad invalida o token expirado')
  }
  let result
  try {
    result = await supabase.from('usuarios')
      .select('id_usuario, rol, venue_id, is_suspended')
      .eq('id_usuario', id).maybeSingle()
    if (!result || result.error) throw new Error()
  } catch {
    throw new AuthenticationError('No se pudo verificar la autorizacion', 503, 'AUTH_UNAVAILABLE')
  }
  const user = result.data
  if (!user) throw new AuthenticationError('Cuenta no disponible')
  if (user.is_suspended !== false) {
    throw new AuthenticationError('Cuenta no disponible', 403, 'AUTH_FORBIDDEN')
  }
  // Discard stale roles, venues, email and unneeded token/database attributes.
  return {
    id, id_usuario: id, user_id: id,
    rol: user.rol, venue_id: user.venue_id ?? null, is_suspended: false,
    ...(claims.exp !== undefined ? { exp: claims.exp } : {}),
  }
}

export async function authenticateAccessToken(token) {
  return getCurrentAuthUser(verifyAccessToken(token))
}
