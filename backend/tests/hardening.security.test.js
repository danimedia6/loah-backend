import { jest, describe, test, expect, beforeEach, afterEach, afterAll } from '@jest/globals'
import express from 'express'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createHash } from 'node:crypto'
import sharp from 'sharp'

const originalEnv = { ...process.env }
process.env.JWT_SECRET = 'isolated-block04-test-key-never-used-outside-tests'
process.env.DOTENV_CONFIG_PATH = 'backend/tests/no-environment-file'
process.env.NODE_ENV = 'test'
const secret = 'sandbox_events_fictitious_not_a_real_secret'
let operations, storageCalls
const supabase = {
  from: jest.fn((table) => {
    if (table !== 'usuarios') throw new Error('Financial DB access forbidden in containment tests')
    let id
    const query = {
      select: () => query,
      eq: (key, value) => { id = value; return query },
      maybeSingle: async () => {
        operations.push(table)
        return { data: { id_usuario: Number(id), rol: Number(id) === 99 ? 'admin' : 'cliente',
          venue_id: 1, is_suspended: false }, error: null }
      },
    }
    return query
  }),
  storage: { from: () => { storageCalls++; throw new Error('Real storage forbidden') } },
}
jest.unstable_mockModule('../src/config/supabaseClient.js', () => ({ default: supabase }))
const { default: wompiRoutes } = await import('../src/routes/wompi.routes.js')
const { default: pagosRoutes } = await import('../src/routes/pagos.routes.js')
const { default: pedidosRoutes } = await import('../src/routes/pedidos.routes.js')
const { default: profileRoutes } = await import('../src/modules/social/profile-background.routes.js')
const { default: wompi } = await import('../src/services/wompi.service.js')
const { default: pago } = await import('../src/services/pago.service.js')
const { default: pedido } = await import('../src/services/pedido.service.js')
const { default: pedidoRepository } = await import('../src/repositories/pedido.repository.js')
const { default: auditoria } = await import('../src/services/auditoria.service.js')
const { default: pagoRepository } = await import('../src/repositories/pago.repository.js')
const { errorHandler } = await import('../src/middlewares/errorHandler.js')
const { createRequestLogger } = await import('../src/middlewares/request-logging.js')
const { createValidatedUpload } = await import('../src/middlewares/validated-upload.js')
const { compileTrustedProxies, createHttpAbuseProtection, createBudget, createSocketProtection } =
  await import('../src/middlewares/abuse-protection.js')
const { setupSocialSocket } = await import('../src/sockets/social.socket.js')
const bearer = (id = 8) => `Bearer ${jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '1h' })}`
const urls = ['/api/wompi/webhook', '/api/pagos/webhooks/wompi']

function sign(overrides = {}, properties = ['transaction.id', 'transaction.status', 'transaction.amount_in_cents']) {
  const payload = {
    event: 'transaction.updated', environment: 'test', timestamp: 1760000000,
    data: { transaction: { id: 'isolated-tx-1', status: 'APPROVED', amount_in_cents: 500000,
      currency: 'COP', reference: 'isolated-purchase-1', ...overrides } },
    signature: { properties },
  }
  payload.signature.checksum = createHash('sha256').update(properties
    .map((field) => field.split('.').reduce((value, part) => value[part], payload.data))
    .join('') + payload.timestamp + secret).digest('hex')
  return payload
}

function appFor({ logs = [], protectedHttp = false, proxy = '' } = {}) {
  const app = express()
  app.set('env', 'production')
  app.set('trust proxy', compileTrustedProxies(proxy))
  app.use(createRequestLogger({ stream: { write: (line) => logs.push(line) } }))
  app.use(urls, express.raw({ type: 'application/json', limit: '64kb' }))
  app.use(express.json())
  if (protectedHttp) app.use(createHttpAbuseProtection())
  app.use('/api/wompi', wompiRoutes)
  app.use('/api/pagos', pagosRoutes)
  app.use('/api/pedidos', pedidosRoutes)
  app.use('/api/social/profile', profileRoutes)
  app.post('/api/auth/login', (req, res) => res.json({ ok: true }))
  app.post('/api/auth/signup', (req, res) => res.sendStatus(201))
  app.get('/normal', (req, res) => res.json({ ok: true }))
  app.use(errorHandler)
  return app
}
function uploadApp(options, array = false) {
  const app = express()
  const upload = createValidatedUpload(options)
  app.post('/upload', array ? upload.array('files', 6) : upload.single('file'), (req, res) => {
    const file = req.file || req.files?.[0]
    res.json({ type: file?.mimetype, name: file?.originalname, size: file?.size })
  })
  app.use(errorHandler)
  return app
}

