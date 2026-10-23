import { jest, describe, test, expect, beforeEach, afterEach, afterAll } from '@jest/globals'
import express from 'express'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse } from '@babel/parser'
import bcrypt from 'bcryptjs'
import { createServer } from 'node:http'
import { Server } from 'socket.io'

const original = { secret: process.env.JWT_SECRET, node: process.env.NODE_ENV,
  debug: process.env.ENABLE_DEBUG_ROUTES, dotenv: process.env.DOTENV_CONFIG_PATH }
const secret = 'isolated-auth-config-security-test-secret'
process.env.JWT_SECRET = secret
process.env.DOTENV_CONFIG_PATH = path.resolve('backend/tests/no-environment-file')
process.env.NODE_ENV = 'test'
let tables, operations, unavailable

const supabase = { from: jest.fn((table) => {
  let selected, update
  const filters = []
  const execute = () => {
    operations.push({ table, selected, update })
    if (unavailable) return { data: null, error: { message: 'sensitive-db-error-content' } }
    if (!tables[table]) throw new Error('Unexpected isolated table')
    const rows = tables[table].filter((row) => filters.every(([key, val]) => String(row[key]) === String(val)))
    if (update) rows.forEach((row) => Object.assign(row, update))
    return { data: rows.map((row) => ({ ...row })), error: null }
  }
  const single = async () => { const result = execute(); return { ...result, data: result.data?.[0] ?? null } }
  const query = {
    select: (fields) => { selected = fields; return query },
    eq: (key, val) => { filters.push([key, val]); return query },
    order: () => query, limit: () => query,
    update: (value) => { update = value; return query },
    maybeSingle: single, single,
    then: (resolve, reject) => Promise.resolve(execute()).then(resolve, reject),
  }
  return query
}) }
const emitter = jest.fn()
jest.unstable_mockModule('../src/config/supabaseClient.js', () => ({ default: supabase }))
jest.unstable_mockModule('../src/sockets/presenceEmitter.js', () => ({
  emitPresenceUpdateForVenue: emitter, emitPresenceUpdateForExpiredSessions: jest.fn(),
}))
const { authMiddleware, optionalAuthMiddleware, requireRole, requireAnyRole } = await import('../src/middlewares/auth.middleware.js')
const { mountDebugRoutes } = await import('../src/routes/debug.routes.js')
const { createRequestLogger } = await import('../src/middlewares/request-logging.js')
const { errorHandler } = await import('../src/middlewares/errorHandler.js')
const { setupSocialSocket } = await import('../src/sockets/social.socket.js')
const { default: social } = await import('../src/modules/social/social.service.js')
const { default: giftsRouter } = await import('../src/modules/social/gifts.router.js')
const { assertVenueAdmin } = await import('../src/modules/social/venue-ownership.helper.js')
const { getCurrentAuthUser } = await import('../src/services/auth-context.service.js')
const { default: authService } = await import('../src/services/auth.service.js')
const { default: usuarioRepository } = await import('../src/repositories/usuario.repository.js')
const tokenFor = (claims = { id: 8, rol: 'admin', venue_id: 1 }, key = secret) => jwt.sign(claims, key, { expiresIn: '8h' })

