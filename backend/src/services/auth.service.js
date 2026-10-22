import usuarioRepository from '../repositories/usuario.repository.js'
import bcrypt from 'bcryptjs'
import { toUsuarioResponse } from '../utils/usuario-response.js'

/**
 * Servicio para la lógica de negocio de Autenticación.
 */
class AuthService {
  
  /**
   * Valida si una contraseña es lo suficientemente fuerte.
   * @param {string} pwd - Contraseña a validar.
   * @returns {boolean} True si es válida.
   */
  isPasswordStrongEnough(pwd) {
    // >=8 chars, at least 1 uppercase, 1 number and 1 special char
    const re = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,}$/
    return re.test(pwd)
  }

  /**
   * Registra un nuevo usuario.
   * @param {Object} data - Datos del usuario (nombre, correo, contrasena).
   * @returns {Promise<Object>} El usuario creado.
   * @throws {Error} Si la validación falla o el usuario ya existe.
   */
  async signup(data) {
    const { nombre, correo, contrasena } = data

    if (!nombre || !correo || !contrasena) {
      throw new Error('nombre, correo y contrasena son requeridos')
    }

    if (!this.isPasswordStrongEnough(contrasena)) {
      throw new Error('contrasena debe tener >=8 caracteres, 1 mayúscula, 1 número y 1 símbolo')
    }

    // Verificar si el correo ya existe
    const existing = await usuarioRepository.findByEmail(correo)
    if (existing) {
      throw new Error('Este correo ya está registrado')
    }

    const contrasena_hash = await bcrypt.hash(contrasena, 10)
    const fecha_registro = new Date().toISOString()

    // Por defecto rol 'cliente'
    const user = await usuarioRepository.create({
      nombre,
      correo,
      contrasena_hash,
      rol: 'cliente',
      fecha_registro
    })
    return toUsuarioResponse(user)
  }

  /**
   * Autentica un usuario.
   * @param {string} correo - Correo del usuario.
   * @param {string} contrasena - Contraseña en texto plano.
   * @returns {Promise<Object>} El usuario autenticado (sin hash).
   * @throws {Error} Si las credenciales son inválidas.
   */
  async login(correo, contrasena) {
    const usuario = await usuarioRepository.findByEmail(correo)
    if (!usuario) {
      throw new Error('Credenciales inválidas')
    }

    const match = await bcrypt.compare(contrasena, usuario.contrasena_hash)
    if (!match) {
      throw new Error('Credenciales inválidas')
    }

    // Eliminar hash antes de retornar
    return toUsuarioResponse(usuario)
  }
}

export default new AuthService()