beforeEach(() => {
  process.env.WOMPI_ENV = 'sandbox'
  process.env.WOMPI_EVENTS_SECRET = secret
  operations = []
  storageCalls = 0
  supabase.from.mockClear()
  jest.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('External network forbidden') })
  for (const method of ['log', 'error', 'warn', 'debug']) jest.spyOn(console, method).mockImplementation(() => {})
})
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled()
  jest.restoreAllMocks()
})
afterAll(() => {
  for (const key of ['JWT_SECRET', 'DOTENV_CONFIG_PATH', 'NODE_ENV', 'WOMPI_ENV', 'WOMPI_EVENTS_SECRET']) {
    if (originalEnv[key] === undefined) delete process.env[key]
    else process.env[key] = originalEnv[key]
  }
})

describe('official Wompi Colombia event authentication', () => {
  test('SHA256 of ordered values, timestamp and events secret verifies without raw-body HMAC', () => {
    const payload = sign()
    expect(wompi.verifyWebhookSignature(Buffer.from(JSON.stringify(payload))).ok).toBe(true)
    expect(wompi.verifyWebhookSignature(Buffer.from(JSON.stringify(payload, null, 2))).ok).toBe(true)
  })
  test('official X-Event-Checksum can supply checksum; case-insensitive hex and extra signed fields work', () => {
    const payload = sign({}, ['transaction.amount_in_cents', 'transaction.id', 'transaction.reference', 'transaction.status'])
    const checksum = payload.signature.checksum.toUpperCase()
    delete payload.signature.checksum
    expect(wompi.verifyWebhookSignature(payload, checksum).ok).toBe(true)
  })
  test.each(['missing', 'incorrect', 'tampered', 'conflicting-header', 'wrong-secret'])('%s signature cannot authorize either endpoint', async (kind) => {
    const payload = sign()
    if (kind === 'missing') delete payload.signature
    if (kind === 'incorrect') payload.signature.checksum = '0'.repeat(64)
    if (kind === 'tampered') payload.data.transaction.amount_in_cents++
    if (kind === 'wrong-secret') process.env.WOMPI_EVENTS_SECRET = 'another-fictitious-events-secret'
    const app = appFor()
    for (const url of urls) {
      let call = request(app).post(url).send(payload)
      if (kind === 'conflicting-header') call = call.set('X-Event-Checksum', '0'.repeat(64))
      const result = await call
      expect(result.status).toBe(400)
      expect(result.body.code).toBe('WOMPI_INVALID_SIGNATURE')
    }
    expect(supabase.from).not.toHaveBeenCalled()
  })
  test.each(['secret', 'environment'])('missing %s fails closed with 503, never development fallback', async (kind) => {
    if (kind === 'secret') delete process.env.WOMPI_EVENTS_SECRET
    else delete process.env.WOMPI_ENV
    for (const url of urls) {
      const response = await request(appFor()).post(url).send(sign())
      expect(response.status).toBe(503)
      expect(response.body.code).toBe('WOMPI_EVENTS_UNAVAILABLE')
    }
    expect(supabase.from).not.toHaveBeenCalled()
  })
  test.each([
    { currency: 'USD' }, { amount_in_cents: -1 }, { amount_in_cents: 1.5 },
    { reference: '' }, { id: '' }, { status: 'FINALIZED' },
  ])('invalid transaction data %j is rejected', async (overrides) => {
    for (const url of urls) expect((await request(appFor()).post(url).send(sign(overrides))).status).toBe(400)
    expect(supabase.from).not.toHaveBeenCalled()
  })
  test('wrong event, environment, malformed JSON and oversized body cannot reach financial processing', async () => {
    for (const url of urls) {
      for (const changes of [{ event: 'nequi_token.updated' }, { environment: 'prod' }]) {
        expect((await request(appFor()).post(url).send({ ...sign(), ...changes })).status).toBe(400)
      }
      const invalid = await request(appFor()).post(url).set('Content-Type', 'application/json').send('QAKEY42')
      expect(invalid.status).toBe(400)
      expect(invalid.text).not.toContain('QAKEY42')
      expect((await request(appFor()).post(url).set('Content-Type', 'application/json').send('x'.repeat(65537))).status).toBe(413)
    }
    expect(supabase.from).not.toHaveBeenCalled()
  })
  test('prototype paths, empty property lists and unsigned core fields are rejected', () => {
    for (const properties of [[], ['__proto__.x'], ['transaction.reference']]) {
      const payload = sign()
      payload.signature.properties = properties
      expect(() => wompi.verifyWebhookSignature(payload)).toThrow()
    }
  })
  test('actual server routes preserve raw bodies on BOTH aliases without private webhook logging', async () => {
    const { app, io } = await import('../src/server.js')
    const logs = []
    const output = jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => { logs.push(String(chunk)); return true })
    try {
      const payload = sign({ reference: 'QAKEY42-private-purchase' })
      for (const url of urls) {
        const result = await request(app).post(url).set('Content-Type', 'application/json')
          .send(JSON.stringify(payload, null, 2))
        expect(result.status).toBe(503)
        expect(result.body.code).toBe('LEGACY_PAYMENTS_UNAVAILABLE')
        expect(result.text).not.toContain('QAKEY42')
      }
      await new Promise((resolve) => setImmediate(resolve))
      expect(logs.join('') + JSON.stringify(console.log.mock.calls) + JSON.stringify(console.error.mock.calls))
        .not.toMatch(/QAKEY42|sandbox_events_fictitious/)
      expect(supabase.from).not.toHaveBeenCalled()
    } finally {
      output.mockRestore()
      await new Promise((resolve) => io.close(resolve))
    }
  })
})

