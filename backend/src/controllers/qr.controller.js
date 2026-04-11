import { generateAndUploadQr } from '../services/qr.service.js'


/**
 * Genera un código QR (PNG o PDF) para una mesa específica.
 * Ruta protegida para administradores.
 * 
 * @param {import('express').Request} req - Objeto de solicitud de Express.
 * @param {import('express').Response} res - Objeto de respuesta de Express.
 * @returns {Promise<void>}
 */

export async function generateQr(req, res) {
  const { id } = req.params
  const { format } = req.query

  try {
    const venueId = req.user?.venue_id

    if (!venueId) {
      return res.status(403).json({ error: 'Admin sin venue asignado' })
    }

    const { buffer, contentType, filename, url } = await generateAndUploadQr(
      id,
      format,
      venueId
    )

    console.log('[QR] generado para mesa:', {
      mesaId: id,
      venueId,
      url,
    })

    res.setHeader('Content-Type', contentType)
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`)
    return res.send(buffer)
  } catch (err) {
    console.error('Error generando QR de mesa:', err)

    if (err.message === 'Mesa no encontrada') {
      return res.status(404).json({ error: err.message })
    }

    if (err.message === 'Venue requerido para generar QR') {
      return res.status(400).json({ error: err.message })
    }

    return res.status(500).json({ error: 'Error interno generando QR' })
  }
}

export async function generateVenueQr(req, res) {
  const { format } = req.query

  try {
    const venueId = req.user?.venue_id

    if (!venueId) {
      return res.status(403).json({ error: 'Admin sin venue asignado' })
    }

    const { buffer, contentType, filename, url } = await generateAndUploadQr(
      null,
      format,
      venueId
    )

    console.log('[QR] generado para venue:', {
      venueId,
      url,
    })

    res.setHeader('Content-Type', contentType)
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`)
    return res.send(buffer)
  } catch (err) {
    console.error('Error generando QR de venue:', err)

    if (err.message === 'Venue requerido para generar QR') {
      return res.status(400).json({ error: err.message })
    }

    return res.status(500).json({ error: 'Error interno generando QR' })
  }
}
