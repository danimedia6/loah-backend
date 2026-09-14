import productoRepository from '../repositories/producto.repository.js'
import pedidoRepository from '../repositories/pedido.repository.js'
import supabase from '../config/supabaseClient.js'
import crypto from 'crypto'

const withStatus = (message, statusCode) => {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

/**
 * Servicio para la lógica de negocio de Productos.
 */
class ProductoService {
  
  /**
   * Obtiene productos con filtros.
   * @param {Object} filters - Filtros de búsqueda.
   * @returns {Promise<Object>} Resultados paginados.
   * @throws {Error} Si la categoría no existe.
   */
  async getProductos(filters) {
    // Validate category existence if provided
    if (filters.category) {
      const { data: catData, error } = await supabase
        .from('categorias')
        .select('id_categoria')
        .eq('id_categoria', filters.category)
        .limit(1)
      
      if (error) throw new Error('Error verificando categoría')
      if (!catData || catData.length === 0) throw new Error('Categoría no encontrada')
    }

    const { data, count, page, limit } = await productoRepository.findAll(filters)
    const totalPages = Math.ceil((count || 0) / limit) || 0

    return { page, limit, total: count || 0, totalPages, products: data }
  }

  /**
   * Obtiene un producto por ID.
   * @param {number} id - ID del producto.
   * @returns {Promise<Object>} El producto encontrado.
   * @throws {Error} Si el producto no existe.
   */
  async getProductoById(id) {
    const producto = await productoRepository.findById(id)
    if (!producto) throw new Error('Producto no encontrado')

    // Fetch last 5 comments
    try {
      const { data: comments } = await productoRepository.getComments(id, { limit: 5 })
      producto.comentarios = comments || []
    } catch (e) {
      producto.comentarios = []
    }

    return producto
  }

  /**
   * Crea un nuevo producto.
   * @param {Object} data - Datos del producto.
   * @param {Object} file - Archivo de imagen (opcional).
   * @returns {Promise<Object>} El producto creado.
   * @throws {Error} Si el nombre ya existe o falla la subida de imagen.
   */
  async createProducto(data, file, venue_id) {
    const { nombre, descripcion, precio, id_categoria, disponible } = data
    let imagen_url = data.imagen_url

    // Handle Image Upload
    if (file) {
      imagen_url = await this._uploadImage(file)
    }

    // Validate duplicates
    const existing = await productoRepository.findByNameCategoryAndVenue(nombre, id_categoria, venue_id)
    if (existing && existing.length > 0) {
      throw new Error('Ya existe un producto con ese nombre en la categoría')
    }

    const newProduct = await productoRepository.create({
      nombre,
      descripcion,
      precio,
      id_categoria,
      venue_id,
      disponible,
      imagen_url
    })

    return newProduct
  }

  /**
   * Actualiza un producto.
   * @param {number} id - ID del producto.
   * @param {Object} data - Datos a actualizar.
   * @param {Object} file - Archivo de imagen (opcional).
   * @returns {Promise<Object>} El producto actualizado.
   * @throws {Error} Si el nombre ya existe.
   */
  async updateProducto(id, data, file, venue_id) {
    const { nombre, descripcion, precio, id_categoria, disponible } = data
    let imagen_url = data.imagen_url
    const existingProduct = await productoRepository.findById(id)

    if (!existingProduct) throw withStatus('Producto no encontrado', 404)
    if (Number(existingProduct.venue_id) !== Number(venue_id)) {
      throw withStatus('No autorizado para modificar este producto', 403)
    }

    // Handle Image Upload
    if (file) {
      imagen_url = await this._uploadImage(file)
      
      // Try to delete old image
      if (existingProduct && existingProduct.imagen_url) {
        await this._deleteImage(existingProduct.imagen_url)
      }
    }

    // Validate duplicates
    if (nombre || id_categoria) {
      const duplicateName = nombre ?? existingProduct.nombre
      const duplicateCategory = id_categoria ?? existingProduct.id_categoria
      const dup = await productoRepository.findByNameCategoryVenueExcludingId(
        duplicateName,
        duplicateCategory,
        venue_id,
        id
      )
      if (dup && dup.length > 0) throw new Error('Ya existe un producto con ese nombre')
    }

    const updates = { nombre, descripcion, precio, id_categoria, disponible }
    if (imagen_url !== undefined) updates.imagen_url = imagen_url

    const updatedProduct = await productoRepository.update(id, updates, venue_id)
    return updatedProduct
  }

  /**
   * Elimina un producto.
   * @param {number} id - ID del producto.
   * @returns {Promise<void>}
   */
  async deleteProducto(id, venue_id) {
    // Try to delete image first
    const existing = await productoRepository.findById(id)
    if (!existing) throw withStatus('Producto no encontrado', 404)
    if (Number(existing.venue_id) !== Number(venue_id)) {
      throw withStatus('No autorizado para eliminar este producto', 403)
    }

    if (existing && existing.imagen_url) {
      await this._deleteImage(existing.imagen_url)
    }

    return await productoRepository.delete(id, venue_id)
  }

  /**
   * Califica un producto.
   * @param {number} productId - ID del producto.
   * @param {number} userId - ID del usuario.
   * @param {Object} ratingData - Datos de la calificación (puntuacion, comentario).
   * @returns {Promise<Object>} La calificación creada o actualizada.
   * @throws {Error} Si el usuario no ha comprado el producto o la puntuación es inválida.
   */
  async rateProduct(productId, userId, { puntuacion, comentario }) {
    // Validate Purchase
    const orders = await pedidoRepository.findByClienteId(userId)
    const paidOrders = orders.filter(o => o.pago === 'pagado')
    
    const validOrder = paidOrders.find(order => {
      if (!Array.isArray(order.items)) return false
      // Handle potential colon in productId (e.g. ":14") and type mismatch
      const cleanProductId = String(productId).replace(/^:/, '')
      return order.items.some(item => String(item.id_producto) === cleanProductId)
    })

    // Debug log to help diagnose why validation fails
    if (!validOrder) {
      console.warn(`[rateProduct] Validation failed for user ${userId} product ${productId}. Found ${paidOrders.length} paid orders.`)
      throw new Error('Debes comprar y pagar el producto para calificarlo')
    }

    if (puntuacion < 1 || puntuacion > 5) {
      throw new Error('Puntuación inválida: debe ser entre 1 y 5')
    }

    return await productoRepository.upsertRating({
      id_producto: productId,
      id_usuario: userId,
      id_pedido: validOrder.id_pedido,
      puntuacion,
      comentario
    })
  }

  /**
   * Obtiene comentarios de un producto.
   * @param {number} productId - ID del producto.
   * @param {Object} pagination - Paginación.
   * @returns {Promise<Object>} Comentarios paginados.
   */
  async getProductComments(productId, pagination) {
    const { data, count, page, limit } = await productoRepository.getComments(productId, pagination)
    const totalPages = Math.ceil((count || 0) / limit) || 0
    return { page, limit, total: count || 0, totalPages, comments: data }
  }

  // --- Private Helpers ---

  /**
   * Sube una imagen al bucket.
   * @param {Object} file - Archivo a subir.
   * @returns {Promise<string>} URL pública de la imagen.
   * @private
   */
  async _uploadImage(file) {
    const bucket = process.env.PRODUCT_IMAGES_BUCKET || 'product-images'
    const original = file.originalname || 'image'
    const safeName = original.replace(/[^a-zA-Z0-9_.-]/g, '_')
    const filename = `productos/${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${safeName}`

    const { error } = await supabase.storage
      .from(bucket)
      .upload(filename, file.buffer, { contentType: file.mimetype })

    if (error) throw new Error('Error subiendo imagen')

    const { data } = supabase.storage.from(bucket).getPublicUrl(filename)
    return data?.publicUrl || null
  }

  /**
   * Elimina una imagen del bucket.
   * @param {string} publicUrl - URL pública de la imagen.
   * @returns {Promise<void>}
   * @private
   */
  async _deleteImage(publicUrl) {
    try {
      const bucket = process.env.PRODUCT_IMAGES_BUCKET || 'product-images'
      const marker = `/storage/v1/object/public/${bucket}/`
      const idx = publicUrl.indexOf(marker)
      if (idx === -1) return

      const path = publicUrl.substring(idx + marker.length)
      await supabase.storage.from(bucket).remove([path])
    } catch (e) {
      console.warn('Error eliminando imagen:', e)
    }
  }
}

export default new ProductoService()
