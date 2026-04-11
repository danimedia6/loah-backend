import supabase from '../config/supabaseClient.js'

/**
 * Repositorio para la entidad Usuarios.
 * Encapsula todas las interacciones directas con la base de datos Supabase.
 */
class UsuarioRepository {
  /**
   * Obtiene todos los usuarios.
   * @returns {Promise<Array<Object>>} Lista de usuarios.
   * @throws {Error} Si ocurre un error en la consulta.
   */
  async findAll() {
    const { data, error } = await supabase
      .from('usuarios')
      .select(`
        id_usuario,
        nombre,
        correo,
        rol,
        venue_id,
        fecha_registro
      `)
      .order('nombre', { ascending: true })

    if (error) throw new Error(error.message)
    return data
  }

  /**
   * Busca un usuario por su ID.
   * @param {number} id - ID del usuario.
   * @returns {Promise<Object|null>} El usuario encontrado o null.
   * @throws {Error} Si ocurre un error en la consulta.
   */
  async findById(id) {
    const { data, error } = await supabase
      .from('usuarios')
      .select(`
        id_usuario,
        nombre,
        correo,
        rol,
        venue_id,
        fecha_registro
      `)
      .eq('id_usuario', id)
      .maybeSingle()

    if (error) throw new Error(error.message)
    return data
  }

  /**
   * Busca un usuario por su correo electrónico.
   * @param {string} correo - Correo del usuario.
   * @returns {Promise<Object|null>} El usuario encontrado o null.
   * @throws {Error} Si ocurre un error en la consulta.
   */
  async findByEmail(correo) {
    const { data, error } = await supabase
      .from('usuarios')
      .select(`
        id_usuario,
        nombre,
        correo,
        contrasena_hash,
        rol,
        venue_id,
        fecha_registro
      `)
      .eq('correo', correo)
      .maybeSingle()

    if (error) throw new Error(error.message)
    return data
  }

  /**
   * Crea un nuevo usuario.
   * @param {Object} usuarioData - Datos del usuario.
   * @returns {Promise<Object>} El usuario creado.
   * @throws {Error} Si ocurre un error en la inserción.
   */
  async create(usuarioData) {
    const { data, error } = await supabase
      .from('usuarios')
      .insert([usuarioData])
      .select(`
        id_usuario,
        nombre,
        correo,
        rol,
        venue_id,
        fecha_registro
      `)
      .single()

    if (error) throw new Error(error.message)
    return data
  }

  /**
   * Actualiza un usuario existente.
   * @param {number} id - ID del usuario.
   * @param {Object} updates - Campos a actualizar.
   * @returns {Promise<Object>} El usuario actualizado.
   * @throws {Error} Si ocurre un error en la actualización.
   */
  async update(id, updates) {
    const { data, error } = await supabase
      .from('usuarios')
      .update(updates)
      .eq('id_usuario', id)
      .select(`
        id_usuario,
        nombre,
        correo,
        rol,
        venue_id,
        fecha_registro
      `)
      .single()

    if (error) throw new Error(error.message)
    return data
  }

  /**
   * Elimina un usuario.
   * @param {number} id - ID del usuario.
   * @returns {Promise<boolean>} True si se eliminó correctamente.
   * @throws {Error} Si ocurre un error en la eliminación.
   */
  async delete(id) {
    const { error } = await supabase
      .from('usuarios')
      .delete()
      .eq('id_usuario', id)

    if (error) throw new Error(error.message)
    return true
  }
}

export default new UsuarioRepository()
