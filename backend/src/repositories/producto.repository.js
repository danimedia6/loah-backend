import supabase from '../config/supabaseClient.js'

/**
 * Repositorio para la entidad Productos.
 */
class ProductoRepository {
  
  /**
   * Obtiene productos con filtros y paginación.
   * @param {Object} filters - Filtros (page, limit, category, search, venue_id, disponible).
   * @returns {Promise<Object>} Datos y conteo total.
   */
  async findAll({ page = 1, limit = 12, category, search, venue_id, disponible }) {
    const p = Math.max(parseInt(page, 10) || 1, 1)
    const l = Math.min(Math.max(parseInt(limit, 10) || 12, 1), 100)
    const start = (p - 1) * l
    const end = start + l - 1

    let query = supabase
      .from('productos')
      .select(`
        id_producto,
        nombre,
        descripcion,
        precio,
        disponible,
        venue_id,
        imagen_url,
        id_categoria,
        promedio_calificacion,
        cantidad_calificaciones,
        categorias ( id_categoria, nombre )
      `, { count: 'exact' })

    if (category) query = query.eq('id_categoria', category)
    if (venue_id) query = query.eq('venue_id', venue_id)
    if (disponible !== undefined && disponible !== null && disponible !== '') {
      query = query.eq('disponible', String(disponible) === 'true' || disponible === true)
    }
    if (search) query = query.ilike('nombre', `%${search}%`)
    
    query = query.order('nombre', { ascending: true })

    const { data, count, error } = await query.range(start, end)

    if (error) throw new Error(error.message)

    return { data, count, page: p, limit: l }
  }

  /**
   * Busca un producto por ID.
   * @param {number} id - ID del producto.
   * @returns {Promise<Object|null>} El producto encontrado.
   */
  async findById(id) {
    const { data, error } = await supabase
      .from('productos')
      .select(`
        id_producto,
        nombre,
        descripcion,
        precio,
        disponible,
        venue_id,
        imagen_url,
        id_categoria,
        promedio_calificacion,
        cantidad_calificaciones,
        categorias ( id_categoria, nombre )
      `)
      .eq('id_producto', id)
      .maybeSingle()

    if (error) throw new Error(error.message)
    return data
  }

  /**
   * Busca productos por una lista de IDs.
   * @param {Array<number>} ids - Lista de IDs.
   * @returns {Promise<Array<Object>>} Lista de productos.
   */
  async findByIds(ids) {
    if (!ids || ids.length === 0) return []
    
    const { data, error } = await supabase
      .from('productos')
      .select('id_producto, nombre, precio, disponible, venue_id')
      .in('id_producto', ids)

    if (error) throw new Error(error.message)
    return data
  }

  /**
   * Busca productos por nombre, categoría y venue (para validación de duplicados).
   * @param {string} nombre - Nombre del producto.
   * @param {number} id_categoria - ID de la categoría.
   * @returns {Promise<Array<Object>>} Lista de productos coincidentes.
   */
  async findByNameCategoryAndVenue(nombre, id_categoria, venue_id) {
    const { data, error } = await supabase
      .from('productos')
      .select('id_producto')
      .ilike('nombre', nombre)
      .eq('id_categoria', id_categoria)
      .eq('venue_id', venue_id)

    if (error) throw new Error(error.message)
    return data
  }

  /**
   * Busca productos por nombre, categoría y venue excluyendo un ID.
   * @param {string} nombre - Nombre del producto.
   * @param {number} id_producto - ID a excluir.
   * @returns {Promise<Array<Object>>} Lista de productos coincidentes.
   */
  async findByNameCategoryVenueExcludingId(nombre, id_categoria, venue_id, id_producto) {
    const { data, error } = await supabase
      .from('productos')
      .select('id_producto')
      .ilike('nombre', nombre)
      .eq('id_categoria', id_categoria)
      .eq('venue_id', venue_id)
      .neq('id_producto', id_producto)

    if (error) throw new Error(error.message)
    return data
  }

  /**
   * Crea un nuevo producto.
   * @param {Object} productoData - Datos del producto.
   * @returns {Promise<Object>} El producto creado.
   */
  async create(productoData) {
    const { data, error } = await supabase
      .from('productos')
      .insert([productoData])
      .select(`
        id_producto,
        nombre,
        descripcion,
        precio,
        disponible,
        venue_id,
        imagen_url,
        id_categoria
      `)
      .single()

    if (error) throw new Error(error.message)
    return data
  }

  /**
   * Actualiza un producto.
   * @param {number} id - ID del producto.
   * @param {Object} updates - Datos a actualizar.
   * @returns {Promise<Object>} El producto actualizado.
   */
  async update(id, updates, venue_id = null) {
    let query = supabase
      .from('productos')
      .update(updates)
      .eq('id_producto', id)

    if (venue_id) query = query.eq('venue_id', venue_id)

    const { data, error } = await query
      .select(`
        id_producto,
        nombre,
        descripcion,
        precio,
        disponible,
        venue_id,
        imagen_url,
        id_categoria
      `)
      .single()

    if (error) throw new Error(error.message)
    return data
  }

  /**
   * Elimina un producto.
   * @param {number} id - ID del producto.
   * @returns {Promise<boolean>} True si se eliminó correctamente.
   */
  async delete(id, venue_id = null) {
    let query = supabase
      .from('productos')
      .delete()
      .eq('id_producto', id)

    if (venue_id) query = query.eq('venue_id', venue_id)

    const { error } = await query

    if (error) throw new Error(error.message)
    return true
  }

  /**
   * Obtiene comentarios de un producto.
   * @param {number} productId - ID del producto.
   * @param {Object} pagination - Paginación (page, limit).
   * @returns {Promise<Object>} Comentarios paginados.
   */
  async getComments(productId, { page = 1, limit = 5 }) {
    const p = Math.max(parseInt(page, 10) || 1, 1)
    const l = Math.min(Math.max(parseInt(limit, 10) || 5, 1), 50)
    const start = (p - 1) * l
    const end = start + l - 1

    const { data, count, error } = await supabase
      .from('calificaciones_producto')
      .select('id_calificacion, puntuacion, comentario, fecha_creacion', { count: 'exact' })
      .eq('id_producto', productId)
      .order('fecha_creacion', { ascending: false })
      .range(start, end)

    if (error) throw new Error(error.message)
    return { data, count, page: p, limit: l }
  }

  /**
   * Crea o actualiza una calificación.
   * @param {Object} ratingData - Datos de la calificación.
   * @returns {Promise<Object>} La calificación creada o actualizada.
   */
  async upsertRating(ratingData) {
    const { data, error } = await supabase
      .from('calificaciones_producto')
      .upsert(ratingData, { onConflict: 'id_producto, id_usuario' })
      .select()
      .single()

    if (error) {
      if (error.code === '23503') throw new Error('Producto no encontrado')
      throw new Error(error.message)
    }
    return data
  }
}

export default new ProductoRepository()

