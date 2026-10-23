import morgan from 'morgan'

export function safeRequestPath(req) {
  // Never log queries or arbitrary URL segments, including unmatched routes.
  const path = (req.originalUrl || req.url || '').split('?')[0]
  if (/^\/api\/social\/gifts\/redeem(?:\/|$)/i.test(path)) {
    return '/api/social/gifts/redeem/[REDACTED]'
  }
  if (req.route?.path && typeof req.route.path === 'string') {
    const area = /^\/api\/(social(?:\/(?:gifts|venues|stories|presence|chat|profile|safety|notifications))?|usuarios|auth|admin|pedidos|productos|categorias|mesas|auditoria|pagos|wompi|debug)(?=\/|$)/i.exec(path)?.[0]
    return `${area || '/api'}${req.route.path}`
  }
  return '/[UNMATCHED]'
}

export function createRequestLogger(options = {}) {
  return morgan((tokens, req, res) => {
    const method = /^[A-Z]{1,16}$/.test(req.method) ? req.method : 'OTHER'
    return `${method} ${safeRequestPath(req)} ${tokens.status(req, res) || '-'} ${tokens['response-time'](req, res) || '-'} ms`
  }, options)
}
