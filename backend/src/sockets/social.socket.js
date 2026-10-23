import { AuthenticationError, authenticateAccessToken, getCurrentAuthUser } from '../services/auth-context.service.js'
import socialService from '../modules/social/social.service.js'
import chatService from '../modules/social/chat.service.js'
import { setSocketInstance } from './socketInstance.js'
import { emitPresenceUpdateForVenue } from './presenceEmitter.js'

const activeSocketsByUserId = new Map()

function getTokenFromSocket(socket) {
  const authToken = socket.handshake.auth?.token
  const bearerToken = socket.handshake.headers?.authorization

  if (authToken) return authToken

  if (bearerToken?.startsWith('Bearer ')) {
    return bearerToken.slice(7)
  }

  return null
}

function addActiveSocket(userId, socketId) {
  const normalizedUserId = String(userId)
  const sockets = activeSocketsByUserId.get(normalizedUserId) || new Set()

  sockets.add(socketId)
  activeSocketsByUserId.set(normalizedUserId, sockets)
}

function removeActiveSocket(userId, socketId) {
  const normalizedUserId = String(userId)
  const sockets = activeSocketsByUserId.get(normalizedUserId)

  if (!sockets) return 0

  sockets.delete(socketId)

  if (!sockets.size) {
    activeSocketsByUserId.delete(normalizedUserId)
    return 0
  }

  return sockets.size
}

function isAdminForVenue(user, venueId) {
  return (user?.rol || user?.role) === 'admin' &&
    Number(user?.venue_id) === Number(venueId)
}

