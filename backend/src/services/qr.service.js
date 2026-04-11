import QRCode from 'qrcode'
import PDFDocument from 'pdfkit'
import stream from 'stream'
import mesaRepository from '../repositories/mesa.repository.js'
import supabase from '../config/supabaseClient.js'

/**
 * Generate a PNG buffer for a given URL.
 * @param {string} url
 * @param {number} size
 * @returns {Promise<Buffer>}
 */
export async function generatePngBuffer (url, size = 300) {
  // qrcode.toBuffer supports width option
  return QRCode.toBuffer(String(url), { type: 'png', width: size })
}

/**
 * Generate a PDF buffer that contains the QR code (and optionally text).
 * @param {string} url
 * @param {number} size
 * @returns {Promise<Buffer>}
 */
export async function generatePdfBuffer (url, size = 300) {
  // Create PNG buffer first
  const pngBuffer = await generatePngBuffer(url, size)

  const doc = new PDFDocument({ size: 'A4', margin: 50 })
  const passthrough = new stream.PassThrough()
  const chunks = []

  doc.pipe(passthrough)
  // Place QR roughly centered on the page
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right
  const x = (pageWidth - size) / 2
  const y = 150
  try {
    doc.image(pngBuffer, doc.page.margins.left + x, y, { width: size })
  } catch (err) {
    // If image insertion fails, embed as raw bytes fallback (shouldn't happen)
    console.error('Error embedding QR in PDF:', err)
  }

  doc.moveDown(2)
  doc.fontSize(12).text(url, { align: 'center' })
  doc.end()

  return new Promise((resolve, reject) => {
    passthrough.on('data', (chunk) => chunks.push(chunk))
    passthrough.on('end', () => resolve(Buffer.concat(chunks)))
    passthrough.on('error', reject)
  })
}

/**
 * Generates and optionally uploads a QR code for a specific mesa.
 * @param {number} mesaId
 * @param {string} format - 'pdf' or 'png'
 * @param {string} venueId
 * @returns {Promise<Object>} { buffer, contentType, filename, publicUrl }
 */
export async function generateAndUploadQr(mesaId, format, venueId) {
  let mesa = null

  if (mesaId) {
    mesa = await mesaRepository.findById(mesaId)
    if (!mesa) throw new Error('Mesa no encontrada')
  }

  const venue = venueId
  if (!venue) throw new Error("Venue requerido para generar QR")
  

  const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173'
  const url = mesa
  ? `${FRONTEND_URL}/m/${encodeURIComponent(venue)}/table/${encodeURIComponent(String(mesa.id_mesa))}`
  : `${FRONTEND_URL}/m/${encodeURIComponent(venue)}`

  let buffer
  let contentType
  let ext

  if (String(format).toLowerCase() === 'pdf') {
    buffer = await generatePdfBuffer(url, 300)
    contentType = 'application/pdf'
    ext = 'pdf'
  } else {
    buffer = await generatePngBuffer(url, 300)
    contentType = 'image/png'
    ext = 'png'
  }

  const filename = mesa
  ? `mesa-${mesa.id_mesa}-qr.${ext}`
  : `venue-${venue}-qr.${ext}`
  

  const saveToStorage = (process.env.SAVE_QR_TO_STORAGE || 'true') === 'true'
  let publicUrl = null

  if (saveToStorage) {
    const bucket = process.env.QR_BUCKET || 'qr-codes'
    const path = mesa
      ? `mesas/mesa-${mesa.id_mesa}/qr-${Date.now()}.${ext}`
      : `venues/venue-${venue}/qr-${Date.now()}.${ext}`
    const { error: uploadErr } = await supabase.storage
      .from(bucket)
      .upload(path, buffer, { upsert: true, contentType })

    if (uploadErr) {
      console.error('Error subiendo QR a storage:', uploadErr.message)
    } else {
      const { data: publicData } = supabase.storage.from(bucket).getPublicUrl(path)
      publicUrl = publicData?.publicUrl
    }
  }

  return { buffer, contentType, filename, publicUrl, url }
}