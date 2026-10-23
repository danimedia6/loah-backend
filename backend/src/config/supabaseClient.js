import { createClient } from '@supabase/supabase-js'
import './security.config.js'

/**
 * Cliente de Supabase configurado con variables de entorno.
 */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

export default supabase
