import { jest, beforeAll, beforeEach, afterEach, describe, test, expect } from '@jest/globals'
import http from 'node:http'
import express from 'express'
import sharp from 'sharp'
import { createValidatedUpload } from '../src/middlewares/validated-upload.js'
import { errorHandler } from '../src/middlewares/errorHandler.js'
import { compileTrustedProxies, createHttpAbuseProtection, limitAuthenticatedRequest } from '../src/middlewares/abuse-protection.js'

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const boundary = 'synthetic-upload-test'
const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`)
const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
let jpeg, server, clients, spy

beforeAll(async () => {
  jpeg = await sharp({ create: { width: 80, height: 40, channels: 3, background: '#f00' } }).jpeg().toBuffer()
  // Warm the same lazy import used in production, outside short deadline tests.
  await import('file-type')
})
beforeEach(() => { clients = []; spy = jest.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(async () => {
  for (const client of clients) client.destroy()
  if (server) {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    server = undefined
  }
  spy.mockRestore()
})

async function start({ receptionTimeoutMs = 250, maxBytes, early = false, hold = false } = {}) {
  const app = express()
  const upload = createValidatedUpload({ receptionTimeoutMs, ...(maxBytes ? { maxBytes } : {}) })
  const held = []
  // Fixed server fixture identity, NOT production authentication via route/header.
  app.post('/:actor', (req, res, next) => {
    req.user = { id: Number(req.params.actor) }
    if (early) setImmediate(() => res.sendStatus(403))
    next()
  }, upload.single('file'), (req, res) => {
    if (hold) held.push(res)
    else res.type('image/jpeg').send(req.file.buffer)
  })
  app.use(errorHandler)
  server = http.createServer(app)
  server.testRequests = []
  server.on('request', (req) => server.testRequests.push(req))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return held
}

function send(actor, body, { incomplete = false } = {}) {
  let resolve
  const result = new Promise((done) => { resolve = done })
  const req = http.request({ hostname: '127.0.0.1', port: server.address().port,
    method: 'POST', path: `/${actor}`, headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      Connection: 'close',
    } }, (res) => {
    const buffers = []
    res.on('data', (buffer) => buffers.push(buffer))
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(buffers) }))
    res.on('error', (error) => resolve({ error }))
  })
  req.on('error', (error) => resolve({ error }))
  clients.push(req)
  if (incomplete) req.write(body ?? head)
  else req.end(body ?? Buffer.concat([head, jpeg, tail]))
  return { req, result }
}

async function twoSlotsStillBounded() {
  // If any abort double-decremented the global counter, the third request would
  // be accepted here. Distinct users also prove the shared global bound.
  const first = send(701, undefined, { incomplete: true })
  const second = send(702, undefined, { incomplete: true })
  await delay(25)
  expect((await send(703).result).status).toBe(503)
  first.req.destroy()
  second.req.destroy()
  await delay(25)
}

describe('real HTTP multipart lifecycle', () => {
  test('two abandoned bodies expire and a third valid user can upload afterwards', async () => {
    await start()
    const first = send(1, undefined, { incomplete: true })
    const second = send(2, undefined, { incomplete: true })
    await delay(25)
    expect((await send(3).result).status).toBe(503)
    for (const response of await Promise.all([first.result, second.result])) {
      expect(response.status).toBe(408)
      expect(JSON.parse(response.body).code).toBe('UPLOAD_TIMEOUT')
    }
    expect((await send(3).result).status).toBe(200)
    await twoSlotsStillBounded()
  })

  test('continuous slow bytes cannot reset the absolute reception deadline', async () => {
    await start()
    const slow = send(1, undefined, { incomplete: true })
    const timer = setInterval(() => slow.req.write(Buffer.from('x')), 20)
    try {
      expect((await slow.result).status).toBe(408)
    } finally { clearInterval(timer) }
    expect((await send(1).result).status).toBe(200)
  })

  test('disconnect destroys parsing and recovers user/global slots exactly once', async () => {
    await start()
    const aborted = send(1, undefined, { incomplete: true })
    await delay(25)
    aborted.req.destroy()
    await aborted.result
    await delay(25)
    expect((await send(1).result).status).toBe(200)
    await twoSlotsStillBounded()
  })

  test('same authenticated user cannot occupy both slots, even across requests', async () => {
    await start()
    const first = send(1, undefined, { incomplete: true })
    await delay(25)
    const rejected = await send(1).result
    expect(rejected.status).toBe(429)
    expect(JSON.parse(rejected.body).code).toBe('UPLOAD_USER_BUSY')
    expect(rejected.headers['retry-after']).toBe('3')
    expect((await send(2).result).status).toBe(200)
    first.req.destroy()
  })

  test('two legitimate users process concurrently; reservations last until response completion', async () => {
    const held = await start({ hold: true, receptionTimeoutMs: 500 })
    const first = send(1), second = send(2)
    for (let i = 0; i < 100 && held.length < 2; i++) await delay(5)
    expect(held).toHaveLength(2)
    expect((await send(3).result).status).toBe(503)
    held.forEach((res) => res.sendStatus(200))
    expect((await first.result).status).toBe(200)
    expect((await second.result).status).toBe(200)
  })

  test.each([
    ['broken multipart', () => Buffer.from('not-a-multipart-body'), 400],
    ['truncated JPEG decoder error', () => Buffer.concat([head, jpeg.subarray(0, 120), tail]), 400],
    ['file size limit', () => Buffer.concat([head, jpeg, tail]), 413],
  ])('%s releases resources and returns a controlled error', async (label, makeBody, status) => {
    await start({ ...(status === 413 ? { maxBytes: 128 } : {}) })
    const response = await send(1, makeBody()).result
    expect(response.status).toBe(status)
    expect(JSON.parse(response.body).code).toMatch(/INVALID_UPLOAD|UPLOAD_TOO_LARGE/)
    await twoSlotsStillBounded()
  })

  test('size error with an unfinished body is still bounded by the reception deadline', async () => {
    await start({ maxBytes: 128 })
    const response = await send(1, Buffer.concat([head, jpeg]), { incomplete: true }).result
    expect(response.status).toBe(408)
    await twoSlotsStillBounded()
  })

  test('early response cancels unfinished parser and does not retain a reservation', async () => {
    await start({ early: true })
    expect((await send(1, undefined, { incomplete: true }).result).status).toBe(403)
    expect((await send(1, undefined, { incomplete: true }).result).status).toBe(403)
  })

  test('successful response clears its reception timer and removes lifecycle listeners', async () => {
    const timers = []
    const original = globalThis.setTimeout
    const timerSpy = jest.spyOn(globalThis, 'setTimeout').mockImplementation((fn, ms, ...args) => {
      const timer = original(fn, ms, ...args)
      if (ms === 1357) timers.push(timer)
      return timer
    })
    try {
      await start({ receptionTimeoutMs: 1357 })
      expect((await send(1).result).status).toBe(200)
      expect(timers).toHaveLength(1)
      expect(timers[0]._destroyed).toBe(true)
      const req = server.testRequests[0]
      expect(req.listeners('aborted').some((fn) => fn.name === 'close')).toBe(false)
      expect(req.listeners('error').some((fn) => fn.name === 'close')).toBe(false)
      expect(req.res.listeners('finish').some((fn) => fn.name === 'close')).toBe(false)
      expect(req.res.listeners('close').some((fn) => fn.name === 'close')).toBe(false)
    } finally { timerSpy.mockRestore() }
  })
})

async function markedImage(orientation) {
  const width = 80, height = 40
  const pixels = Buffer.alloc(width * height * 3)
  const colors = [[240, 10, 10], [10, 230, 10], [10, 10, 240], [230, 220, 10]]
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const color = colors[(y >= height / 2 ? 2 : 0) + (x >= width / 2 ? 1 : 0)]
    color.forEach((v, c) => { pixels[(y * width + x) * 3 + c] = v })
  }
  let image = sharp(pixels, { raw: { width, height, channels: 3 } }).jpeg({ quality: 100 })
  if (orientation) image = image.withMetadata({ orientation }).withExifMerge({ IFD0: { Artist: 'SYNTHETIC PRIVATE MARKER' } })
  return image.toBuffer()
}

async function corners(buffer) {
  const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true })
  return [[.25, .25], [.75, .25], [.25, .75], [.75, .75]].map(([x, y]) => {
    const offset = (Math.floor(y * info.height) * info.width + Math.floor(x * info.width)) * info.channels
    const [r, g, b] = data.subarray(offset, offset + 3)
    return r > 150 && g > 150 ? 'yellow' : r > g && r > b ? 'red' : g > b ? 'green' : 'blue'
  })
}

describe('EXIF orientation is applied to pixels before metadata removal', () => {
  test.each([
    [1, 80, 40, ['red', 'green', 'blue', 'yellow']],
    [3, 80, 40, ['yellow', 'blue', 'green', 'red']],
    [6, 40, 80, ['blue', 'red', 'yellow', 'green']],
    [8, 40, 80, ['green', 'yellow', 'red', 'blue']],
    [undefined, 80, 40, ['red', 'green', 'blue', 'yellow']],
  ])('orientation %s has expected dimensions, pixels, and no private EXIF', async (orientation, width, height, markers) => {
    await start()
    const input = await markedImage(orientation)
    if (orientation) expect((await sharp(input).metadata()).exif.toString()).toContain('SYNTHETIC PRIVATE MARKER')
    const output = await send(1, Buffer.concat([head, input, tail])).result
    expect(output.status).toBe(200)
    const metadata = await sharp(output.body).metadata()
    expect(metadata).toMatchObject({ width, height })
    expect(metadata.exif).toBeUndefined()
    expect(metadata.orientation).toBeUndefined()
    expect(await corners(output.body)).toEqual(markers)
    const again = await send(1, Buffer.concat([head, output.body, tail])).result
    expect(await corners(again.body)).toEqual(markers)
    expect(await sharp(again.body).metadata()).toMatchObject({ width, height })
  })
})

describe('shared NAT and proxy boundaries', () => {
  test('120 separate signups on shared Wi-Fi pass; header rotation does not bypass request 121', async () => {
    const app = express()
    app.set('trust proxy', compileTrustedProxies(''))
    app.use(express.json(), createHttpAbuseProtection())
    app.post('/api/auth/signup', (req, res) => res.sendStatus(201))
    server = http.createServer(app)
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { default: request } = await import('supertest')
    for (let i = 0; i < 120; i++) {
      expect((await request(server).post('/api/auth/signup').set('X-Forwarded-For', `198.51.100.${i + 1}`)
        .send({ correo: `synthetic-${i}@example.invalid` })).status).toBe(201)
    }
    const result = await request(server).post('/api/auth/signup').set('X-Forwarded-For', '203.0.113.10')
    expect(result.status).toBe(429)
    expect(Number(result.headers['retry-after'])).toBeGreaterThan(0)
  })

  test('different authenticated users behind one IP have independent QR budgets', async () => {
    const app = express()
    app.post('/:actor/validate-qr', (req, res) => {
      req.user = { id: `isolated-upload-suite-${req.params.actor}` }
      if (limitAuthenticatedRequest(req, res)) res.sendStatus(200)
    })
    const { default: request } = await import('supertest')
    for (let i = 0; i < 20; i++) expect((await request(app).post('/1/validate-qr')).status).toBe(200)
    expect((await request(app).post('/1/validate-qr')).status).toBe(429)
    expect((await request(app).post('/2/validate-qr')).status).toBe(200)
  })
})
