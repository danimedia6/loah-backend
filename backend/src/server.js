import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import auditoriaRoutes from './routes/auditoria.routes.js'
import mesasRoutes from './routes/mesas.route.js'
//import paymentsRoutes from './routes/payments.routes.js'
//import paymentsController from './controllers/payments.controller.js'
import pagosRoutes from './routes/pagos.routes.js'
import { wompiWebhook } from './controllers/pagos.controller.js'
import pedidosRoutes from './routes/pedidos.routes.js'
import productosRoutes from './routes/productos.routes.js'
import usuariosRoutes from './routes/usuarios.routes.js'
import authRoutes from './routes/auth.routes.js'
import categoriasRoutes from './routes/categorias.routes.js'
import adminRoutes from './routes/admin.routes.js'
import debugRoutes from './routes/debug.routes.js'
import wompiRoutes from './routes/wompi.routes.js'
import socialRoutes from './modules/social/social.routes.js'
import giftsRouter from "./modules/social/gifts.router.js";
import venuesRoutes from "./modules/social/venues.routes.js";
import chatRoutes from "./modules/social/chat.routes.js";
import socialProfileRoutes from "./modules/social/social-profile.routes.js";

import http from 'http'
import { Server } from 'socket.io'
import { setupSocialSocket } from './sockets/social.socket.js'
import { setIO } from './sockets/socketStore.js'




/**
 * Configuración e inicialización del servidor Express.
 */

const app = express()

// Request logging
app.use(morgan('dev'))

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
    console.warn(`CORS: rejecting origin '${origin}' (allowed: ${configuredOrigins.length ? configuredOrigins.join(',') : 'none'})`)
    return callback(new Error('CORS policy: This origin is not allowed'))
  },
  credentials: true, // Allow cookies/credentials to be sent
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}



app.use(cors(corsOptions))

// Necesario para Webhook de Wompi: recibir raw body
app.use('/api/wompi/webhook', express.raw({ type: 'application/json' }))


// Note: avoid app.options('*', ...) because path-to-regexp rejects '*'.
// app.use(cors(corsOptions)) is sufficient to handle preflight requests.
app.use(express.json())

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

app.use('/api/wompi', wompiRoutes)

app.use('/api/admin', adminRoutes)
// Debug routes (local only) - no auth. Remove before deploying.
app.use('/api/debug', debugRoutes)
app.use("/api/social/gifts", giftsRouter);
app.use("/api/social/venues", venuesRoutes);
app.use("/api/social/chat", chatRoutes);
app.use("/api/social/profile", socialProfileRoutes);





 


const httpServer = http.createServer(app)

const io = new Server(httpServer, {
  cors: corsOptions,
})

setIO(io)

setupSocialSocket(io)

if (process.env.NODE_ENV !== 'test') {
  httpServer.listen(process.env.PORT || 4000, () => {
    console.log(`🚀 Servidor corriendo en puerto ${process.env.PORT || 4000}`)
    console.log('🔌 WebSockets activos con Socket.io')
  })
}

export { app, httpServer, io }
export default app
