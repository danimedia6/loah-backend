import { getIO } from './socketStore.js'
import socialService from '../modules/social/social.service.js'

const PRESENCE_EXPIRED_EVENT = 'social:presence-expired'

export async function emitPresenceUpdateForVenue(venueId, { io = null } = {}) {
  const socketServer = io || getIO()
  const normalizedVenueId = Number(venueId)

  if (!socketServer || !normalizedVenueId) return

  const socketsInVenue = await socketServer
    .in(`venue:${normalizedVenueId}`)
    .fetchSockets()
  const socketsByUserId = new Map()

  for (const venueSocket of socketsInVenue) {
    const viewerUserId = venueSocket.data.user_id

    if (!viewerUserId) continue

    const normalizedUserId = String(viewerUserId)
    const userSockets = socketsByUserId.get(normalizedUserId) || []

    userSockets.push(venueSocket)
    socketsByUserId.set(normalizedUserId, userSockets)
  }

  for (const [viewerUserId, userSockets] of socketsByUserId.entries()) {
    const activeUsers = await socialService.getActiveUsers({
      venue_id: normalizedVenueId,
      user_id: Number(viewerUserId),
      suppressPresenceExpiredEvent: true,
    })

    for (const venueSocket of userSockets) {
      venueSocket.emit('presence:update', activeUsers)
    }
  }
}

export async function emitPresenceUpdateForExpiredSessions(
  sessions,
  { io = null } = {}
) {
  const venueIds = new Set(
    (sessions || [])
      .map((session) => Number(session?.venue_id))
      .filter(Boolean)
  )

  await Promise.all(
    [...venueIds].map((venueId) =>
      emitPresenceUpdateForVenue(venueId, { io })
    )
  )
}

process.on(PRESENCE_EXPIRED_EVENT, (sessions) => {
  void emitPresenceUpdateForExpiredSessions(sessions).catch((error) => {
    console.error('❌ Error emitiendo presence:update por expiración:', error.message)
  })
})
