import pagoRepository from '../repositories/pago.repository.js'
import pedidoRepository from '../repositories/pedido.repository.js'
import wompiService from './wompi.service.js'

/**
 * Servicio para la lógica de negocio de Pagos.
 */
class PagoService {
  
  /**
   * Inicia un proceso de pago para un pedido.
   * @param {number} id_pedido - ID del pedido.
   * @returns {Promise<Object>} Datos de la transacción de pago.
   */
  async createPayment(id_pedido) {
    // 1. Validar pedido
    const pedido = await pedidoRepository.findById(id_pedido)
    if (!pedido) throw new Error('Pedido no encontrado')
    
    if (pedido.estado && pedido.estado !== 'pendiente') {
      throw new Error(`Pedido en estado inválido para pago: ${pedido.estado}`)
    }

    const amount = Number(pedido.total) || 0

    // 2. Crear transacción en Wompi
    const payment = await wompiService.createPayment({
      pedidoId: id_pedido,
      amount,
      currency: 'COP',
      metadata: { pedidoId: id_pedido }
    })

    // 3. Persistir registro de pago
    try {
      await pagoRepository.create({
        id_pedido: id_pedido,
        transaction_id: payment.transaction_id || null,
        status: 'created',
        amount: payment.amount || amount,
        currency: payment.currency || 'COP',
        raw: payment.raw || null
      })
    } catch (err) {
      console.warn('No se pudo persistir registro de pago:')
      // No lanzamos error para no interrumpir el flujo de pago al usuario,
      // pero idealmente esto debería ser transaccional o tener reintentos.
    }

    return payment
  }

  /**
   * Procesa el webhook de Wompi.
   * @param {Buffer} rawBody - Cuerpo crudo de la petición.
   * @param {string} signatureHeader - Cabecera de firma.
   * @returns {Promise<Object>} Resultado del procesamiento.
   */
  async processWebhook(rawBody, signatureHeader) {
    // 1. Verificar firma
    const verify = wompiService.verifyWebhookSignature(rawBody, signatureHeader)
    if (!verify.ok) {
      if (process.env.WOMPI_SIGNATURE_SECRET) {
        throw new Error('Firma de webhook inválida')
      } else {
        console.warn('Webhook signature verification failed (ignored in dev)')
      }
    }

    // 2. Parsear payload
    let payload
    try {
      payload = JSON.parse(rawBody.toString('utf8'))
    } catch (e) {
      throw new Error('Payload inválido')
    }

    // 3. Extraer ID de pedido
    let pedidoId = payload?.data?.object?.payment?.metadata?.pedidoId || payload?.data?.object?.metadata?.pedidoId
    
    if (!pedidoId) {
      const reference = payload?.data?.object?.payment?.reference || payload?.data?.object?.reference || null
      if (reference) {
        const m = String(reference).match(/(\d+)/)
        if (m) pedidoId = Number(m[1])
      }
    }

    if (!pedidoId) {
      console.warn('Webhook recibido sin pedidoId detectable')
      return { ok: true, reason: 'no_pedido_id' }
    }

    // 4. Determinar estado
    // 📌 Ajustado a Webhook de pruebas actuales de Wompi
    const tx = payload?.data?.transaction || payload?.data?.object?.transaction || payload?.data?.object?.payment || null

    const status = tx?.status || null
    const transactionId = tx?.id || null

    // 5. Actualizar Pago (Idempotencia)
    if (transactionId) {
      const existingPago = await pagoRepository.findByTransactionId(transactionId)
      
      const finalStatuses = new Set(['approved', 'finalized', 'paid', 'pagado', 'completed'])
      if (existingPago && existingPago.status && finalStatuses.has(String(existingPago.status).toLowerCase())) {
        return { ok: true, reason: 'already_processed' }
      }

      if (existingPago) {
        await pagoRepository.update(existingPago.id_pago, {
          transaction_id: transactionId,
          status: status ? String(status).toLowerCase() : null,
          raw: payload
        })
      } else {
        // Insertar nuevo si no existe (fallback)
        try {
          await pagoRepository.create({
            id_pedido: pedidoId,
            transaction_id: transactionId,
            status: status ? String(status).toLowerCase() : null,
            amount: payload?.data?.object?.payment?.amount_in_cents ? Number(payload.data.object.payment.amount_in_cents) / 100 : null,
            currency: payload?.data?.object?.payment?.currency || null,
            raw: payload
          })
        } catch (e) {
           // Si falla insert (race condition), intentar update
           try {
             const existing = await pagoRepository.findByTransactionId(transactionId)
             if (existing) {
                await pagoRepository.update(existing.id_pago, {
                  status: status ? String(status).toLowerCase() : null,
                  raw: payload
                })
             }
           } catch (updateErr) {
             console.error('Error en fallback update de pago:')
           }
        }
      }
    } else {
      // Fallback: buscar último pago del pedido
      const lastPago = await pagoRepository.findLastByPedidoId(pedidoId)
      if (lastPago) {
        await pagoRepository.update(lastPago.id_pago, {
          transaction_id: transactionId,
          status: status ? String(status).toLowerCase() : null,
          raw: payload
        })
      }
    }

   // 6. Actualizar Pedido
    const updates = {}
    if (['APPROVED', 'approved', 'FINALIZED', 'finalized', 'completed'].includes(status)) {
      updates.pago = 'pagado'
      updates.estado = 'pagado' // 👈🔥 ESTO ES LO QUE FALTABA
    } else if (['DECLINED', 'declined', 'FAILED'].includes(status)) {
      updates.pago = 'no_pagado'
      updates.estado = 'pendiente' // opcional
    }

    console.log("🔄 Actualizando Pedido:")
    await pedidoRepository.update(pedidoId, updates)



    return { ok: true, updated: true }
  }
}

export default new PagoService()
