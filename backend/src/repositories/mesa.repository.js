import supabase from '../config/supabaseClient.js'

/**
 * Repositorio para la entidad Mesas.
 * Encapsula todas las interacciones directas con la base de datos Supabase.
 */
class MesaRepository {
  /**
   * Obtiene todas las mesas.
   * @returns {Promise<Array<Object>>} Lista de mesas.
   * @throws {Error} Si ocurre un error en la consulta.
   */
  async findAll({ venue_id } = {}) {
    let query = supabase
      .from('mesas')
      .select(`
        id_mesa,
        estado,
        ubicacion,
        venue_id
      `)

    if (venue_id) query = query.eq('venue_id', venue_id)

    const { data, error } = await query.order('id_mesa', { ascending: true })

    if (error) throw new Error(error.message)
    return data
  }

  /**
   * Busca una mesa por su ID.
   * @param {number} id - ID de la mesa.
   * @returns {Promise<Object|null>} La mesa encontrada o null.
   * @throws {Error} Si ocurre un error en la consulta.
   */
  async findById(id) {
    const { data, error } = await supabase
      .from('mesas')
      .select(`
        id_mesa,
        estado,
        ubicacion,
        venue_id
      `)
      .eq('id_mesa', id)
      .maybeSingle()

    if (error) throw new Error(error.message)
    return data
  }

  /**
   * Crea una nueva mesa.
   * @param {Object} mesaData - Datos de la mesa.
   * @returns {Promise<Object>} La mesa creada.
   * @throws {Error} Si ocurre un error en la inserción.
   */
  async create(mesaData) {
    const { data, error } = await supabase
      .from('mesas')
      .insert([mesaData])
      .select(`
        id_mesa,
        estado,
        ubicacion,
        venue_id
      `)
      .single()

    if (error) throw new Error(error.message)
    return data
  }

  /**
   * Sincroniza la secuencia de IDs de mesas.
   * Útil cuando se insertan IDs manualmente.
   * @returns {Promise<void>}
   */
  async syncIdSequence() {
    const { error } = await supabase.rpc('sync_mesas_id_sequence')
    if (error) throw new Error(error.message)
  }

  /**
   * Actualiza una mesa existente.
   * @param {number} id - ID de la mesa.
   * @param {Object} updates - Campos a actualizar.
   * @returns {Promise<Object>} La mesa actualizada.
   * @throws {Error} Si ocurre un error en la actualización.
   */
  async update(id, updates, venue_id = null) {
    let query = supabase
      .from('mesas')
      .update(updates)
      .eq('id_mesa', id)

    if (venue_id) query = query.eq('venue_id', venue_id)

    const { data, error } = await query
      .select(`
        id_mesa,
        estado,
        ubicacion,
        venue_id
      `)
      .single()

    if (error) throw new Error(error.message)
    return data
  }

  /**
   * Elimina una mesa.
   * @param {number} id - ID de la mesa.
   * @returns {Promise<boolean>} True si se eliminó correctamente.
   * @throws {Error} Si ocurre un error en la eliminación.
   */
  async delete(id, venue_id = null) {
    let query = supabase
      .from('mesas')
      .delete()
      .eq('id_mesa', id)

    if (venue_id) query = query.eq('venue_id', venue_id)

    const { error } = await query

    if (error) throw new Error(error.message)
    return true
  }
}

export default new MesaRepository()