function appFor(logs = []) {
  const app = express()
  app.use(createRequestLogger({ stream: { write: (line) => logs.push(line) } }))
  app.use(express.json())
  mountDebugRoutes(app)
  app.get('/normal', (req, res) => res.json({ ok: true }))
  app.post('/private', authMiddleware, (req, res) => res.json(req.user))
  app.get('/optional', optionalAuthMiddleware, (req, res) => res.json({ id: req.user?.id ?? null }))
  app.get('/admin/:venue', authMiddleware, requireRole('admin'), (req, res) => {
    try { assertVenueAdmin(req.user, req.params.venue); res.json({ ok: true }) }
    catch { res.sendStatus(403) }
  })
  app.get('/staff', authMiddleware, requireAnyRole('staff', 'admin'), (req, res) => res.json({ ok: true }))
  app.use('/api/social/gifts', giftsRouter)
  app.get('/internal-error', () => { throw new Error('QAKEY42-private-internal-details') })
  app.get('/forwarded-error/:status', (req, res, next) => {
    next(Object.assign(new Error('QAKEY42-private-internal-details'), { statusCode: Number(req.params.status) }))
  })
  app.use(errorHandler)
  return app
}
async function connectSocket(token) {
  const handlers = new Map()
  let authenticate, connection
  const io = { use: (fn) => { authenticate = fn }, on: (event, fn) => { if (event === 'connection') connection = fn } }
  const socket = {
    id: 'isolated-socket', data: {}, handshake: { auth: { token }, headers: {} },
    join: jest.fn(), leave: jest.fn(), emit: jest.fn(), on: (event, fn) => handlers.set(event, fn),
  }
  setupSocialSocket(io)
  let error
  await authenticate(socket, (value) => { error = value })
  if (!error) connection(socket)
  return { socket, handlers, error }
}

beforeEach(() => {
  process.env.NODE_ENV = 'test'
  delete process.env.ENABLE_DEBUG_ROUTES
  tables = {
    usuarios: [
      { id_usuario: 8, rol: 'admin', venue_id: 1, is_suspended: false, contrasena_hash: 'db-private-password' },
      { id_usuario: 44, rol: 'cliente', venue_id: null, is_suspended: false },
    ],
    gifts: [{ id: 1, sender_id: 44, receiver_id: 8, venue_id: 1, redeem_token: 'isolated-qr-token',
      status: 'accepted_id', redeem_expires_at: new Date(Date.now() + 60000).toISOString() }],
    venue_presence_sessions: [{ id: 1, user_id: 8, venue_id: 1, source: 'venue_admin', status: 'active',
      valid_until: new Date(Date.now() + 60000).toISOString(), hard_expires_at: new Date(Date.now() + 120000).toISOString() }],
  }
  operations = []
  unavailable = false
  supabase.from.mockClear()
  emitter.mockClear()
  jest.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('External network forbidden') })
  for (const method of ['log', 'error', 'warn', 'debug']) jest.spyOn(console, method).mockImplementation(() => {})
})
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled()
  jest.restoreAllMocks()
})
afterAll(() => {
  for (const [env, value] of [['JWT_SECRET', original.secret], ['NODE_ENV', original.node],
    ['ENABLE_DEBUG_ROUTES', original.debug], ['DOTENV_CONFIG_PATH', original.dotenv]]) {
    if (value === undefined) delete process.env[env]
    else process.env[env] = value
  }
})

