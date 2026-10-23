export function assertLegacyPaymentsAvailable() {
  throw Object.assign(new Error('Los pagos heredados estan temporalmente deshabilitados'), {
    statusCode: 503,
    code: 'LEGACY_PAYMENTS_UNAVAILABLE',
  })
}

export function legacyPaymentsUnavailable(req, res) {
  try {
    assertLegacyPaymentsAvailable()
  } catch (error) {
    return res.status(error.statusCode).json({ error: error.message, code: error.code })
  }
}
