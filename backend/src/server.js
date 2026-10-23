import './config/security.config.js'
import express from 'express'
import cors from 'cors'
import { createRequestLogger } from './middlewares/request-logging.js'
import { errorHandler } from './middlewares/errorHandler.js'
import auditoriaRoutes from './routes/auditoria.routes.js'
import mesasRoutes from './routes/mesas.route.js'
//import paymentsRoutes from './routes/payments.routes.js'
//import paymentsController from './controllers/payments.controller.js'
import pagosRoutes from './routes/pagos.routes.js'
import pedidosRoutes from './routes/pedidos.routes.js'
import productosRoutes from './routes/productos.routes.js'
import usuariosRoutes from './routes/usuarios.routes.js'
import authRoutes from './routes/auth.routes.js'
import categoriasRoutes from './routes/categorias.routes.js'
import adminRoutes from './routes/admin.routes.js'
import { mountDebugRoutes } from './routes/debug.routes.js'
import wompiRoutes from './routes/wompi.routes.js'
import socialRoutes from './modules/social/social.routes.js'
import giftsRouter from "./modules/social/gifts.router.js";
import venuesRoutes from "./modules/social/venues.routes.js";
import chatRoutes from "./modules/social/chat.routes.js";
import socialProfileRoutes from "./modules/social/social-profile.routes.js";
import safetyRoutes from "./modules/social/safety.routes.js";
import presenceRoutes from "./modules/social/presence.routes.js";
import { startPresenceExpirySweep } from "./modules/social/presence-expiry.sweep.js";

import http from 'http'
import { Server } from 'socket.io'
import { setupSocialSocket } from './sockets/social.socket.js'
import { setIO } from './sockets/socketStore.js'
import notificationsRoutes from "./modules/social/notifications.routes.js";
import profileBackgroundRoutes from "./modules/social/profile-background.routes.js";
import { compileTrustedProxies, createHttpAbuseProtection, createSocketProtection, requestIp } from './middlewares/abuse-protection.js'





/**
 * Configuración e inicialización del servidor Express.
 */

const app = express()
const trustedProxies = compileTrustedProxies(process.env.TRUSTED_PROXY_CIDRS)
app.set('trust proxy', trustedProxies)
app.disable('x-powered-by')

// Request logging
app.use(createRequestLogger())

// CORS configuration
// Accept a comma-separated list in CLIENT_URLS or a single CLIENT_URL.
const rawClientUrls = process.env.CLIENT_URLS || process.env.CLIENT_URL || ''
const configuredOrigins = rawClientUrls
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. mobile apps, curl)
    if (!origin) return callback(null, true)

    // Allow explicitly configured origins
    if (configuredOrigins.includes(origin)) return callback(null, true)

    // In non-production allow localhost/127.0.0.1 with any port to ease local development
    const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
    const isDevOrTest = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test' || !process.env.NODE_ENV
    if (isDevOrTest && isLocalhost) return callback(null, true)

    // Log rejected origins to help debug deployed CORS issues
    console.warn("[server.js] warn")
    return callback(new Error('CORS policy: This origin is not allowed'))
  },
  credentials: true, // Allow cookies/credentials to be sent
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}



app.use(cors(corsOptions))

// Necesario para Webhook de Wompi: recibir raw body
app.use(['/api/wompi/webhook', '/api/pagos/webhooks/wompi'], express.raw({ type: 'application/json', limit: '64kb' }))


// Note: avoid app.options('*', ...) because path-to-regexp rejects '*'.
// app.use(cors(corsOptions)) is sufficient to handle preflight requests.
app.use(express.json())
app.use(createHttpAbuseProtection())

app.use('/api/mesas', mesasRoutes)
//app.use('/api/payments', paymentsRoutes)
app.use('/api/auditoria', auditoriaRoutes)
app.use('/api/pagos', pagosRoutes)
app.use('/api/pedidos', pedidosRoutes)
app.use('/api/productos', productosRoutes)
app.use('/api/categorias', categoriasRoutes)
app.use('/api/usuarios', usuariosRoutes)
app.use('/api/auth', authRoutes)
app.use('/api/social', socialRoutes)
app.use("/api/social/safety", safetyRoutes);

app.use('/api/wompi', wompiRoutes)

app.use('/api/admin', adminRoutes)
mountDebugRoutes(app)
app.use("/api/social/gifts", giftsRouter);
app.use("/api/social/venues", venuesRoutes);
app.use("/api/social/presence", presenceRoutes);
app.use("/api/social/chat", chatRoutes);
app.use("/api/social/profile", socialProfileRoutes);
app.use("/api/social/notifications", notificationsRoutes);
app.use("/api/social/profile", profileBackgroundRoutes);
app.use(errorHandler)






 


const httpServer = http.createServer(app)

const socketProtection = createSocketProtection()
const io = new Server(httpServer, {
  cors: corsOptions,
  maxHttpBufferSize: 64 * 1024,
  allowRequest: (req, callback) => callback(null, socketProtection.allowHandshake(requestIp(req, trustedProxies))),
})

setIO(io)

setupSocialSocket(io)

if (process.env.NODE_ENV !== 'test') {
  startPresenceExpirySweep(io)

  httpServer.listen(process.env.PORT || 4000, () => {
    console.log("[server.js] log")
    console.log('🔌 WebSockets activos con Socket.io')
  })
}

export { app, httpServer, io }
export default app