export function setupSocialSocket(io) {
  setSocketInstance(io)
  io.use(async (socket, next) => {
    try {
      const token = getTokenFromSocket(socket)

      if (!token) {
        throw new AuthenticationError('No autorizado')
      }

      socket.data.user = await authenticateAccessToken(token)
      socket.data.user_id = socket.data.user.id
      await socket.join(`user:${socket.data.user_id}`)

      next()
    } catch (error) {
      const temporarilyUnavailable = error instanceof AuthenticationError &&
        error.statusCode === 503 && error.code === 'AUTH_UNAVAILABLE'
      const connectionError = new Error(temporarilyUnavailable
        ? 'Autenticacion temporalmente no disponible' : 'Cuenta no autorizada')
      connectionError.data = {
        code: temporarilyUnavailable ? 'AUTH_TEMPORARILY_UNAVAILABLE'
          : error instanceof AuthenticationError ? error.code : 'AUTH_REQUIRED',
      }
      next(connectionError)
    }
  })

  io.on('connection', (socket) => {
    addActiveSocket(socket.data.user_id, socket.id)

    console.log('🔌 Socket autenticado:')

    socket.emit('socket:ready', {
      message: 'Socket conectado y autenticado correctamente',
      socketId: socket.id,
      userId: socket.data.user_id,
    })

    socket.on('social:join-venue', async ({ venueId, venue_id, tableId, table_id } = {}) => {
  try {
    const finalVenueId = venueId || venue_id
    const finalTableId = tableId || table_id || null

    if (!finalVenueId) {
      socket.emit('presence:error', { code: 'VENUE_MISMATCH', error: 'venue_id requerido' })
      return
    }

    const normalizedVenueId = Number(finalVenueId)
    socket.data.user = await getCurrentAuthUser(socket.data.user)

    if (isAdminForVenue(socket.data.user, normalizedVenueId)) {
      await socialService.ensureVenueAdminPresence({
        user_id: socket.data.user_id,
        authenticatedUser: socket.data.user,
        venue_id: normalizedVenueId,
        table_id: finalTableId,
      })
    } else {
      await socialService.heartbeat({
        user_id: socket.data.user_id,
        authenticatedUser: socket.data.user,
        venue_id: normalizedVenueId,
        table_id: finalTableId,
      })
    }

    socket.data.venue_id = normalizedVenueId
    socket.data.table_id = finalTableId

    socket.join(`venue:${finalVenueId}`)

    await emitPresenceUpdateForVenue(finalVenueId, { io })
    } catch (error) {
        console.error('❌ Error en social:join-venue:')
        const targetVenueId = venueId || venue_id || null

        if (targetVenueId) {
          socket.leave(`venue:${targetVenueId}`)
        }

        if (targetVenueId && Number(socket.data.venue_id) === Number(targetVenueId)) {
          delete socket.data.venue_id
          delete socket.data.table_id
        }

        socket.emit('presence:error', {
          code: error.code || 'PRESENCE_REQUIRED',
          venue_id: targetVenueId,
          error: error.message,
        })
    }
    })

    socket.on('presence:heartbeat', async ({ venueId, venue_id, tableId, table_id } = {}) => {
    try {
        const finalVenueId = venueId || venue_id || socket.data.venue_id
        const finalTableId = tableId || table_id || socket.data.table_id || null

        if (!finalVenueId) {
        socket.emit('presence:error', { code: 'VENUE_MISMATCH', error: 'venue_id requerido' })
        return
        }

        const normalizedVenueId = Number(finalVenueId)
        socket.data.user = await getCurrentAuthUser(socket.data.user)

        if (isAdminForVenue(socket.data.user, normalizedVenueId)) {
        await socialService.ensureVenueAdminPresence({
            user_id: socket.data.user_id,
            authenticatedUser: socket.data.user,
            venue_id: normalizedVenueId,
            table_id: finalTableId,
        })
        } else {
        await socialService.heartbeat({
            user_id: socket.data.user_id,
            authenticatedUser: socket.data.user,
            venue_id: normalizedVenueId,
            table_id: finalTableId,
        })
        }

        socket.data.venue_id = normalizedVenueId
        socket.data.table_id = finalTableId

        await emitPresenceUpdateForVenue(finalVenueId, { io })
    } catch (error) {
        console.error('❌ Error en presence:heartbeat:')
        const targetVenueId = venueId || venue_id || socket.data.venue_id || null

        if (targetVenueId) {
          socket.leave(`venue:${targetVenueId}`)
        }

        if (targetVenueId && Number(socket.data.venue_id) === Number(targetVenueId)) {
          delete socket.data.venue_id
          delete socket.data.table_id
        }

        socket.emit('presence:error', {
          code: error.code || 'PRESENCE_REQUIRED',
          venue_id: targetVenueId,
          error: error.message,
        })
    }
    })

    socket.on('chat:join-conversation', async ({ conversationId, conversation_id } = {}) => {
    try {
        const finalConversationId = conversationId || conversation_id

        if (!finalConversationId) {
        socket.emit('chat:error', { error: 'conversation_id requerido' })
        return
        }

        await chatService._getConversationForUser({
        conversation_id: finalConversationId,
        user_id: socket.data.user_id,
        })

        socket.join(`conversation:${finalConversationId}`)

        console.log('💬 Usuario unido a conversación:')
    } catch (error) {
        console.error('❌ Error en chat:join-conversation:')
        socket.emit('chat:error', { error: error.message })
    }
    })

    socket.on('chat:send-message', async ({ conversationId, conversation_id, message: inputMessage } = {}, ack) => {
    try {
        const finalConversationId = conversationId || conversation_id

        if (!finalConversationId || !inputMessage?.trim()) {
        const errorPayload = { error: 'conversation_id y message son requeridos' }
        if (ack) ack({ ok: false, ...errorPayload })
        return
        }

        const { message, participantIds } = await chatService.sendMessage({
        conversation_id: finalConversationId,
        sender_id: socket.data.user_id,
        message: inputMessage,
        includeParticipants: true,
        })

        const targetRooms = [
        `conversation:${finalConversationId}`,
        ...participantIds.map((participantId) => `user:${participantId}`),
        ]
        const targetSocketIds = new Set()

        for (const room of targetRooms) {
        const socketIds = io.sockets.adapter.rooms.get(room) || []
        for (const socketId of socketIds) {
            targetSocketIds.add(socketId)
        }
        }

        for (const socketId of targetSocketIds) {
        io.to(socketId).emit('chat:message-created', message)
        }

        if (ack) ack({ ok: true, message })

        const updateConversations = async () => {
        await Promise.all(
            participantIds.map(async (participantId) => {
            const conversations = await chatService.getConversationsByUser({
                user_id: participantId,
            })

            io.to(`user:${participantId}`).emit('chat:conversations-updated', conversations)
            })
        )
        }

        void Promise.allSettled([
        updateConversations(),
        ]).then((results) => {
        if (results.some((result) => result.status === 'rejected')) {
            console.error('[chat] secondary chat updates failed')
        }
        })
    } catch (error) {
        console.error("❌ Error en chat:send-message:")
        if (ack) ack({ ok: false, error: error.message })
    }
    })

    socket.on('disconnect', async (reason) => {
      console.log('🔌 Socket desconectado:')

      try {
        const remainingSockets = removeActiveSocket(socket.data.user_id, socket.id)
        const venueId = socket.data.venue_id

        if (!venueId || remainingSockets > 0) return

        await socialService.markOffline({
          user_id: socket.data.user_id,
          venue_id: Number(venueId),
        })

        await emitPresenceUpdateForVenue(venueId, { io })
      } catch (error) {
        console.error('❌ Error al actualizar presencia en disconnect:')
      }
    })
  })
}
