import multer from 'multer'

const imageFormats = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' }
let inFlightUploads = 0
const uploadsByUser = new Map()
const receivers = new WeakMap()

function uploadError(code, statusCode = 400) {
  return Object.assign(new Error('Archivo no valido'), { code, statusCode })
}

async function validateFile(file, { allowVideo, maxBytes }) {
  const { fileTypeFromBuffer } = await import('file-type')
  const detected = await fileTypeFromBuffer(file.buffer)
  if (!detected || detected.mime !== file.mimetype) throw uploadError('INVALID_UPLOAD', 415)
  if (imageFormats[detected.mime]) {
    try {
      const { default: sharp } = await import('sharp')
      const image = sharp(file.buffer, { failOn: 'warning', limitInputPixels: 16000000 })
      const metadata = await image.metadata()
      if (metadata.format !== imageFormats[detected.mime] || (metadata.pages || 1) > 1) {
        throw uploadError('INVALID_UPLOAD')
      }
      // Decode and re-encode, rather than trusting a valid-looking header alone.
      file.buffer = await image.autoOrient().toFormat(imageFormats[detected.mime]).timeout({ seconds: 3 }).toBuffer()
    } catch {
      throw uploadError('INVALID_UPLOAD')
    }
  } else if (!allowVideo || !['video/mp4', 'video/quicktime'].includes(detected.mime)) {
    throw uploadError('INVALID_UPLOAD', 415)
  }
  if (file.buffer.length > maxBytes) throw uploadError('UPLOAD_TOO_LARGE', 413)
  file.originalname = `upload.${detected.ext}`
  file.size = file.buffer.length
}

export function createValidatedUpload({ maxBytes = 5 * 1024 * 1024, maxFiles = 1, allowVideo = false,
  receptionTimeoutMs = 120000 } = {}) {
  if (!Number.isSafeInteger(receptionTimeoutMs) || receptionTimeoutMs <= 0) {
    throw new TypeError('Invalid upload reception deadline')
  }
  const allowed = [...Object.keys(imageFormats), ...(allowVideo ? ['video/mp4', 'video/quicktime'] : [])]
  const parser = multer({
    storage: multer.memoryStorage(),
    streamHandler: (req, busboy) => {
      receivers.set(req, busboy)
      req.pipe(busboy)
    },
    limits: { fileSize: maxBytes, files: maxFiles, fields: 16, parts: maxFiles + 16,
      fieldSize: 8192, fieldNameSize: 64 },
    fileFilter: (req, file, cb) => allowed.includes(file.mimetype)
      ? cb(null, true) : cb(uploadError('INVALID_UPLOAD', 415)),
  })
  const wrap = (middleware) => (req, res, next) => {
    if (!req.is('multipart/form-data')) return middleware(req, res, next)
    // All production consumers authenticate first. Missing identities share one
    // conservative slot; never use client fields or forwarded headers as identity.
    const userId = String(req.user?.id ?? req.user?.id_usuario ?? req.user?.user_id ?? 'unauthenticated')
    if (uploadsByUser.has(userId)) {
      res.set('Retry-After', '3')
      return next(uploadError('UPLOAD_USER_BUSY', 429))
    }
    if (inFlightUploads >= 2) {
      res.set('Retry-After', '3')
      return next(uploadError('UPLOAD_BUSY', 503))
    }
    inFlightUploads++
    uploadsByUser.set(userId, true)
    let released = false
    let validating = false
    let closed = false
    let receiving = true
    const timer = setTimeout(() => {
      if (closed || !receiving) return
      closed = true
      cancelReception()
      release()
      res.set('Connection', 'close')
      next(uploadError('UPLOAD_TIMEOUT', 408))
    }, receptionTimeoutMs)
    timer.unref?.()
    const release = () => {
      if (!released) {
        released = true
        inFlightUploads--
        uploadsByUser.delete(userId)
      }
    }
    const cancelReception = () => {
      clearTimeout(timer)
      const receiver = receivers.get(req)
      receivers.delete(req)
      if (receiver) {
        req.unpipe(receiver)
        // Busboy destroys its active file stream, terminating memoryStorage too.
        receiver.destroy(uploadError('INVALID_UPLOAD'))
      }
      req.pause()
    }
    const close = () => {
      closed = true
      if (receiving) cancelReception()
      clearTimeout(timer)
      req.removeListener('aborted', close)
      req.removeListener('error', close)
      res.removeListener('finish', close)
      res.removeListener('close', close)
      if (!req.complete && !req.destroyed) req.destroy()
      if (!validating) release()
    }
    req.once('aborted', close)
    req.once('error', close)
    res.once('finish', close)
    res.once('close', close)
    middleware(req, res, async (error) => {
      if (closed) { release(); return }
      receiving = false
      clearTimeout(timer)
      receivers.delete(req)
      if (error) {
        release()
        return next(error.name === 'MulterError' || error.statusCode ? error : uploadError('INVALID_UPLOAD'))
      }
      if (closed) { release(); return }
      validating = true
      try {
        for (const file of req.files || (req.file ? [req.file] : [])) {
          await validateFile(file, { allowVideo, maxBytes })
        }
        validating = false
        if (closed) { release(); return }
        next()
      } catch (error) {
        validating = false
        release()
        if (!closed) next(['INVALID_UPLOAD', 'UPLOAD_TOO_LARGE'].includes(error?.code)
          ? error : uploadError('INVALID_UPLOAD'))
      }
    })
  }
  return {
    single: (field) => wrap(parser.single(field)),
    array: (field, count) => wrap(parser.array(field, count)),
  }
}
