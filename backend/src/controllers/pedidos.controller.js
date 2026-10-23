import pedidoService from '../services/pedido.service.js'

/**
 * Obtiene todos los pedidos con filtros opcionales.
 * @param {import('express').Request} req - Objeto de solicitud de Express.
 * @param {import('express').Response} res - Objeto de respuesta de Express.
 * @returns {Promise<void>}
 */
export const getPedidos = async (req, res) => {
  try {
    const { page, limit, estado, id_mesa, id_cliente, from, to } = req.query
    const result = await pedidoService.getPedidos({ page, limit, estado, id_mesa, id_cliente, from, to })
    res.status(200).json(result)
  } catch (err) {
    console.error('Error en getPedidos:')
    res.status(500).json({ error: err.message || 'Error interno' })
  }
}

/**
 * Obtiene un pedido por su ID.
 * @param {import('express').Request} req - Objeto de solicitud de Express.
 * @param {import('express').Response} res - Objeto de respuesta de Express.
 * @returns {Promise<void>}
 */
export const getPedidoById = async (req, res) => {
  const { id } = req.params
  try {
    const result = await pedidoService.getPedidoById(id)
    res.status(200).json(result)
  } catch (err) {
    console.error('Error en getPedidoById:')
    if (err.message === 'Pedido no encontrado') {
      return res.status(404).json({ error: err.message })
    }
    res.status(500).json({ error: err.message || 'Error interno' })
  }
}

/**
 * Obtiene los pedidos del cliente autenticado.
 * @param {import('express').Request} req - Objeto de solicitud de Express.
 * @param {import('express').Response} res - Objeto de respuesta de Express.
 * @returns {Promise<void>}
 */
export const getPedidosDelCliente = async (req, res) => {
  try {
    const clienteId = req.user.id
    const pedidos = await pedidoService.getPedidosByCliente(clienteId)
    res.json({ pedidos })
  } catch (err) {
    console.error('Error en getPedidosDelCliente:')
    res.status(500).json({ error: err.message || 'Error interno' })
  }
}

/**
 * Crea un nuevo pedido.
 * @param {import('express').Request} req - Objeto de solicitud de Express.
 * @param {import('express').Response} res - Objeto de respuesta de Express.
 * @returns {Promise<void>}
 */
export const createPedido = async (req, res) => {
  try {
    const data = { ...req.body }
    console.log("Pedido recibido:");
    
    // Inject id_cliente from token if not provided, regardless of role
    if (req.user && !data.id_cliente) {
      // Try to get ID from various possible payload fields
      const userId = req.user.id || req.user.id_usuario || req.user.sub || req.user.user_id
      if (userId) {
        data.id_cliente = userId
      } else {
        console.warn('[createPedido] Could not find user ID in token payload:')
      }
    }

    const newPedido = await pedidoService.createPedido(data)
    res.status(201).json(newPedido)
  } catch (err) {
    console.error('Error al crear pedido:')
    // Simple heuristic to distinguish bad request from server error
    if (err.message.includes('requerido') || err.message.includes('inválido') || err.message.includes('no existe') || err.message.includes('no encontrado')) {
      return res.status(400).json({ error: err.message })
    }
    res.status(500).json({ error: err.message || 'Error interno' })
  }
}

/**
 * Actualiza un pedido existente.
 * @param {import('express').Request} req - Objeto de solicitud de Express.
 * @param {import('express').Response} res - Objeto de respuesta de Express.
 * @returns {Promise<void>}
 */
export const updatePedido = async (req, res) => {
  const { id } = req.params
  try {
    const updatedPedido = await pedidoService.updatePedido(id, req.body)
    res.status(200).json(updatedPedido)
  } catch (err) {
    console.error('Error al actualizar pedido:')
    if (err.message === 'Pedido no encontrado') {
      return res.status(404).json({ error: err.message })
    }
    if (err.message.includes('requerido') || err.message.includes('inválido') || err.message.includes('no existe')) {
      return res.status(400).json({ error: err.message })
    }
    res.status(500).json({ error: err.message || 'Error interno' })
  }
}

/**
 * Actualiza el estado de un pedido (staff/admin).
 * @param {import('express').Request} req - Objeto de solicitud de Express.
 * @param {import('express').Response} res - Objeto de respuesta de Express.
 * @returns {Promise<void>}
 */
export const updatePedidoEstado = async (req, res) => {
  const { id } = req.params
  try {
    const result = await pedidoService.updatePedidoEstado(id, req.body.estado)
    res.status(200).json(result.pedido || result)
  } catch (err) {
    console.error('Error en updatePedidoEstado:')
    if (err.message === 'Pedido no encontrado') {
      return res.status(404).json({ error: err.message })
    }
    if (err.message.includes('requerido') || err.message.includes('no válido') || err.message.includes('Transición inválida')) {
      return res.status(400).json({ error: err.message })
    }
    res.status(500).json({ error: err.message || 'Error interno' })
  }
}

/**
 * Actualiza la mesa de un pedido (staff/admin).
 * @param {import('express').Request} req - Objeto de solicitud de Express.
 * @param {import('express').Response} res - Objeto de respuesta de Express.
 * @returns {Promise<void>}
 */
export const updatePedidoMesa = async (req, res) => {
  const { id } = req.params
  try {
    const result = await pedidoService.updatePedidoMesa(id, req.body.id_mesa)
    res.status(200).json(result)
  } catch (err) {
    console.error('Error en updatePedidoMesa:')
    if (err.message === 'Mesa no encontrada') {
      return res.status(400).json({ error: err.message })
    }
    if (err.message.includes('requerido')) {
      return res.status(400).json({ error: err.message })
    }
    res.status(500).json({ error: err.message || 'Error interno' })
  }
}

/**
 * Actualiza el estado de pago de un pedido (staff/admin).
 * @param {import('express').Request} req - Objeto de solicitud de Express.
 * @param {import('express').Response} res - Objeto de respuesta de Express.
 * @returns {Promise<void>}
 */
export const updatePedidoPago = async (req, res) => {
  const { id } = req.params
  try {
    const result = await pedidoService.updatePedidoPago(id, req.body.pago)
    res.status(200).json(result)
  } catch (err) {
    console.error('Error en updatePedidoPago:')
    if (err.message === 'Pedido no encontrado') {
      return res.status(404).json({ error: err.message })
    }
    if (err.message.includes('requerido') || err.message.includes('no válido')) {
      return res.status(400).json({ error: err.message })
    }
    res.status(500).json({ error: err.message || 'Error interno' })
  }
}

/**
 * Elimina un pedido.
 * @param {import('express').Request} req - Objeto de solicitud de Express.
 * @param {import('express').Response} res - Objeto de respuesta de Express.
 * @returns {Promise<void>}
 */
export const deletePedido = async (req, res) => {
  const { id } = req.params
  try {
    await pedidoService.deletePedido(id)
    res.status(204).send()
  } catch (err) {
    console.error('Error al eliminar pedido:')
    res.status(400).json({ error: err.message })
  }
}


