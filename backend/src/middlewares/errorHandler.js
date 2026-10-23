/**
 * Middleware global para manejo de errores.
 * @param {Error} err - Objeto de error.
 * @param {import('express').Request} req - Objeto de solicitud de Express.
 * @param {import('express').Response} res - Objeto de respuesta de Express.
 * @param {import('express').NextFunction} next - Función para pasar al siguiente middleware.
 */
export const errorHandler = (err, req, res, next) => {
  console.error("[errorHandler.js] error")
  // Do not delegate with err: Express's default logger can print private input.
  if (res.headersSent) {
    res.destroy()
    return
  }

  const candidate = err?.statusCode ?? err?.status
  const status = err?.type === 'entity.parse.failed' ? 400
    : Number.isInteger(candidate) && candidate >= 400 && candidate <= 599 ? candidate : 500
  const messages = {
    400: 'Solicitud invalida',
    401: 'No autenticado',
    403: 'No autorizado',
    404: 'Recurso no encontrado',
    409: 'Conflicto con el estado actual',
    413: 'Solicitud demasiado grande',
    415: 'Formato no admitido',
    422: 'Datos invalidos',
    429: 'Demasiadas solicitudes',
    503: 'Servicio temporalmente no disponible',
  }
  res.status(status).json({ message: messages[status] || (status >= 500
    ? 'Error interno del servidor' : 'No se pudo procesar la solicitud') })
}
