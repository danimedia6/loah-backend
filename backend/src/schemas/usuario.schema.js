import Joi from 'joi'

/**
 * Esquema de validación para la creación de usuarios.
 */
export const createUsuarioSchema = Joi.object({
  nombre: Joi.string().min(3).max(100).required().messages({
    'string.base': 'El nombre debe ser un texto',
    'string.empty': 'El nombre no puede estar vacío',
    'string.min': 'El nombre debe tener al menos 3 caracteres',
    'string.max': 'El nombre no puede tener más de 100 caracteres',
    'any.required': 'El nombre es obligatorio'
  }),
  correo: Joi.string().email().required().messages({
    'string.base': 'El correo debe ser un texto',
    'string.email': 'El correo debe ser válido',
    'any.required': 'El correo es obligatorio'
  }),
  contrasena: Joi.string().min(6).required().messages({
    'string.base': 'La contraseña debe ser un texto',
    'string.min': 'La contraseña debe tener al menos 6 caracteres',
    'any.required': 'La contraseña es obligatoria'
  }),
  rol: Joi.string().valid('cliente').optional().messages({
    'string.base': 'El rol debe ser un texto',
    'any.only': 'El registro público solo permite el rol cliente'
  })
}).unknown(false)

export const createAdminSchema = createUsuarioSchema.fork('rol', (schema) => schema.forbidden())

export const changeUserRoleSchema = Joi.object({
  rol: Joi.string().valid('admin', 'cliente').required(),
}).unknown(false)

/**
 * Esquema de validación para la actualización de usuarios.
 */
export const updateUsuarioSchema = Joi.object({
  nombre: Joi.string().min(3).max(100).optional().messages({
    'string.base': 'El nombre debe ser un texto',
    'string.min': 'El nombre debe tener al menos 3 caracteres',
    'string.max': 'El nombre no puede tener más de 100 caracteres'
  }),
  correo: Joi.string().email().optional().messages({
    'string.base': 'El correo debe ser un texto',
    'string.email': 'El correo debe ser válido'
  }),
  contrasena: Joi.string().min(6).optional().messages({
    'string.base': 'La contraseña debe ser un texto',
    'string.min': 'La contraseña debe tener al menos 6 caracteres'
  }),
  currentPassword: Joi.string().min(1).optional(),
}).min(1).with('currentPassword', 'contrasena').unknown(false)

/**
 * Esquema de validación para login.
 */
export const loginSchema = Joi.object({
  correo: Joi.string().email().required().messages({
    'string.base': 'El correo debe ser un texto',
    'string.email': 'El correo debe ser válido',
    'any.required': 'El correo es obligatorio'
  }),
  contrasena: Joi.string().required().messages({
    'string.base': 'La contraseña debe ser un texto',
    'any.required': 'La contraseña es obligatoria'
  })
})
