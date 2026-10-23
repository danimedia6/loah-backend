import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import proxyaddr from 'proxy-addr'

export function createBudget({ limit, windowMs, maxKeys = 20000, now = Date.now }) {
  const entries = new Map()
  return {
    consume(key) {
      const time = now()
      let entry = entries.get(key)
      if (!entry || entry.until <= time) {
        if (entries.size >= maxKeys) {
          for (const [id, value] of entries) if (value.until <= time) entries.delete(id)
          if (entries.size >= maxKeys) return { allowed: false, retryAfter: Math.ceil(windowMs / 1000) }
        }
        entry = { count: 0, until: time + windowMs }
        entries.set(key, entry)
      }
      entry.count++
      return { allowed: entry.count <= limit, retryAfter: Math.max(1, Math.ceil((entry.until - time) / 1000)) }
    },
  }
}

export function compileTrustedProxies(value = '') {
  if (!value.trim()) return () => false
  const cidrs = value.split(',').map((item) => item.trim())
  for (const cidr of cidrs) {
    const [ip, prefix, ...extra] = cidr.split('/')
    const version = isIP(ip)
    if (!version || extra.length || (prefix !== undefined &&
        (!/^\d+$/.test(prefix) || Number(prefix) === 0 || Number(prefix) > (version === 4 ? 32 : 128)))) {
      throw new Error('TRUSTED_PROXY_CIDRS invalido; requiere IPs o CIDRs explicitos')
    }
  }
  return proxyaddr.compile(cidrs)
}

export function requestIp(req, trust = () => false) {
  try { return proxyaddr(req, trust) } catch { return req.socket?.remoteAddress || 'unknown' }
}

function rejectLimit(res, result) {
  res.set('Retry-After', String(result.retryAfter))
  return res.status(429).json({ code: 'RATE_LIMITED', error: 'Demasiadas solicitudes; intenta mas tarde' })
}

export function createHttpAbuseProtection() {
  const general = createBudget({ limit: 3000, windowMs: 300000 })
  const login = createBudget({ limit: 120, windowMs: 900000 })
  // A venue Wi-Fi shares one public IP during arrival; retain a bounded budget.
  const signup = createBudget({ limit: 120, windowMs: 900000 })
  const writes = createBudget({ limit: 600, windowMs: 60000 })
  const identities = createBudget({ limit: 20, windowMs: 900000 })
  return (req, res, next) => {
    const path = req.path.toLowerCase().replace(/\/+$/, '')
    // Payment providers retry from shared IPs. These contained endpoints have
    // bounded bodies/signature work and no DB effects; do not apply user limits.
    if (req.method === 'POST' && ['/api/wompi/webhook', '/api/pagos/webhooks/wompi'].includes(path)) return next()
    let result = general.consume(req.ip)
    if (!result.allowed) return rejectLimit(res, result)
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      result = writes.consume(req.ip)
      if (!result.allowed) return rejectLimit(res, result)
    }
    if (req.method === 'POST' && ['/api/auth/login', '/api/auth/signup', '/api/usuarios'].includes(path)) {
      const budget = path === '/api/auth/login' ? login : signup
      result = budget.consume(req.ip)
      if (!result.allowed) return rejectLimit(res, result)
      if (path === '/api/auth/login' && typeof req.body?.correo === 'string') {
        const digest = createHash('sha256').update(req.body.correo.trim().toLowerCase()).digest('hex')
        result = identities.consume(digest)
        if (!result.allowed) return rejectLimit(res, result)
      }
    }
    next()
  }
}

const categories = {
  read: createBudget({ limit: 600, windowMs: 60000 }),
  write: createBudget({ limit: 120, windowMs: 60000 }),
  qr: createBudget({ limit: 20, windowMs: 60000 }),
  report: createBudget({ limit: 10, windowMs: 900000 }),
  upload: createBudget({ limit: 12, windowMs: 60000 }),
}

export function limitAuthenticatedRequest(req, res) {
  const path = req.originalUrl.split('?')[0].toLowerCase().replace(/\/+$/, '')
  const category = ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? 'read'
    : /\/validate-qr\/?$/.test(path) ? 'qr'
    : /\/reports\//.test(path) ? 'report'
    : /\/(upload|avatar|background|gallery|logo|cover)\/?$/.test(path) ? 'upload' : 'write'
  const result = categories[category].consume(String(req.user.id))
  if (!result.allowed) { rejectLimit(res, result); return false }
  return true
}

export function createSocketProtection() {
  const attempts = createBudget({ limit: 120, windowMs: 60000 })
  const packets = createBudget({ limit: 180, windowMs: 60000 })
  return {
    allowHandshake: (key) => attempts.consume(key).allowed,
    allowPacket: (userId) => packets.consume(String(userId)).allowed,
  }
}