describe('financial containment, not simulated transactional guarantees', () => {
  test.each([
    { reference: 'unknown-purchase' }, { reference: 'another-clients-order' },
    { amount_in_cents: 1 }, { id: 'nonexistent-transaction' },
    { status: 'APPROVED' }, { status: 'DECLINED' }, { status: 'PENDING' }, { status: 'VOIDED' }, { status: 'ERROR' },
  ])('even a valid signed event %j cannot cause business effects', async (overrides) => {
    for (const url of urls) {
      const response = await request(appFor()).post(url).send(sign(overrides))
      expect(response.status).toBe(503)
      expect(response.body.code).toBe('LEGACY_PAYMENTS_UNAVAILABLE')
      expect(response.body.ok).not.toBe(true)
    }
    expect(supabase.from).not.toHaveBeenCalled()
  })
  test('duplicates and out-of-order delivery never write, including after a hypothetical DB failure', async () => {
    const write = jest.spyOn(pagoRepository, 'update').mockRejectedValue(new Error('QAKEY42-partial-persistence'))
    const orderWrite = jest.spyOn(pedidoRepository, 'update')
    const app = appFor()
    for (const status of ['APPROVED', 'APPROVED', 'PENDING', 'DECLINED', 'APPROVED']) {
      const result = await request(app).post(urls[0]).send(sign({ status }))
      expect(result.status).toBe(503)
      expect(result.text).not.toContain('QAKEY42')
    }
    expect(write).not.toHaveBeenCalled()
    expect(orderWrite).not.toHaveBeenCalled()
    expect(supabase.from).not.toHaveBeenCalled()
  })
  test.each(['/api/wompi/crear-transaccion', '/api/pagos/create'])('%s requires auth and cannot create a simulated or real payment', async (url) => {
    const app = appFor()
    expect((await request(app).post(url).send({ id_pedido: 1, total: 1 })).status).toBe(401)
    const result = await request(app).post(url).set('Authorization', bearer()).send({ id_pedido: 1, total: 1 })
    // /pagos/create has an existing allowlist; use its legitimate contract.
    if (url === '/api/pagos/create') {
      expect((await request(app).post(url).set('Authorization', bearer()).send({ id_pedido: 1 })).status).toBe(503)
    } else expect(result.status).toBe(503)
    expect(operations.every((table) => table === 'usuarios')).toBe(true)
  })
  test('direct payment services cannot bypass containment regardless of credentials', async () => {
    await expect(wompi.createPayment({ pedidoId: 1, amount: 1 })).rejects.toMatchObject({ code: 'LEGACY_PAYMENTS_UNAVAILABLE' })
    await expect(pago.createPayment(1)).rejects.toMatchObject({ code: 'LEGACY_PAYMENTS_UNAVAILABLE' })
    await expect(pago.processWebhook(sign())).rejects.toMatchObject({ code: 'LEGACY_PAYMENTS_UNAVAILABLE' })
    expect(supabase.from).not.toHaveBeenCalled()
  })
  test.each([
    ['put', '/api/pedidos/44', { pago: 'pagado' }],
    ['put', '/api/pedidos/44', { total: 1 }],
    ['patch', '/api/pedidos/44/pago', { pago: 'pagado' }],
    ['patch', '/api/pedidos/44/pago', { pago: 'no_pagado' }],
    ['delete', '/api/pedidos/44', {}],
  ])('%s %s cannot mutate purchase data/payment/history', async (method, url, body) => {
    const response = await request(appFor())[method](url).set('Authorization', bearer(99)).send(body)
    expect(response.status).toBe(503)
    expect(response.body.code).toBe('LEGACY_PAYMENTS_UNAVAILABLE')
    expect(operations.every((table) => table === 'usuarios')).toBe(true)
  })
  test('unpaid orders cannot be delivered through the operational endpoint', async () => {
    jest.spyOn(pedidoRepository, 'findById').mockResolvedValue({ id_pedido: 1, estado: 'listo', pago: 'no_pagado' })
    const update = jest.spyOn(pedidoRepository, 'update')
    const response = await request(appFor()).patch('/api/pedidos/1/estado').set('Authorization', bearer(99)).send({ estado: 'entregado' })
    expect(response.status).toBe(503)
    expect(update).not.toHaveBeenCalled()
  })
  test('the service payment/update/delete paths are also contained without repositories', async () => {
    await expect(pedido.updatePedido(1, { pago: 'pagado' })).rejects.toMatchObject({ statusCode: 503 })
    await expect(pedido.updatePedidoPago(1, 'pagado')).rejects.toMatchObject({ statusCode: 503 })
    await expect(pedido.deletePedido(1)).rejects.toMatchObject({ statusCode: 503 })
    expect(supabase.from).not.toHaveBeenCalled()
  })
  test('already-paid orders retain the operational delivery transition', async () => {
    jest.spyOn(pedidoRepository, 'findById').mockResolvedValue({ id_pedido: 1, estado: 'listo', pago: 'pagado' })
    const update = jest.spyOn(pedidoRepository, 'update').mockResolvedValue({ id_pedido: 1, estado: 'entregado', pago: 'pagado' })
    jest.spyOn(auditoria, 'logEvento').mockResolvedValue({})
    const result = await request(appFor()).patch('/api/pedidos/1/estado').set('Authorization', bearer(99)).send({ estado: 'entregado' })
    expect(result.status).toBe(200)
    expect(update).toHaveBeenCalledWith('1', { estado: 'entregado' })
  })
  test('client order creation ignores an injected owner and still uses the authenticated user', async () => {
    const create = jest.spyOn(pedido, 'createPedido').mockResolvedValue({ id_pedido: 10 })
    const result = await request(appFor()).post('/api/pedidos').set('Authorization', bearer())
      .send({ id_cliente: 99, items: [{ id_producto: 1, cantidad: 1 }] })
    expect(result.status).toBe(201)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ id_cliente: 8 }))
  })
})

