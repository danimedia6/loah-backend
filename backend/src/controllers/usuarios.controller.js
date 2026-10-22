import usuarioService from '../services/usuario.service.js'

/**
 * Obtiene todos los usuarios.
 * @param {import('express').Request} req - Objeto de solicitud de Express.
 * @param {import('express').Response} res - Objeto de respuesta de Express.
 * @returns {Promise<void>}
 */
export const getUsuarios = async (req, res) => {
  try {
    const usuarios = await usuarioService.getUsuarios(req.user)
    res.json(usuarios)
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message })
    console.error('Error al obtener usuarios:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

/**
 * Obtiene un usuario por su ID.
 * @param {import('express').Request} req - Objeto de solicitud de Express.
 * @param {import('express').Response} res - Objeto de respuesta de Express.
 * @returns {Promise<void>}
 */
export const getUsuarioById = async (req, res) => {
  const { id } = req.params
  try {
    const usuario = await usuarioService.getUsuarioById(id, req.user)
    res.json(usuario)
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message })
    console.error('Error al obtener usuario:', error)
    if (error.message === 'Usuario no encontrado') {
      return res.status(404).json({ error: error.message })
    }
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

/**
 * Crea un nuevo usuario.
 * @param {import('express').Request} req - Objeto de solicitud de Express.
 * @param {import('express').Response} res - Objeto de respuesta de Express.
 * @returns {Promise<void>}
 */
export const createUsuario = async (req, res) => {
  try {
    const nuevoUsuario = await usuarioService.createUsuario(req.body)
    res.status(201).json(nuevoUsuario)
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message })
    console.error('Error al crear usuario:', error)
    if (error.message === 'El correo ya está registrado') {
      return res.status(409).json({ error: error.message })
    }
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

/**
 * Actualiza un usuario existente.
 * @param {import('express').Request} req - Objeto de solicitud de Express.
 * @param {import('express').Response} res - Objeto de respuesta de Express.
 * @returns {Promise<void>}
 */
export const updateUsuario = async (req, res) => {
  const { id } = req.params
  try {
    const usuarioActualizado = await usuarioService.updateUsuario(id, req.body, req.user)
    res.json(usuarioActualizado)
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message })
    console.error('Error al actualizar usuario:', error)
    if (error.message === 'Usuario no encontrado') {
      return res.status(404).json({ error: error.message })
    }
    if (error.message === 'El correo ya está registrado') {
      return res.status(409).json({ error: error.message })
    }
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

/**
 * Rechaza temporalmente las solicitudes de eliminación física.
 * @param {import('express').Request} req - Objeto de solicitud de Express.
 * @param {import('express').Response} res - Objeto de respuesta de Express.
 * @returns {Promise<void>}
 */
export const deleteUsuario = async (req, res) => {
  const { id } = req.params
  try {
    await usuarioService.deleteUsuario(id, req.user)
  } catch (error) {
    if (error.statusCode) {
      const response = { error: error.message }
      if (error.code === 'ACCOUNT_DELETION_UNAVAILABLE') response.code = error.code
      return res.status(error.statusCode).json(response)
    }
    console.error('Error al eliminar usuario:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}
