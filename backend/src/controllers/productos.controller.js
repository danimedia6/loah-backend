import productoService from '../services/producto.service.js'
import { assertVenueAdmin } from '../modules/social/venue-ownership.helper.js'

/**
 * Obtiene todos los productos con filtros opcionales.
 * @param {import('express').Request} req - Objeto de solicitud de Express.
 * @param {import('express').Response} res - Objeto de respuesta de Express.
 * @returns {Promise<void>}
 */
export const getProductos = async (req, res) => {
  try {
    const { page, limit, category, search, venue_id, disponible } = req.query
    const result = await productoService.getProductos({ page, limit, category, search, venue_id, disponible })
    res.status(200).json(result)
  } catch (err) {
    console.error('Error en getProductos:')
    if (err.message === 'Categoría no encontrada') {
      return res.status(404).json({ error: err.message })
    }
    res.status(500).json({ error: err.message || 'Error interno' })
  }
}

/**
 * Obtiene un producto por su ID.
 * @param {import('express').Request} req - Objeto de solicitud de Express.
 * @param {import('express').Response} res - Objeto de respuesta de Express.
 * @returns {Promise<void>}
 */
export const getProductoById = async (req, res) => {
  const { id } = req.params
  try {
    const producto = await productoService.getProductoById(id)
    res.status(200).json(producto)
  } catch (err) {
    console.error('Error en getProductoById:')
    if (err.message === 'Producto no encontrado') {
      return res.status(404).json({ error: err.message })
    }
    res.status(500).json({ error: err.message || 'Error interno' })
  }
}

/**
 * Crea un nuevo producto.
 * @param {import('express').Request} req - Objeto de solicitud de Express.
 * @param {import('express').Response} res - Objeto de respuesta de Express.
 * @returns {Promise<void>}
 */
export const createProducto = async (req, res) => {
  try {
    // req.body is already validated by middleware, but file handling is manual
    const venueId = assertVenueAdmin(req.user, req.user?.venue_id)
    const newProduct = await productoService.createProducto(req.body, req.file, venueId)
    res.status(201).json(newProduct)
  } catch (err) {
    console.error('Error al crear producto:')
    if (err.message.includes('Ya existe')) {
      return res.status(409).json({ error: err.message })
    }
    if (err.message.includes('requerido') || err.message.includes('inválido')) {
      return res.status(400).json({ error: err.message })
    }
    res.status(err.statusCode || 500).json({ error: err.message || 'Error interno' })
  }
}

/**
 * Actualiza un producto existente.
 * @param {import('express').Request} req - Objeto de solicitud de Express.
 * @param {import('express').Response} res - Objeto de respuesta de Express.
 * @returns {Promise<void>}
 */
export const updateProducto = async (req, res) => {
  const { id } = req.params
  try {
    const venueId = assertVenueAdmin(req.user, req.user?.venue_id)
    const updatedProduct = await productoService.updateProducto(id, req.body, req.file, venueId)
    res.status(200).json(updatedProduct)
  } catch (err) {
    console.error('Error al actualizar producto:')
    if (err.message.includes('Ya existe')) {
      return res.status(409).json({ error: err.message })
    }
    res.status(err.statusCode || 500).json({ error: err.message || 'Error interno' })
  }
}

/**
 * Elimina un producto.
 * @param {import('express').Request} req - Objeto de solicitud de Express.
 * @param {import('express').Response} res - Objeto de respuesta de Express.
 * @returns {Promise<void>}
 */
export const deleteProducto = async (req, res) => {
  const { id } = req.params
  try {
    const venueId = assertVenueAdmin(req.user, req.user?.venue_id)
    await productoService.deleteProducto(id, venueId)
    res.status(204).send()
  } catch (err) {
    console.error('Error al eliminar producto:')
    res.status(err.statusCode || 500).json({ error: err.message || 'Error interno' })
  }
}

/**
 * Califica un producto.
 * @param {import('express').Request} req - Objeto de solicitud de Express.
 * @param {import('express').Response} res - Objeto de respuesta de Express.
 * @returns {Promise<void>}
 */
export const rateProduct = async (req, res) => {
  const { id } = req.params

  // Try to get ID from various possible payload fields
  const id_usuario = req.user.id || req.user.id_usuario || req.user.sub || req.user.user_id
  
  try {
    const result = await productoService.rateProduct(id, id_usuario, req.body)
    res.status(200).json(result)
  } catch (err) {
    console.error('Error in rateProduct:')
    if (err.message === 'Debes comprar y pagar el producto para calificarlo') {
      return res.status(403).json({ error: err.message })
    }
    if (err.message.includes('Puntuación inválida')) {
      return res.status(400).json({ error: err.message })
    }
    if (err.message === 'Producto no encontrado') {
      return res.status(404).json({ error: err.message })
    }
    res.status(500).json({ error: err.message || 'Error interno' })
  }
}

/**
 * Obtiene los comentarios de un producto.
 * @param {import('express').Request} req - Objeto de solicitud de Express.
 * @param {import('express').Response} res - Objeto de respuesta de Express.
 * @returns {Promise<void>}
 */
export const getProductComments = async (req, res) => {
  const { id } = req.params
  const { page, limit } = req.query
  
  try {
    const result = await productoService.getProductComments(id, { page, limit })
    res.status(200).json(result)
  } catch (err) {
    console.error('Error in getProductComments:')
    res.status(500).json({ error: err.message || 'Error interno' })
  }
}