describe('bounded multipart uploads validate content before storage', () => {
  const png = () => sharp({ create: { width: 2, height: 2, channels: 3, background: '#123456' } }).png().toBuffer()
  test.each(['png', 'jpeg', 'webp'])('valid %s is decoded and accepted with canonical extension', async (format) => {
    const buffer = await sharp(await png()).toFormat(format).toBuffer()
    const response = await request(uploadApp()).post('/upload').attach('file', buffer, { filename: 'unsafe.html',
      contentType: `image/${format}` })
    expect(response.status).toBe(200)
    expect(response.body.name).not.toContain('html')
    expect(response.body.type).toBe(`image/${format}`)
  })
  test.each(['faked-mime', 'wrong-image-type', 'corrupt-image', 'html'])('%s fails safely', async (kind) => {
    let buffer = Buffer.from('<html>QAKEY42</html>')
    if (kind === 'wrong-image-type') buffer = await sharp(await png()).jpeg().toBuffer()
    if (kind === 'corrupt-image') buffer = (await png()).subarray(0, 45)
    const result = await request(uploadApp()).post('/upload').attach('file', buffer,
      { filename: 'QAKEY42.png', contentType: 'image/png' })
    expect([400, 415]).toContain(result.status)
    expect(result.body.code).toBe('INVALID_UPLOAD')
    expect(result.text).not.toContain('QAKEY42')
  })
  test('oversized files get 413 without decoder or storage access', async () => {
    const response = await request(uploadApp({ maxBytes: 64 })).post('/upload')
      .attach('file', Buffer.alloc(65), { filename: 'QAKEY42.png', contentType: 'image/png' })
    expect(response.status).toBe(413)
    expect(response.body.code).toBe('UPLOAD_TOO_LARGE')
    expect(response.text).not.toContain('QAKEY42')
  })
  test('excessive fields and file count fail as controlled requests', async () => {
    let fields = request(uploadApp()).post('/upload')
    for (let i = 0; i < 17; i++) fields = fields.field(`field${i}`, 'QAKEY42')
    expect((await fields).status).toBe(400)
    const response = await request(uploadApp()).post('/upload')
      .attach('file', await png(), 'first.png').attach('file', await png(), 'second.png')
    expect(response.status).toBe(400)
  })
  test('gallery validates every file before any storage side effect', async () => {
    const response = await request(appFor()).post('/api/social/profile/gallery').set('Authorization', bearer())
      .attach('files', await png(), 'valid.png')
      .attach('files', Buffer.from('QAKEY42'), { filename: 'bad.png', contentType: 'image/png' })
    expect(response.status).toBe(415)
    expect(storageCalls).toBe(0)
  })
  test('storage failures do not expose infrastructure details', async () => {
    const response = await request(appFor()).post('/api/social/profile/avatar').set('Authorization', bearer())
      .attach('file', await png(), 'valid.png')
    expect(response.status).toBe(500)
    expect(response.body).not.toHaveProperty('details')
    expect(response.text).not.toContain('Real storage forbidden')
  })
  test('images above the pixel budget fail without storage access', async () => {
    const oversized = await sharp({ create: { width: 4001, height: 4000, channels: 3, background: '#fff' } }).png().toBuffer()
    const response = await request(uploadApp()).post('/upload').attach('file', oversized, 'too-many-pixels.png')
    expect(response.status).toBe(400)
    expect(response.body.code).toBe('INVALID_UPLOAD')
    expect(storageCalls).toBe(0)
  })
  test('two in-flight uploads are allowed; excess is controlled and slots recover', async () => {
    const held = []
    const upload = createValidatedUpload()
    const app = express()
    app.post('/upload/:actor', (req, res, next) => { req.user = { id: req.params.actor }; next() },
      upload.single('file'), (req, res) => held.push(res))
    app.use(errorHandler)
    const image = await png()
    const pending = [1, 2].map((actor) => request(app).post(`/upload/${actor}`).attach('file', image, 'valid.png').then((response) => response.status))
    try {
      const deadline = Date.now() + 2000
      while (held.length < 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5))
      expect(held).toHaveLength(2)
      const rejected = await request(app).post('/upload/3').attach('file', image, 'valid.png')
      expect(rejected.status).toBe(503)
      expect(rejected.body.code).toBe('UPLOAD_BUSY')
    } finally {
      held.forEach((res) => res.sendStatus(200))
      await Promise.all(pending)
    }
    expect((await request(uploadApp()).post('/upload').attach('file', image, 'valid.png')).status).toBe(200)
  })
})

