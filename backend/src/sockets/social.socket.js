import jwt from 'jsonwebtoken'
import socialService from '../modules/social/social.service.js'
import chatService from '../modules/social/chat.service.js'

function getTokenFromSocket(socket) {
  const authToken = socket.handshake.auth?.token
  const bearerToken = socket.handshake.headers?.authorization

  if (authToken) return authToken

  if (bearerToken?.startsWith('Bearer ')) {
    return bearerToken.slice(7)
  }

  return null
}

export function setupSocialSocket(io) {
  io.use((socket, next) => {
    try {
      const token = getTokenFromSocket(socket)

      if (!token) {
        return next(new Error('No autorizado'))
      }

      const payload = jwt.verify(token, process.env.JWT_SECRET || 'secret')
      const userId = payload.id || payload.user_id || null

      if (!userId) {
        return next(new Error('Token sin usuario'))
      }

      socket.data.user = payload
      socket.data.user_id = userId
      socket.join(`user:${socket.data.user_id}`)

      next()
    } catch (error) {
      next(new Error('Token inválido o expirado'))
    }
  })

  io.on('connection', (socket) => {
    console.log('🔌 Socket autenticado:', {
      socketId: socket.id,
      userId: socket.data.user_id,
    })

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
      socket.emit('presence:error', { error: 'venue_id requerido' })
      return
    }

    socket.data.venue_id = Number(finalVenueId)
    socket.data.table_id = finalTableId

    socket.join(`venue:${finalVenueId}`)

    await socialService.heartbeat({
      user_id: socket.data.user_id,
      venue_id: Number(finalVenueId),
      table_id: finalTableId,
    })

    const socketsInVenue = await io.in(`venue:${finalVenueId}`).fetchSockets()

      for (const venueSocket of socketsInVenue) {
        const activeUsers = await socialService.getActiveUsers({
          venue_id: Number(finalVenueId),
          user_id: venueSocket.data.user_id,
        })

        venueSocket.emit('presence:update', activeUsers)
      }
    } catch (error) {
        console.error('❌ Error en social:join-venue:', error.message)
        socket.emit('presence:error', { error: error.message })
    }
    })

    socket.on('presence:heartbeat', async ({ venueId, venue_id, tableId, table_id } = {}) => {
    try {
        const finalVenueId = venueId || venue_id || socket.data.venue_id
        const finalTableId = tableId || table_id || socket.data.table_id || null

        if (!finalVenueId) {
        socket.emit('presence:error', { error: 'venue_id requerido' })
        return
        }

        await socialService.heartbeat({
        user_id: socket.data.user_id,
        venue_id: Number(finalVenueId),
        table_id: finalTableId,
        })

        const socketsInVenue = await io.in(`venue:${finalVenueId}`).fetchSockets()

          for (const venueSocket of socketsInVenue) {
            const activeUsers = await socialService.getActiveUsers({
              venue_id: Number(finalVenueId),
              user_id: venueSocket.data.user_id,
            })

            venueSocket.emit('presence:update', activeUsers)
          }
    } catch (error) {
        console.error('❌ Error en presence:heartbeat:', error.message)
        socket.emit('presence:error', { error: error.message })
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

        console.log('💬 Usuario unido a conversación:', {
        userId: socket.data.user_id,
        conversationId: finalConversationId,
        })
    } catch (error) {
        console.error('❌ Error en chat:join-conversation:', error.message)
        socket.emit('chat:error', { error: error.message })
    }
    })

    socket.on('chat:send-message', async ({ conversationId, conversation_id, message } = {}, ack) => {
    try {
        const finalConversationId = conversationId || conversation_id

        if (!finalConversationId || !message?.trim()) {
        const errorPayload = { error: 'conversation_id y message son requeridos' }
        if (ack) ack({ ok: false, ...errorPayload })
        return
        }

        const created = await chatService.sendMessage({
        conversation_id: finalConversationId,
        sender_id: socket.data.user_id,
        message,
        })

        io.to(`conversation:${finalConversationId}`).emit('chat:message-created', created)

        const conversation = await chatService._getConversationForUser({
        conversation_id: finalConversationId,
        user_id: socket.data.user_id,
        })

        const participants = [conversation.user_one_id, conversation.user_two_id]

        for (const participantId of participants) {
        const conversations = await chatService.getConversationsByUser({
            user_id: participantId,
        })

        io.to(`user:${participantId}`).emit('chat:conversations-updated', conversations)
        }

        if (ack) ack({ ok: true, message: created })
    } catch (error) {
        console.error('❌ Error en chat:send-message:', error.message)
        if (ack) ack({ ok: false, error: error.message })
    }
    })

    socket.on('disconnect', (reason) => {
      console.log('🔌 Socket desconectado:', socket.id, reason)
    })
  })
}