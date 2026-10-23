import categoriaService from '../services/categoria.service.js'

/**
 * Obtiene todas las categorías.
 * 
 * @param {import('express').Request} req - Objeto de solicitud Express.
 * @param {import('express').Response} res - Objeto de respuesta Express.
 * @returns {Promise<void>}
 */
export const getCategorias = async (req, res) => {
  try {
    const categorias = await categoriaService.getCategorias()
    res.json(categorias)
  } catch (error) {
    console.error('Error al obtener categorías:')
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

/**
 * Obtiene una categoría por su ID.
 * 
 * @param {import('express').Request} req - Objeto de solicitud Express.
 * @param {import('express').Response} res - Objeto de respuesta Express.
 * @returns {Promise<void>}
 */
export const getCategoriaById = async (req, res) => {
  const { id } = req.params
  try {
    const categoria = await categoriaService.getCategoriaById(id)
    res.json(categoria)
  } catch (error) {
    console.error('Error al obtener categoría:')
    if (error.message === 'Categoria no encontrada') {
      return res.status(404).json({ error: error.message })
    }
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

/**
 * Crea una nueva categoría.
 * Requiere permisos de administrador.
 * 
 * @param {import('express').Request} req - Objeto de solicitud Express.
 * @param {import('express').Response} res - Objeto de respuesta Express.
 * @returns {Promise<void>}
 */
export const createCategoria = async (req, res) => {
  try {
    const nuevaCategoria = await categoriaService.createCategoria(req.body)
    res.status(201).json(nuevaCategoria)
  } catch (error) {
    console.error('Error al crear categoría:')
    if (error.message === 'Ya existe una categoría con ese nombre') {
      return res.status(409).json({ error: error.message })
    }
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

/**
 * Actualiza una categoría existente.
 * Requiere permisos de administrador.
 * 
 * @param {import('express').Request} req - Objeto de solicitud Express.
 * @param {import('express').Response} res - Objeto de respuesta Express.
 * @returns {Promise<void>}
 */
export const updateCategoria = async (req, res) => {
  const { id } = req.params
  try {
    const categoriaActualizada = await categoriaService.updateCategoria(id, req.body)
    res.json(categoriaActualizada)
  } catch (error) {
    console.error('Error al actualizar categoría:')
    if (error.message === 'Categoria no encontrada') {
      return res.status(404).json({ error: error.message })
    }
    if (error.message === 'Ya existe una categoría con ese nombre') {
      return res.status(409).json({ error: error.message })
    }
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

/**
 * Elimina una categoría.
 * Requiere permisos de administrador.
 * 
 * @param {import('express').Request} req - Objeto de solicitud Express.
 * @param {import('express').Response} res - Objeto de respuesta Express.
 * @returns {Promise<void>}
 */
export const deleteCategoria = async (req, res) => {
  const { id } = req.params
  try {
    await categoriaService.deleteCategoria(id)
    res.status(204).send()
  } catch (error) {
    console.error('Error al eliminar categoría:')
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}