describe('fail-closed boot configuration', () => {
  const configUrl = pathToFileURL(path.resolve('backend/src/config/security.config.js')).href
  test.each([undefined, '', 'secret', 'short', ' '.repeat(32), ` ${secret}`])('invalid configuration (%#) fails without disclosing values', (value) => {
    const env = { ...process.env, DOTENV_CONFIG_PATH: process.env.DOTENV_CONFIG_PATH }
    if (value === undefined) delete env.JWT_SECRET
    else env.JWT_SECRET = value
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(configUrl)})`], { env, encoding: 'utf8' })
    expect(child.status).not.toBe(0)
    expect(child.stderr).toContain('JWT_SECRET ausente o invalido')
    expect(child.stdout).toBe('')
    if (value && value.trim()) expect(child.stderr).not.toContain(value.trim())
  })
  test('valid configuration loads without displaying the secret', () => {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(configUrl)}); console.log('CONFIG_OK')`], { env: process.env, encoding: 'utf8' })
    expect(child.status).toBe(0)
    expect(child.stdout.trim()).toBe('CONFIG_OK')
    expect(child.stderr).not.toContain(secret)
  })
  test('actual server import fails at JWT validation before Supabase/client/listen initialization', () => {
    const serverUrl = pathToFileURL(path.resolve('backend/src/server.js')).href
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(serverUrl)})`], {
      env: { ...process.env, JWT_SECRET: '', SUPABASE_URL: '', SUPABASE_KEY: '', NODE_ENV: 'production' }, encoding: 'utf8', timeout: 15000,
    })
    expect(child.status).not.toBe(0)
    expect(child.error).toBeUndefined()
    expect(child.stderr).toContain('JWT_SECRET ausente o invalido')
    expect(child.stderr).not.toContain('supabaseUrl is required')
    expect(child.stdout).toBe('')
  })
  test('no JWT fallback remains in production sources', () => {
    for (const file of ['middlewares/auth.middleware.js', 'controllers/auth.controller.js', 'sockets/social.socket.js']) {
      expect(fs.readFileSync(`backend/src/${file}`, 'utf8')).not.toMatch(/JWT_SECRET\s*\|\|/)
    }
  })
  test('valid configuration initializes the actual server graph in test mode with isolated storage', async () => {
    const { app, httpServer, io } = await import('../src/server.js')
    try {
      expect(httpServer.listening).toBe(false)
      const response = await request(app).get('/api/social/ping-stories')
      expect(response.status).toBe(200)
      expect(operations).toHaveLength(0)
      expect((await request(app).post('/api/debug/pedidos/1/update').send({ estado: 'pagado' })).status).toBe(404)
      await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
      const opening = await request(httpServer).get('/socket.io/?EIO=4&transport=polling')
      const sid = JSON.parse(opening.text.slice(1)).sid
      const transportUrl = `/socket.io/?EIO=4&transport=polling&sid=${sid}`
      await request(httpServer).post(transportUrl).set('Content-Type', 'text/plain')
        .send(`40${JSON.stringify({ token: tokenFor() })}`).expect(200)
      const connected = await request(httpServer).get(transportUrl)
      expect(connected.text).toContain('40{')
      expect(io.sockets.adapter.rooms.get('user:8')?.size).toBe(1)
    } finally {
      await new Promise((resolve) => io.close(resolve))
    }
  })
})

describe('HTTP and Socket.IO use current users, not stale administrative claims', () => {
  test('login does not issue credentials for a suspended account', async () => {
    jest.spyOn(usuarioRepository, 'findByEmail').mockResolvedValue({
      id_usuario: 8, is_suspended: true, contrasena_hash: bcrypt.hashSync('Test!123', 4),
    })
    await expect(authService.login('isolated@example.test', 'Test!123')).rejects.toThrow('Credenciales')
  })
  test('one token authenticates HTTP and socket with the same canonical identity', async () => {
    const token = tokenFor()
    const response = await request(appFor()).post('/private').set('Authorization', `Bearer ${token}`).send({ password: 'fictitious-private-input' })
    expect(response.status).toBe(200)
    const { socket, error } = await connectSocket(token)
    expect(error).toBeUndefined()
    expect(socket.data.user).toEqual(response.body)
    expect(socket.join).toHaveBeenCalledWith('user:8')
    expect(response.body).not.toHaveProperty('contrasena_hash')
    expect(response.body).not.toHaveProperty('correo')
  })
  test.each(['forged', 'missing', 'suspended', 'null-state', 'storage'])('%s identity fails closed in both transports', async (kind) => {
    let token = tokenFor()
    if (kind === 'forged') token = tokenFor(undefined, 'wrong-test-key')
    if (kind === 'missing') tables.usuarios = []
    if (kind === 'suspended') tables.usuarios[0].is_suspended = true
    if (kind === 'null-state') tables.usuarios[0].is_suspended = null
    if (kind === 'storage') unavailable = true
    const response = await request(appFor()).post('/private').set('Authorization', `Bearer ${token}`)
    expect(response.status).toBe(kind === 'storage' ? 503 : ['suspended', 'null-state'].includes(kind) ? 403 : 401)
    expect(JSON.stringify(response.body)).not.toContain('sensitive-db-error-content')
    const { error, socket } = await connectSocket(token)
    expect(error).toBeInstanceOf(Error)
    expect(socket.join).not.toHaveBeenCalled()
  })
  test('a demoted admin cannot perform admin or staff operations with the old token', async () => {
    const token = tokenFor()
    tables.usuarios[0].rol = 'cliente'
    for (const url of ['/admin/1', '/staff']) {
      expect((await request(appFor()).get(url).set('Authorization', `Bearer ${token}`)).status).toBe(403)
    }
    const own = await request(appFor()).post('/private').set('Authorization', `Bearer ${token}`)
    expect(own.body.rol).toBe('cliente')
    expect(operations.every((op) => !op.update)).toBe(true)
  })
  test('old venue claim cannot authorize venue 1 after reassignment to venue 2', async () => {
    const token = tokenFor()
    tables.usuarios[0].venue_id = 2
    const app = appFor()
    expect((await request(app).get('/admin/1').set('Authorization', `Bearer ${token}`)).status).toBe(403)
    expect((await request(app).get('/admin/2').set('Authorization', `Bearer ${token}`)).status).toBe(200)
    const qr = await request(app).get('/api/social/gifts/redeem/isolated-qr-token').set('Authorization', `Bearer ${token}`)
    expect(qr.status).toBe(404)
  })
  test('legitimate own-venue admin passes authorization with one user lookup', async () => {
    const response = await request(appFor()).get('/admin/1').set('Authorization', `Bearer ${tokenFor()}`)
    expect(response.status).toBe(200)
    expect(operations).toHaveLength(1)
    expect(operations[0].selected).toBe('id_usuario, rol, venue_id, is_suspended')
  })
  test('optional auth permits no header but rejects invalid or suspended identities', async () => {
    const app = appFor()
    expect((await request(app).get('/optional')).body.id).toBeNull()
    expect(operations).toHaveLength(0)
    expect((await request(app).get('/optional').set('Authorization', 'Bearer invalid')).status).toBe(401)
    tables.usuarios[0].is_suspended = true
    expect((await request(app).get('/optional').set('Authorization', `Bearer ${tokenFor()}`)).status).toBe(403)
  })
  test.each(['social:join-venue', 'presence:heartbeat'])('%s revalidates a connected admin after demotion', async (event) => {
    const { handlers } = await connectSocket(tokenFor())
    const adminPresence = jest.spyOn(social, 'ensureVenueAdminPresence').mockResolvedValue({ ok: true })
    const heartbeat = jest.spyOn(social, 'heartbeat').mockResolvedValue({ ok: true })
    tables.usuarios[0].rol = 'cliente'
    await handlers.get(event)({ venue_id: 1 })
    expect(adminPresence).not.toHaveBeenCalled()
    expect(heartbeat).toHaveBeenCalledWith(expect.objectContaining({ authenticatedUser: expect.objectContaining({ rol: 'cliente' }) }))
  })
  test.each(['social:join-venue', 'presence:heartbeat'])('%s revalidates current venue and refuses a stale venue bypass', async (event) => {
    const { handlers } = await connectSocket(tokenFor())
    const adminPresence = jest.spyOn(social, 'ensureVenueAdminPresence').mockResolvedValue({ ok: true })
    const heartbeat = jest.spyOn(social, 'heartbeat').mockResolvedValue({ ok: true })
    tables.usuarios[0].venue_id = 2
    await handlers.get(event)({ venue_id: 1 })
    expect(adminPresence).not.toHaveBeenCalled()
    expect(heartbeat).toHaveBeenCalled()
    await handlers.get(event)({ venue_id: 2 })
    expect(adminPresence).toHaveBeenCalledWith(expect.objectContaining({ venue_id: 2 }))
  })
  test.each(['social:join-venue', 'presence:heartbeat'])('%s cannot perform presence operations during authorization outage', async (event) => {
    const { handlers, socket } = await connectSocket(tokenFor())
    const adminPresence = jest.spyOn(social, 'ensureVenueAdminPresence')
    const heartbeat = jest.spyOn(social, 'heartbeat')
    unavailable = true
    await handlers.get(event)({ venue_id: 1 })
    expect(adminPresence).not.toHaveBeenCalled()
    expect(heartbeat).not.toHaveBeenCalled()
    expect(socket.emit).toHaveBeenCalledWith('presence:error', expect.objectContaining({ code: 'AUTH_UNAVAILABLE' }))
  })
  test('a venue_admin session cannot be renewed through the normal heartbeat after demotion', async () => {
    tables.usuarios[0].rol = 'cliente'
    const user = await getCurrentAuthUser({ id: 8 })
    await expect(social.heartbeat({ user_id: 8, venue_id: 1, authenticatedUser: user })).rejects.toMatchObject({ statusCode: 403 })
    expect(operations.every((op) => !op.update)).toBe(true)
  })
  test('the administrative presence service also checks current database ownership when called internally', async () => {
    tables.usuarios[0].venue_id = 2
    await expect(social.ensureVenueAdminPresence({ user_id: 8, venue_id: 1 })).rejects.toMatchObject({ statusCode: 403 })
    expect(operations.every((op) => !op.update)).toBe(true)
  })
  test('expired socket identity cannot regain admin presence', async () => {
    const { socket, handlers } = await connectSocket(tokenFor())
    socket.data.user.exp = Math.floor(Date.now() / 1000) - 1
    const adminPresence = jest.spyOn(social, 'ensureVenueAdminPresence')
    await handlers.get('presence:heartbeat')({ venue_id: 1 })
    expect(adminPresence).not.toHaveBeenCalled()
  })
})

describe('safe global HTTP error handling', () => {
  const marker = 'QAKEY42'
  function captureOutput() {
    const chunks = []
    for (const stream of [process.stdout, process.stderr]) {
      jest.spyOn(stream, 'write').mockImplementation((chunk) => { chunks.push(String(chunk)); return true })
    }
    return () => chunks.join('') + ['log', 'error', 'warn', 'debug']
      .map((method) => JSON.stringify(console[method].mock.calls)).join('')
  }
  test.each(['test', 'production'])('invalid JSON and internal exceptions never expose content in %s', async (environment) => {
    process.env.NODE_ENV = environment
    const logs = []
    const output = captureOutput()
    const app = appFor(logs)
    const malformed = await request(app).post('/private?password=QAKEY42')
      .set('Content-Type', 'application/json').send(marker)
    expect(malformed.status).toBe(400)
    expect(malformed.body).toEqual({ message: 'Solicitud invalida' })
    const internal = await request(app).get('/internal-error')
    expect(internal.status).toBe(500)
    expect(internal.body).toEqual({ message: 'Error interno del servidor' })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(JSON.stringify([malformed.body, internal.body])).not.toContain(marker)
    expect(logs.join('') + output()).not.toContain(marker)
    expect(output()).not.toMatch(/SyntaxError|at JSON.parse|private-internal-details/)
    expect(operations).toHaveLength(0)
    expect((await request(app).get('/normal')).body).toEqual({ ok: true })
  })
  test.each([400, 401, 403, 404, 409, 413, 422, 503])('forwarded HTTP %s keeps its status without echoing error content', async (status) => {
    process.env.NODE_ENV = 'production'
    const response = await request(appFor()).get(`/forwarded-error/${status}`)
    expect(response.status).toBe(status)
    expect(JSON.stringify(response.body)).not.toMatch(/QAKEY42|stack|private-internal-details/)
  })
  test('oversized JSON returns 413 and unknown routes stay 404', async () => {
    process.env.NODE_ENV = 'production'
    const app = appFor()
    const response = await request(app).post('/private').send({ password: marker.repeat(20000) })
    expect(response.status).toBe(413)
    expect(response.text).not.toContain(marker)
    expect((await request(app).get('/not-found')).status).toBe(404)
  })
  test('actual server mounts safe handling after routes, including in production mode', async () => {
    // Import in test mode to keep startup timers/listeners disabled; then test production requests.
    const { app } = await import('../src/server.js')
    const oldEnvironment = app.get('env')
    process.env.NODE_ENV = 'production'
    app.set('env', 'production')
    const output = captureOutput()
    try {
      const response = await request(app).post('/api/auth/login')
        .set('Content-Type', 'application/json').send(marker)
      expect(response.status).toBe(400)
      expect(response.body).toEqual({ message: 'Solicitud invalida' })
      expect((await request(app).get('/api/social/ping-stories')).status).toBe(200)
      expect((await request(app).get('/unknown')).status).toBe(404)
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(response.text + output()).not.toContain(marker)
      expect(operations).toHaveLength(0)
    } finally {
      app.set('env', oldEnvironment)
    }
  })
  test('an error after headers closes the response without delegating private errors', () => {
    const next = jest.fn()
    const res = { headersSent: true, destroy: jest.fn(), status: jest.fn() }
    errorHandler(new Error(marker), {}, res, next)
    expect(res.destroy).toHaveBeenCalledTimes(1)
    expect(res.status).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
    expect(JSON.stringify(console.error.mock.calls)).not.toContain(marker)
  })
})

describe('real local Socket.IO authentication error contract', () => {
  async function withSocketServer(run) {
    const httpServer = createServer(express())
    const io = new Server(httpServer)
    setupSocialSocket(io)
    try {
      await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
      const connect = async (token) => {
        const opening = await request(httpServer).get('/socket.io/?EIO=4&transport=polling').expect(200)
        const sid = JSON.parse(opening.text.slice(1)).sid
        const url = `/socket.io/?EIO=4&transport=polling&sid=${sid}`
        await request(httpServer).post(url).set('Content-Type', 'text/plain')
          .send(`40${JSON.stringify({ token })}`).expect(200)
        const response = await request(httpServer).get(url).expect(200)
        const packets = response.text.split('\x1e')
        const rejected = packets.find((packet) => packet.startsWith('44'))
        return { packets, error: rejected ? JSON.parse(rejected.slice(2)) : null }
      }
      await run({ io, connect })
    } finally {
      await new Promise((resolve) => io.close(resolve))
    }
  }
  test.each(['invalid', 'expired', 'missing', 'suspended', 'null-state'])('%s identity is permanently rejected with no authenticated room', async (kind) => {
    let token = tokenFor()
    if (kind === 'invalid') token = 'not-a-jwt'
    if (kind === 'expired') token = jwt.sign({ id: 8 }, secret, { expiresIn: -1 })
    if (kind === 'missing') tables.usuarios = []
    if (kind === 'suspended') tables.usuarios[0].is_suspended = true
    if (kind === 'null-state') tables.usuarios[0].is_suspended = null
    await withSocketServer(async ({ io, connect }) => {
      const result = await connect(token)
      expect(result.error).toEqual({ message: 'Cuenta no autorizada', data: {
        code: ['suspended', 'null-state'].includes(kind) ? 'AUTH_FORBIDDEN' : 'AUTH_REQUIRED',
      } })
      expect(io.sockets.sockets.size).toBe(0)
      expect(io.sockets.adapter.rooms.get('user:8')).toBeUndefined()
      expect(JSON.stringify(result.error)).not.toContain(token)
      expect(result.packets.some((packet) => packet.startsWith('40'))).toBe(false)
    })
  })
  test('storage outage denies access with a stable temporary code; a fresh connection succeeds after recovery', async () => {
    unavailable = true
    await withSocketServer(async ({ io, connect }) => {
      const rejected = await connect(tokenFor())
      expect(rejected.error).toEqual({ message: 'Autenticacion temporalmente no disponible',
        data: { code: 'AUTH_TEMPORARILY_UNAVAILABLE' } })
      expect(JSON.stringify(rejected.error)).not.toMatch(/sensitive-db-error-content|stack|supabase/i)
      expect(io.sockets.sockets.size).toBe(0)
      expect(io.sockets.adapter.rooms.get('user:8')).toBeUndefined()
      unavailable = false
      const recovered = await connect(tokenFor())
      expect(recovered.error).toBeNull()
      expect(recovered.packets.some((packet) => packet.startsWith('40{'))).toBe(true)
      expect(io.sockets.adapter.rooms.get('user:8')?.size).toBe(1)
      expect(io.sockets.sockets.size).toBe(1)
    })
  })
  test('an invalid JWT stays permanent even during a storage outage', async () => {
    unavailable = true
    await withSocketServer(async ({ connect }) => {
      const result = await connect('not-a-jwt')
      expect(result.error.data.code).toBe('AUTH_REQUIRED')
      expect(operations).toHaveLength(0)
    })
  })
})

describe('debug is explicitly gated and never operates on orders', () => {
  test.each([undefined, '', 'production', 'test', 'staging', 'unknown'])('environment %s never mounts debug, even with opt-in', async (environment) => {
    if (environment === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = environment
    process.env.ENABLE_DEBUG_ROUTES = 'true'
    const app = appFor()
    for (const [method, url] of [['get', '/api/debug/pedidos/1'], ['post', '/api/debug/pedidos/1/update']]) {
      expect((await request(app)[method](url).send({ estado: 'pagado' })).status).toBe(404)
    }
    expect((await request(app).get('/normal')).status).toBe(200)
    expect(operations).toHaveLength(0)
  })
  test('development without explicit opt-in does not mount debug', async () => {
    process.env.NODE_ENV = 'development'
    expect((await request(appFor()).get('/api/debug/pedidos/1')).status).toBe(404)
  })
  test('opted-in local development requires current admin and retires legacy data endpoints', async () => {
    process.env.NODE_ENV = 'development'
    process.env.ENABLE_DEBUG_ROUTES = 'true'
    const app = appFor()
    expect((await request(app).get('/api/debug/pedidos/1')).status).toBe(401)
    expect((await request(app).get('/api/debug/pedidos/1').set('Authorization', `Bearer ${tokenFor({ id: 44, rol: 'admin' })}`)).status).toBe(403)
    for (const [method, url] of [['get', '/api/debug/pedidos/1'], ['post', '/api/debug/pedidos/1/update']]) {
      expect((await request(app)[method](url).set('Authorization', `Bearer ${tokenFor()}`).send({ estado: 'pagado', password: 'private-body' })).status).toBe(410)
    }
    expect(operations.every((op) => op.table === 'usuarios' && !op.update)).toBe(true)
  })
})

describe('credential-safe observability', () => {
  test('redeem tokens, queries, passwords and Authorization never reach logs', async () => {
    const logs = []
    const token = tokenFor()
    const app = appFor(logs)
    await request(app).get('/api/social/gifts/redeem/fictitious-sensitive-qr?access_token=query-secret&password=query-password')
    await request(app).post('/private?token=query-secret').set('Authorization', `Bearer ${token}`).send({ password: 'private-password' })
    await new Promise((resolve) => setImmediate(resolve))
    const output = logs.join('') + JSON.stringify(console.log.mock.calls) + JSON.stringify(console.error.mock.calls)
    for (const value of ['fictitious-sensitive-qr', 'query-secret', 'query-password', 'private-password', token, secret]) expect(output).not.toContain(value)
    expect(logs[0]).toMatch(/^GET \/api\/social\/gifts\/redeem\/\[REDACTED\] 401 [\d.]+ ms/)
    expect(logs[1]).toMatch(/^POST \/api\/private 200 [\d.]+ ms/)
  })
  test('unknown paths cannot smuggle credentials into logs', async () => {
    const logs = []
    await request(appFor(logs)).get('/api/sensitive-path-secret?secret=query-secret')
    await new Promise((resolve) => setImmediate(resolve))
    expect(logs.join('')).not.toMatch(/sensitive-path-secret|query-secret/)
    expect(logs[0]).toContain('GET /[UNMATCHED] 404')
  })
  test('production console calls retain only static labels, not objects, private messages or error stacks', () => {
    function inspect(node) {
      if (!node || typeof node !== 'object') return
      if (node.type === 'CallExpression' && node.callee?.object?.name === 'console') {
        expect(node.arguments.length).toBe(1)
        expect(node.arguments[0].type).toBe('StringLiteral')
      }
      for (const child of Object.values(node)) {
        if (Array.isArray(child)) child.forEach(inspect)
        else if (child && typeof child === 'object' && child.type) inspect(child)
      }
    }
    function walk(directory) {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name)
        if (entry.isDirectory()) walk(file)
        else if (file.endsWith('.js')) inspect(parse(fs.readFileSync(file, 'utf8'), { sourceType: 'module' }))
      }
    }
    walk('backend/src')
  })
})
