import supabase from '../../config/supabaseClient.js'
import { emitPresenceUpdateForExpiredSessions } from '../../sockets/presenceEmitter.js'

const DEFAULT_SWEEP_INTERVAL_MS = 30 * 1000

let sweepTimer = null
let isSweepRunning = false

export async function sweepExpiredPresenceSessions({ io = null, now = new Date() } = {}) {
  if (isSweepRunning) return { skipped: true, expiredCount: 0 }

  isSweepRunning = true

  try {
    const nowIso = now.toISOString()
    const { data: expiredSessions, error: selectError } = await supabase
      .from('venue_presence_sessions')
      .select('id, user_id, venue_id, valid_until, hard_expires_at')
      .eq('status', 'active')
      .or(`valid_until.lte.${nowIso},hard_expires_at.lte.${nowIso}`)

    if (selectError) throw new Error(selectError.message)

    const expiredSessionIds = (expiredSessions || []).map((session) => session.id)

    if (!expiredSessionIds.length) {
      return { skipped: false, expiredCount: 0 }
    }

    const { data: updatedSessions, error: updateError } = await supabase
      .from('venue_presence_sessions')
      .update({ status: 'expired' })
      .in('id', expiredSessionIds)
      .eq('status', 'active')
      .select('id, user_id, venue_id')

    if (updateError) throw new Error(updateError.message)

    if (updatedSessions?.length) {
      await emitPresenceUpdateForExpiredSessions(updatedSessions, { io })
    }

    return {
      skipped: false,
      expiredCount: updatedSessions?.length || 0,
    }
  } finally {
    isSweepRunning = false
  }
}

export function startPresenceExpirySweep(
  io,
  { intervalMs = DEFAULT_SWEEP_INTERVAL_MS } = {}
) {
  if (sweepTimer) return sweepTimer

  const runSweep = () => {
    void sweepExpiredPresenceSessions({ io }).catch((error) => {
      console.error('❌ Error en sweep de expiración de presencia:', error.message)
    })
  }

  sweepTimer = setInterval(runSweep, intervalMs)
  sweepTimer.unref?.()
  runSweep()

  return sweepTimer
}