describe('abuse budgets and trusted proxy boundaries', () => {
  test('fixed windows expire and memory stays bounded without accepting new unbounded identities', () => {
    let time = 1000
    const budget = createBudget({ limit: 2, windowMs: 1000, maxKeys: 1, now: () => time })
    expect(budget.consume('a').allowed).toBe(true)
    expect(budget.consume('a').allowed).toBe(true)
    expect(budget.consume('a').allowed).toBe(false)
    expect(budget.consume('b').allowed).toBe(false)
    time += 1000
    expect(budget.consume('b').allowed).toBe(true)
  })
  test('login identity budget prevents distributed-IP retries, with controlled 429 and Retry-After', async () => {
    const app = appFor({ protectedHttp: true })
    for (let i = 0; i < 20; i++) expect((await request(app).post('/api/auth/login').send({ correo: 'fictitious@example.com' })).status).toBe(200)
    const result = await request(app).post('/api/auth/login').send({ correo: 'FICTITIOUS@example.com' })
    expect(result.status).toBe(429)
    expect(result.body.code).toBe('RATE_LIMITED')
    expect(Number(result.headers['retry-after'])).toBeGreaterThan(0)
    expect((await request(app).get('/normal')).status).toBe(200)
  })
  test('spoofed X-Forwarded-For cannot bypass signup limits without a trusted proxy', async () => {
    const app = appFor({ protectedHttp: true })
    for (let i = 0; i < 120; i++) expect((await request(app).post('/api/auth/signup')
      .set('X-Forwarded-For', `198.51.100.${i + 1}`)).status).toBe(201)
    const result = await request(app).post('/api/auth/signup').set('X-Forwarded-For', '203.0.113.99')
    expect(result.status).toBe(429)
    expect(result.body.code).toBe('RATE_LIMITED')
  })
  test('explicit proxy CIDRs select the nearest untrusted hop, never arbitrary leftmost IP', async () => {
    const app = express()
    app.set('trust proxy', compileTrustedProxies('127.0.0.1/32'))
    app.get('/', (req, res) => res.json({ ip: req.ip }))
    const response = await request(app).get('/').set('X-Forwarded-For', '198.51.100.20, 203.0.113.21')
    expect(response.body.ip).toBe('203.0.113.21')
    expect(() => compileTrustedProxies('true')).toThrow()
    expect(() => compileTrustedProxies('1')).toThrow()
    expect(() => compileTrustedProxies('0.0.0.0/0')).toThrow()
    expect(() => compileTrustedProxies('::/0')).toThrow()
  })
  test('authenticated QR validation and reports have separate budgets and no business dispatch on excess', async () => {
    const { authMiddleware } = await import('../src/middlewares/auth.middleware.js')
    const app = express()
    app.post('/api/social/presence/validate-qr', authMiddleware, (req, res) => res.json({ ok: true }))
    app.post('/api/social/safety/reports/profile', authMiddleware, (req, res) => res.json({ ok: true }))
    for (let i = 0; i < 20; i++) expect((await request(app).post('/api/social/presence/validate-qr').set('Authorization', bearer(120))).status).toBe(200)
    expect((await request(app).post('/api/SOCIAL/PRESENCE/VALIDATE-QR/').set('Authorization', bearer(120))).status).toBe(429)
    for (let i = 0; i < 10; i++) expect((await request(app).post('/api/social/safety/reports/profile').set('Authorization', bearer(120))).status).toBe(200)
    expect((await request(app).post('/api/social/safety/reports/profile').set('Authorization', bearer(120))).status).toBe(429)
  })
  test('webhook retries do not consume user signup budgets or get unjustified 429s', async () => {
    const app = appFor({ protectedHttp: true })
    for (let i = 0; i < 35; i++) expect((await request(app).post(urls[0]).send(sign())).status).toBe(503)
    expect((await request(app).post('/api/auth/signup')).status).toBe(201)
    expect(supabase.from).not.toHaveBeenCalled()
  })
  test('case and trailing slash aliases do not bypass public route limits', async () => {
    const app = appFor({ protectedHttp: true })
    for (let i = 0; i < 120; i++) expect((await request(app).post('/api/AUTH/SIGNUP/')).status).toBe(201)
    expect((await request(app).post('/api/auth/signup')).status).toBe(429)
  })
  test('socket handshake and packet budgets are separate and bounded', () => {
    const protection = createSocketProtection()
    for (let i = 0; i < 120; i++) expect(protection.allowHandshake('ip')).toBe(true)
    expect(protection.allowHandshake('ip')).toBe(false)
    for (let i = 0; i < 180; i++) expect(protection.allowPacket(8)).toBe(true)
    expect(protection.allowPacket('8')).toBe(false)
    expect(protection.allowPacket(44)).toBe(true)
  })
  test('actual socket packet middleware drops excess packets before business dispatch and acks once', async () => {
    let authenticate, connected, guard
    const io = { use: (fn) => { authenticate = fn }, on: (event, fn) => { connected = fn } }
    const socket = { id: 'isolated-hardening-socket', data: {}, handshake: { auth: { token: bearer(121).slice(7) } },
      join: jest.fn(), on: jest.fn(), emit: jest.fn(), use: (fn) => { guard = fn } }
    setupSocialSocket(io)
    await authenticate(socket, (error) => { expect(error).toBeUndefined() })
    connected(socket)
    const dispatched = jest.fn(), ack = jest.fn()
    for (let i = 0; i < 181; i++) guard(['chat:send-message', {}, ack], dispatched)
    expect(dispatched).toHaveBeenCalledTimes(180)
    expect(ack).toHaveBeenCalledTimes(1)
    expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: false, code: 'RATE_LIMITED' }))
  })
})
