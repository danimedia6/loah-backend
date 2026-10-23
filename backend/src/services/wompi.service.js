import { createHash, timingSafeEqual } from 'node:crypto'
import { assertLegacyPaymentsAvailable } from './legacy-payments.guard.js'

function webhookError(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code })
}

export const createPayment = async () => assertLegacyPaymentsAvailable()

// Wompi Colombia signs selected data values + timestamp + EVENT secret, not raw-body HMAC.
export function verifyWebhookSignature(rawBody, headerChecksum) {
  const secret = process.env.WOMPI_EVENTS_SECRET
  if (!secret || !secret.trim()) {
    throw webhookError(503, 'WOMPI_EVENTS_UNAVAILABLE', 'Validacion de eventos no disponible')
  }
  let payload
  try {
    payload = Buffer.isBuffer(rawBody) ? JSON.parse(rawBody.toString('utf8')) : rawBody
  } catch {
    throw webhookError(400, 'WOMPI_INVALID_PAYLOAD', 'Evento invalido')
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      !Number.isSafeInteger(payload.timestamp) || payload.timestamp <= 0 ||
      !payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) {
    throw webhookError(400, 'WOMPI_INVALID_PAYLOAD', 'Evento invalido')
  }
  const properties = payload.signature?.properties
  const incoming = headerChecksum || payload.signature?.checksum
  if (!Array.isArray(properties) || !properties.length || properties.length > 32 ||
      typeof incoming !== 'string' || !/^[a-f\d]{64}$/i.test(incoming)) {
    throw webhookError(400, 'WOMPI_INVALID_SIGNATURE', 'Firma de evento invalida')
  }
  const values = properties.map((property) => {
    if (typeof property !== 'string' || property.length > 200 ||
        !/^[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*$/.test(property)) {
      throw webhookError(400, 'WOMPI_INVALID_SIGNATURE', 'Firma de evento invalida')
    }
    let value = payload.data
    for (const part of property.split('.')) {
      if (['__proto__', 'prototype', 'constructor'].includes(part) ||
          value === null || typeof value !== 'object' || !Object.hasOwn(value, part)) {
        throw webhookError(400, 'WOMPI_INVALID_SIGNATURE', 'Firma de evento invalida')
      }
      value = value[part]
    }
    if (!['string', 'number', 'boolean'].includes(typeof value) ||
        (typeof value === 'number' && !Number.isFinite(value))) {
      throw webhookError(400, 'WOMPI_INVALID_SIGNATURE', 'Firma de evento invalida')
    }
    return String(value)
  })
  const expected = createHash('sha256').update(values.join('') + payload.timestamp + secret).digest()
  if (!timingSafeEqual(expected, Buffer.from(incoming, 'hex')) ||
      (headerChecksum && payload.signature?.checksum &&
        String(headerChecksum).toLowerCase() !== String(payload.signature.checksum).toLowerCase())) {
    throw webhookError(400, 'WOMPI_INVALID_SIGNATURE', 'Firma de evento invalida')
  }
  const tx = payload.data.transaction
  const environment = process.env.WOMPI_ENV === 'production' ? 'prod'
    : process.env.WOMPI_ENV === 'sandbox' ? 'test' : null
  if (!environment) throw webhookError(503, 'WOMPI_EVENTS_UNAVAILABLE', 'Validacion de eventos no disponible')
  if (payload.event !== 'transaction.updated' || payload.environment !== environment ||
      !tx || typeof tx.id !== 'string' || !tx.id || tx.id.length > 200 ||
      typeof tx.reference !== 'string' || !tx.reference || tx.reference.length > 200 ||
      !Number.isSafeInteger(tx.amount_in_cents) || tx.amount_in_cents <= 0 ||
      tx.currency !== 'COP' || !['PENDING', 'APPROVED', 'DECLINED', 'VOIDED', 'ERROR'].includes(tx.status)) {
    throw webhookError(400, 'WOMPI_INVALID_PAYLOAD', 'Evento invalido')
  }
  if (!['transaction.id', 'transaction.status', 'transaction.amount_in_cents']
    .every((field) => properties.includes(field))) {
    throw webhookError(400, 'WOMPI_INVALID_SIGNATURE', 'Firma de evento invalida')
  }
  return { ok: true, payload }
}

export default { createPayment, verifyWebhookSignature }
