import pagoService from '../services/pago.service.js'
export { legacyPaymentsUnavailable as createPayment } from '../services/legacy-payments.guard.js'

export const wompiWebhook = async (req, res) => {
  try {
    await pagoService.processWebhook(req.body, req.get('X-Event-Checksum'))
    return res.status(503).json({ code: 'LEGACY_PAYMENTS_UNAVAILABLE', error: 'Evento no procesado' })
  } catch (error) {
    const known = ['LEGACY_PAYMENTS_UNAVAILABLE', 'WOMPI_EVENTS_UNAVAILABLE',
      'WOMPI_INVALID_PAYLOAD', 'WOMPI_INVALID_SIGNATURE'].includes(error.code)
    return res.status(known ? error.statusCode : 500).json({
      code: known ? error.code : 'WEBHOOK_FAILED',
      error: known ? error.message : 'No se pudo procesar el evento',
    })
  }
}
