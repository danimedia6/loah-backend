import pagoService from '../services/pago.service.js'

/**
 * Crea un nuevo pago para un pedido.
 * @param {import('express').Request} req - Objeto de solicitud de Express.
 * @param {import('express').Response} res - Objeto de respuesta de Express.
 * @returns {Promise<void>}
 */
export const createPayment = async (req, res) => {
  try {
    const { id_pedido } = req.body
    const payment = await pagoService.createPayment(id_pedido)
    res.status(200).json({ payment })
  } catch (err) {
    console.error('Error crear pago:')
    if (err.message === 'Pedido no encontrado') {
      return res.status(404).json({ error: err.message })
    }
    if (err.message.includes('estado inválido')) {
      return res.status(400).json({ error: err.message })
    }
    res.status(500).json({ error: 'Error interno creando pago' })
  }
}

/**
 * Maneja el webhook de Wompi para actualizaciones de estado de pago.
 * @param {import('express').Request} req - Objeto de solicitud de Express.
 * @param {import('express').Response} res - Objeto de respuesta de Express.
 * @returns {Promise<void>}
 */
export const wompiWebhook = async (req, res) => {
  try {
    const rawBody = req.body
    const signatureHeader = req.get('Wompi-Signature') || req.get('x-wompi-signature') || req.get('signature')

    const result = await pagoService.processWebhook(rawBody, signatureHeader)
    res.status(200).json(result)
  } catch (err) {
    console.error('Error manejando webhook wompi:')
    if (err.message === 'Firma de webhook inválida' || err.message === 'Payload inválido') {
      return res.status(400).json({ error: err.message })
    }
    res.status(500).json({ error: 'Error interno' })
  }
}
