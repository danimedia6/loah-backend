import dotenv from 'dotenv'

dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || '.env', quiet: true })

function validateJwtSecret(value) {
  if (typeof value !== 'string' || value !== value.trim() ||
      Buffer.byteLength(value, 'utf8') < 32 ||
      /^(secret|default|changeme|change[-_ ]?me|your[-_ ]?jwt[-_ ]?secret)$/i.test(value)) {
    throw new Error('JWT_SECRET ausente o invalido; configure una clave segura de al menos 32 bytes')
  }
  return value
}

// Eager validation: importing the server fails before clients, sockets or timers start.
export const JWT_SECRET = validateJwtSecret(process.env.JWT_SECRET)
