import usuarioRepository from '../repositories/usuario.repository.js'
import bcrypt from 'bcryptjs'
import { createUsuarioSchema, createAdminSchema, updateUsuarioSchema, changeUserRoleSchema } from '../schemas/usuario.schema.js'
import { toUsuarioResponse } from '../utils/usuario-response.js'

function userError(message, statusCode) {
  return Object.assign(new Error(message), { statusCode })
}

function getActorId(actor) {
  const id = Number(actor?.id_usuario ?? actor?.id ?? actor?.user_id)
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw userError('No autenticado', 401)
  }
  return id
}

function assertAdmin(actor) {
  getActorId(actor)
  if (actor.rol !== 'admin') throw userError('No autorizado', 403)
}

function assertAccountAccess(id, actor) {
  const actorId = getActorId(actor)
  const targetId = Number(id)
  if (!Number.isSafeInteger(targetId) || targetId <= 0) {
    throw userError('ID de usuario inválido', 400)
  }
  if (actorId !== targetId && actor.rol !== 'admin') {
    throw userError('No autorizado', 403)
  }
  return targetId
}

function validateUserData(schema, data) {
  const { error, value } = schema.validate(data, { abortEarly: false })
  if (error || !value) throw userError('Campos de usuario inválidos o no permitidos', 400)
  return value
}

/**
 * Servicio para la lógica de negocio de Usuarios.
 */
class UsuarioService {
  /**
   * Obtiene todos los usuarios.
   * @returns {Promise<Array<Object>>} Lista de usuarios.
   */
  async getUsuarios(actor) {
    assertAdmin(actor)
    const users = await usuarioRepository.findAll()
    return users.map(toUsuarioResponse)
  }

  /**
   * Obtiene un usuario por ID.
   * @param {number} id - ID del usuario.
   * @returns {Promise<Object>} El usuario encontrado.
   * @throws {Error} Si el usuario no existe.
   */
  async getUsuarioById(id, actor) {
    const targetId = assertAccountAccess(id, actor)
    const usuario = await usuarioRepository.findById(targetId)
    if (!usuario) throw userError('Usuario no encontrado', 404)
    return toUsuarioResponse(usuario)
  }

  /**
   * Crea un nuevo usuario.
   * @param {Object} data - Datos del usuario.
   * @returns {Promise<Object>} El usuario creado.
   * @throws {Error} Si el correo ya existe.
   */
  async createUsuario(data) {
    const payload = validateUserData(createUsuarioSchema, data)
    return this.#createUsuario(payload, 'cliente')
  }

  async createAdmin(data, actor) {
    assertAdmin(actor)
    const payload = validateUserData(createAdminSchema, data)
    return this.#createUsuario(payload, 'admin')
  }

  async #createUsuario({ nombre, correo, contrasena }, rol) {

    // Validar duplicados
    const existing = await usuarioRepository.findByEmail(correo)
    if (existing) {
      throw userError('El correo ya está registrado', 409)
    }

    // Hashear contraseña
    const contrasena_hash = await bcrypt.hash(contrasena, 10)
    const fecha_registro = new Date().toISOString()

    const user = await usuarioRepository.create({
      nombre,
      correo,
      contrasena_hash,
      rol,
      is_suspended: false,
      fecha_registro
    })
    return toUsuarioResponse(user)
  }

  /**
   * Actualiza un usuario.
   * @param {number} id - ID del usuario.
   * @param {Object} data - Datos a actualizar.
   * @returns {Promise<Object>} El usuario actualizado.
   * @throws {Error} Si el usuario no existe o el correo ya está en uso.
   */
  async updateUsuario(id, data, actor) {
    const targetId = assertAccountAccess(id, actor)
    const { nombre, correo, contrasena, currentPassword } = validateUserData(updateUsuarioSchema, data)

    // Verificar existencia
    const existingUser = await usuarioRepository.findById(targetId)
    if (!existingUser) throw userError('Usuario no encontrado', 404)

    // Validar duplicados si cambia el correo
    if (correo && correo !== existingUser.correo) {
      const dup = await usuarioRepository.findByEmail(correo)
      if (dup) {
        throw userError('El correo ya está registrado', 409)
      }
    }

    const updates = { nombre, correo }
    
    // Hashear nueva contraseña si se proporciona
    if (contrasena) {
      if (getActorId(actor) === targetId) {
        if (!currentPassword) throw userError('La contraseña actual es requerida', 400)
        const credentials = await usuarioRepository.findByEmail(existingUser.correo)
        const matches = await bcrypt.compare(currentPassword, credentials?.contrasena_hash || '')
        if (!matches) throw userError('Contraseña actual incorrecta', 403)
      }
      updates.contrasena_hash = await bcrypt.hash(contrasena, 10)
    }

    // Filtrar undefined
    Object.keys(updates).forEach(key => updates[key] === undefined && delete updates[key])

    const user = await usuarioRepository.update(targetId, updates)
    return toUsuarioResponse(user)
  }

  async changeUserRole(id, data, actor) {
    assertAdmin(actor)
    const targetId = assertAccountAccess(id, actor)
    const { rol } = validateUserData(changeUserRoleSchema, data)
    const user = await usuarioRepository.findById(targetId)
    if (!user) throw userError('Usuario no encontrado', 404)
    return toUsuarioResponse(await usuarioRepository.update(targetId, { rol }))
  }

  /**
   * Bloquea temporalmente la eliminación hasta disponer de un flujo seguro.
   * @param {number} id - ID del usuario.
   * @returns {Promise<void>}
   */
  async deleteUsuario(id, actor) {
    assertAccountAccess(id, actor)
    throw Object.assign(
      userError('La eliminación de cuentas está temporalmente deshabilitada. Contacta con soporte.', 409),
      { code: 'ACCOUNT_DELETION_UNAVAILABLE' }
    )
  }

  /**
   * Autentica un usuario.
   * @param {string} correo - Correo del usuario.
   * @param {string} contrasena - Contraseña en texto plano.
   * @returns {Promise<Object>} El usuario autenticado (sin hash).
   * @throws {Error} Si las credenciales son inválidas.
   */
  async authenticateUsuario(correo, contrasena) {
    const usuario = await usuarioRepository.findByEmail(correo)
    if (!usuario) {
      throw new Error('Credenciales inválidas')
    }

    const match = await bcrypt.compare(contrasena, usuario.contrasena_hash)
    if (!match || usuario.is_suspended !== false) {
      throw new Error('Credenciales inválidas')
    }

    // Eliminar hash antes de retornar
    return toUsuarioResponse(usuario)
  }
}

export default new UsuarioService()
