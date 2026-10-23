import { jest, describe, test, expect, beforeEach, afterEach, afterAll } from '@jest/globals'
import express from 'express'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'

const originalSecret = process.env.JWT_SECRET
const originalDotenvPath = process.env.DOTENV_CONFIG_PATH
process.env.JWT_SECRET = 'loah-isolated-users-security-test-key'
process.env.DOTENV_CONFIG_PATH = 'backend/tests/no-environment-file'
const password = 'Existing!123'
const passwordHash = bcrypt.hashSync(password, 10)
let users
let nextId
let operations

// Return extra columns deliberately: response allowlists must still protect secrets.
const supabase = {
  from: jest.fn((table) => {
    if (table !== 'usuarios') throw new Error(`Unexpected test table: ${table}`)
    let operation = 'select'
    let payload
    let selected
    const filters = []
    const execute = () => {
      operations.push({ operation, selected, filters: [...filters] })
      let rows = [...users.values()].filter((user) =>
        filters.every(([key, value]) => String(user[key]) === String(value))
      )
      if (operation === 'insert') {
        rows = payload.map((user) => ({
          id_usuario: nextId++, venue_id: null, token: 'db-secret', ...user,
        }))
        rows.forEach((user) => users.set(user.id_usuario, user))
      } else if (operation === 'update') {
        rows = rows.map((user) => ({ ...user, ...payload }))
        rows.forEach((user) => users.set(user.id_usuario, user))
      } else if (operation === 'delete') {
        rows.forEach((user) => users.delete(user.id_usuario))
      }
      return { data: rows.map((user) => ({ ...user })), error: null }
    }
    const query = {
      select: (fields) => { selected = fields; return query },
      order: () => query,
      eq: (key, value) => { filters.push([key, value]); return query },
      insert: (value) => { operation = 'insert'; payload = value; return query },
      update: (value) => { operation = 'update'; payload = value; return query },
      delete: () => { operation = 'delete'; return query },
      single: async () => { const result = execute(); return { ...result, data: result.data[0] ?? null } },
      maybeSingle: async () => { const result = execute(); return { ...result, data: result.data[0] ?? null } },
      then: (resolve, reject) => Promise.resolve(execute()).then(resolve, reject),
    }
    return query
  }),
}

// Mock before importing any production modules: dotenv and the real client never load.
jest.unstable_mockModule('../src/config/supabaseClient.js', () => ({ default: supabase }))
const { default: usuariosRoutes } = await import('../src/routes/usuarios.routes.js')
const { default: adminRoutes } = await import('../src/routes/admin.routes.js')
const { default: authRoutes } = await import('../src/routes/auth.routes.js')
const { default: usuarioService } = await import('../src/services/usuario.service.js')
const { default: authService } = await import('../src/services/auth.service.js')
const { default: usuarioRepository } = await import('../src/repositories/usuario.repository.js')
const app = express()
app.use(express.json())
app.use('/api/usuarios', usuariosRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/auth', authRoutes)

const actor = { id: 8, rol: 'cliente' }
const admin = { id: 99, rol: 'admin', venue_id: 1 }
const bearer = (claims = actor, options = {}) =>
  `Bearer ${jwt.sign(claims, process.env.JWT_SECRET, { expiresIn: '1h', ...options })}`
const registration = { nombre: 'New User', correo: 'new@example.com', contrasena: 'NewUser!123' }
const publicFields = ['id_usuario', 'nombre', 'correo', 'rol', 'venue_id', 'fecha_registro'].sort()
const expectOnlyAuthReads = () => {
  expect(operations.every((op) => op.operation === 'select' &&
    op.selected === 'id_usuario, rol, venue_id, is_suspended')).toBe(true)
}
const expectSafeUser = (user) => {
  expect(Object.keys(user).sort()).toEqual(publicFields)
  expect(JSON.stringify(user)).not.toContain(passwordHash)
  expect(JSON.stringify(user)).not.toContain('db-secret')
}

beforeEach(() => {
  users = new Map([
    [8, 'Alicia', 'cliente'], [44, 'Bruno', 'cliente'], [99, 'Admin', 'admin'],
  ].map(([id, nombre, rol]) => [id, {
    id_usuario: id, nombre, rol, correo: `user${id}@example.com`,
    venue_id: id === 99 ? 1 : null, fecha_registro: '2026-01-01T00:00:00.000Z',
    contrasena_hash: passwordHash, token: 'db-secret', refresh_token: 'db-secret',
    internal_secret: 'db-secret', is_suspended: false,
  }]))
  nextId = 100
  operations = []
  supabase.from.mockClear()
  jest.spyOn(usuarioRepository, 'delete')
  jest.spyOn(console, 'debug').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('External network forbidden in user tests') })
})

afterEach(() => {
  expect(usuarioRepository.delete).not.toHaveBeenCalled()
  expect(globalThis.fetch).not.toHaveBeenCalled()
  jest.restoreAllMocks()
})

afterAll(() => {
  if (originalDotenvPath === undefined) delete process.env.DOTENV_CONFIG_PATH
  else process.env.DOTENV_CONFIG_PATH = originalDotenvPath
  if (originalSecret === undefined) delete process.env.JWT_SECRET
  else process.env.JWT_SECRET = originalSecret
})

describe('public registration and authentication', () => {
  test.each(['/api/usuarios', '/api/auth/signup'])('%s rejects public admin assignment', async (url) => {
    const response = await request(app).post(url).send({ ...registration, rol: 'admin' })
    expect(response.status).toBe(400)
    expect(supabase.from).not.toHaveBeenCalled()
    expect(users.size).toBe(3)
  })

  test.each([undefined, 'cliente'])('legacy registration creates only cliente (%s)', async (rol) => {
    const response = await request(app).post('/api/usuarios').send({ ...registration, ...(rol ? { rol } : {}) })
    expect(response.status).toBe(201)
    expect(response.body.rol).toBe('cliente')
    expect(users.get(response.body.id_usuario).rol).toBe('cliente')
    expect(users.get(response.body.id_usuario).is_suspended).toBe(false)
    expect(await bcrypt.compare(registration.contrasena, users.get(response.body.id_usuario).contrasena_hash)).toBe(true)
    expectSafeUser(response.body)
  })

  test('signup, login and me preserve their response contracts without leaking DB secrets', async () => {
    const signup = await request(app).post('/api/auth/signup').send(registration)
    expect(signup.status).toBe(201)
    expect(Object.keys(signup.body)).toEqual(['id_usuario'])
    expect(users.get(signup.body.id_usuario).rol).toBe('cliente')
    expect(users.get(signup.body.id_usuario).is_suspended).toBe(false)
    const login = await request(app).post('/api/auth/login').send({ correo: registration.correo, contrasena: registration.contrasena })
    expect(login.status).toBe(200)
    expect(jwt.verify(login.body.token, process.env.JWT_SECRET).id).toBe(signup.body.id_usuario)
    expectSafeUser(login.body.usuario)
    const me = await request(app).get('/api/auth/me?user_id=44').set('Authorization', `Bearer ${login.body.token}`)
    expect(me.status).toBe(200)
    expect(me.body.id_usuario).toBe(signup.body.id_usuario)
    expectSafeUser(me.body)
  })

  test('invalid login still returns 401 without returning credentials', async () => {
    const response = await request(app).post('/api/auth/login').send({ correo: 'user8@example.com', contrasena: 'wrong' })
    expect(response.status).toBe(401)
    expect(Object.keys(response.body)).toEqual(['error'])
  })

  test.each([
    ['/api/usuarios', false], ['/api/usuarios', true],
    ['/api/auth/signup', false], ['/api/auth/signup', true],
  ])('%s rejects client suspension state %s without creating accounts', async (url, is_suspended) => {
    const response = await request(app).post(url).send({ ...registration, is_suspended })
    expect(response.status).toBe(400)
    expect(supabase.from).not.toHaveBeenCalled()
    expect(users.size).toBe(3)
  })

  test('both public creation services set server-controlled false without a database default', async () => {
    const user = await usuarioService.createUsuario(registration)
    const other = await authService.signup({ ...registration, correo: 'other@example.test', is_suspended: true })
    expect(users.get(user.id_usuario).is_suspended).toBe(false)
    expect(users.get(other.id_usuario).is_suspended).toBe(false)
    await expect(usuarioService.createUsuario({ ...registration, is_suspended: false }))
      .rejects.toMatchObject({ statusCode: 400 })
  })

  test.each([true, null, undefined])('indeterminate or suspended accounts (%s) cannot login through either service', async (is_suspended) => {
    users.get(8).is_suspended = is_suspended
    await expect(authService.login('user8@example.com', password)).rejects.toThrow('Credenciales')
    await expect(usuarioService.authenticateUsuario('user8@example.com', password)).rejects.toThrow('Credenciales')
    const response = await request(app).post('/api/auth/login')
      .send({ correo: 'user8@example.com', contrasena: password })
    expect(response.status).toBe(401)
    expect(response.body).not.toHaveProperty('token')
    expect(users.get(8).is_suspended).toBe(is_suspended)
  })

  test.each(['missing', 'storage-error'])('login denies %s without credentials or internal details', async (kind) => {
    if (kind === 'storage-error') {
      jest.spyOn(usuarioRepository, 'findByEmail').mockRejectedValue(new Error('QAKEY42-storage-details'))
    }
    const correo = 'unavailable-account@example.com'
    await expect(authService.login(correo, password)).rejects.toThrow()
    await expect(usuarioService.authenticateUsuario(correo, password)).rejects.toThrow()
    const response = await request(app).post('/api/auth/login').send({ correo, contrasena: password })
    expect(response.status).toBe(401)
    expect(response.body).not.toHaveProperty('token')
    expect(JSON.stringify(response.body)).not.toMatch(/QAKEY42|storage-details/)
  })
})

describe('account ownership and allowed fields', () => {
  test.each([
    ['get', '/api/usuarios'], ['get', '/api/usuarios/8'],
    ['put', '/api/usuarios/8'], ['delete', '/api/usuarios/8'],
    ['post', '/api/admin/create'], ['put', '/api/admin/users/44/role'],
  ])('%s %s requires authentication', async (method, url) => {
    const response = await request(app)[method](url).send({ nombre: 'Updated' })
    expect(response.status).toBe(401)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  test.each(['invalid', 'expired'])('%s token is rejected', async (kind) => {
    const token = kind === 'invalid' ? 'Bearer invalid' : bearer(actor, { expiresIn: -1 })
    const response = await request(app).get('/api/usuarios/8').set('Authorization', token)
    expect(response.status).toBe(401)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  test.each(['get', 'put', 'delete'])('a client cannot %s another account', async (method) => {
    const response = await request(app)[method]('/api/usuarios/44').set('Authorization', bearer()).send({ nombre: 'Hacked' })
    expect(response.status).toBe(403)
    expectOnlyAuthReads()
    expect(users.get(44).nombre).toBe('Bruno')
  })

  test('a client cannot list private accounts', async () => {
    const response = await request(app).get('/api/usuarios').set('Authorization', bearer())
    expect(response.status).toBe(403)
    expectOnlyAuthReads()
  })

  test.each([
    { rol: 'admin' }, { is_suspended: false }, { venue_id: 2 },
    { id_usuario: 44 }, { user_id: 44 }, { fecha_registro: '2020-01-01' },
    { contrasena_hash: 'injected' }, { token: 'injected' },
  ])('self-service rejects privileged or spoofed fields: %j', async (payload) => {
    const response = await request(app).put('/api/usuarios/8').set('Authorization', bearer()).send({ nombre: 'Updated', ...payload })
    expect(response.status).toBe(400)
    expectOnlyAuthReads()
    expect(users.get(8).rol).toBe('cliente')
  })

  test('the owner can read and edit only the allowed profile fields', async () => {
    const detail = await request(app).get('/api/usuarios/8').set('Authorization', bearer())
    expect(detail.status).toBe(200)
    expectSafeUser(detail.body)
    const response = await request(app).put('/api/usuarios/8').set('Authorization', bearer()).send({ nombre: 'Updated User', correo: 'updated@example.com' })
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ nombre: 'Updated User', correo: 'updated@example.com', rol: 'cliente' })
    expect(users.get(8).contrasena_hash).toBe(passwordHash)
    expectSafeUser(response.body)
  })

  test('owner deletion is unavailable without touching the repository or reporting success', async () => {
    const response = await request(app).delete('/api/usuarios/8').set('Authorization', bearer())
    expect(response.status).toBe(409)
    expect(response.body).toEqual({
      code: 'ACCOUNT_DELETION_UNAVAILABLE',
      error: expect.stringContaining('soporte'),
    })
    expectOnlyAuthReads()
    expect(users.has(8)).toBe(true)
    expect(users.has(44)).toBe(true)
  })

  test.each([99, 44, 123])('admin cannot physically delete account %s or discover its existence', async (id) => {
    const response = await request(app).delete(`/api/usuarios/${id}`).set('Authorization', bearer(admin))
    expect(response.status).toBe(409)
    expect(response.body).toEqual({
      code: 'ACCOUNT_DELETION_UNAVAILABLE',
      error: expect.stringContaining('soporte'),
    })
    expectOnlyAuthReads()
    expect(users.size).toBe(3)
  })

  test('the existing frontend password payload works and never persists currentPassword', async () => {
    const response = await request(app).put('/api/usuarios/8').set('Authorization', bearer()).send({ contrasena: 'Changed!123', currentPassword: password })
    expect(response.status).toBe(200)
    expect(await bcrypt.compare('Changed!123', users.get(8).contrasena_hash)).toBe(true)
    expect(users.get(8)).not.toHaveProperty('currentPassword')
    expect(users.get(8)).not.toHaveProperty('contrasena')
    expectSafeUser(response.body)
  })

  test.each([[undefined, 400], ['wrong', 403]])('password change checks the current password (%s)', async (currentPassword, status) => {
    const response = await request(app).put('/api/usuarios/8').set('Authorization', bearer()).send({ contrasena: 'Changed!123', currentPassword })
    expect(response.status).toBe(status)
    expect(users.get(8).contrasena_hash).toBe(passwordHash)
  })

  test.each(['not-an-id', '-1', '1.5'])('invalid target %s returns 400', async (id) => {
    const response = await request(app).get(`/api/usuarios/${id}`).set('Authorization', bearer())
    expect(response.status).toBe(400)
    expectOnlyAuthReads()
  })

  test('missing account and duplicate email have appropriate status codes', async () => {
    const missing = await request(app).get('/api/usuarios/123').set('Authorization', bearer(admin))
    expect(missing.status).toBe(404)
    const duplicate = await request(app).put('/api/usuarios/8').set('Authorization', bearer()).send({ correo: 'user44@example.com' })
    expect(duplicate.status).toBe(409)
  })

  test('unexpected repository errors are not returned to clients', async () => {
    jest.spyOn(usuarioRepository, 'findById').mockRejectedValueOnce(new Error('database secret details'))
    const response = await request(app).get('/api/usuarios/8').set('Authorization', bearer())
    expect(response.status).toBe(500)
    expect(JSON.stringify(response.body)).not.toContain('secret')
  })
})

describe('explicit administration and service-level defenses', () => {
  test.each([
    ['post', '/api/admin/create', registration],
    ['put', '/api/admin/users/44/role', { rol: 'admin' }],
  ])('clients cannot use %s %s', async (method, url, payload) => {
    const response = await request(app)[method](url).set('Authorization', bearer()).send(payload)
    expect(response.status).toBe(403)
    expectOnlyAuthReads()
  })

  test('admins can list and read accounts without exposing secrets', async () => {
    const response = await request(app).get('/api/usuarios').set('Authorization', bearer(admin))
    expect(response.status).toBe(200)
    expect(response.body).toHaveLength(3)
    response.body.forEach(expectSafeUser)
    const detail = await request(app).get('/api/usuarios/44').set('Authorization', bearer(admin))
    expect(detail.status).toBe(200)
    expectSafeUser(detail.body)
  })

  test('admin creation remains available only through the dedicated flow', async () => {
    const response = await request(app).post('/api/admin/create').set('Authorization', bearer(admin)).send(registration)
    expect(response.status).toBe(201)
    expect(Object.keys(response.body)).toEqual(['id_usuario'])
    expect(users.get(response.body.id_usuario).rol).toBe('admin')
    expect(users.get(response.body.id_usuario).is_suspended).toBe(false)
  })

  test('role changes are limited to the dedicated admin route', async () => {
    const forbidden = await request(app).put('/api/usuarios/44').set('Authorization', bearer(admin)).send({ rol: 'admin' })
    expect(forbidden.status).toBe(400)
    const response = await request(app).put('/api/admin/users/44/role').set('Authorization', bearer(admin)).send({ rol: 'admin' })
    expect(response.status).toBe(200)
    expect(users.get(44).rol).toBe('admin')
    expectSafeUser(response.body.user)
  })

  test('admin profile updates and password reset remain authorized', async () => {
    const updated = await request(app).put('/api/usuarios/44').set('Authorization', bearer(admin)).send({ nombre: 'Managed User', contrasena: 'Reset!123' })
    expect(updated.status).toBe(200)
    expect(await bcrypt.compare('Reset!123', users.get(44).contrasena_hash)).toBe(true)
    expectSafeUser(updated.body)
    expect(users.has(44)).toBe(true)
  })

  test('a role claim without an authenticated user ID grants no admin operation', async () => {
    const response = await request(app).post('/api/admin/create').set('Authorization', bearer({ rol: 'admin' })).send(registration)
    expect(response.status).toBe(401)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  test('services reject missing actors, forbidden fields and privilege injection independently of routes', async () => {
    await expect(usuarioService.getUsuarios()).rejects.toMatchObject({ statusCode: 401 })
    await expect(usuarioService.getUsuarioById(8)).rejects.toMatchObject({ statusCode: 401 })
    await expect(usuarioService.updateUsuario(8, { nombre: 'Hacked' })).rejects.toMatchObject({ statusCode: 401 })
    await expect(usuarioService.deleteUsuario(44, actor)).rejects.toMatchObject({ statusCode: 403 })
    await expect(usuarioService.createAdmin(registration, actor)).rejects.toMatchObject({ statusCode: 403 })
    await expect(usuarioService.changeUserRole(8, { rol: 'admin' }, actor)).rejects.toMatchObject({ statusCode: 403 })
    await expect(usuarioService.createUsuario({ ...registration, rol: 'admin' })).rejects.toMatchObject({ statusCode: 400 })
    await expect(usuarioService.updateUsuario(8, { is_suspended: false }, actor)).rejects.toMatchObject({ statusCode: 400 })
    expect(supabase.from).not.toHaveBeenCalled()
  })

  test.each([
    [8, undefined, 401], [44, actor, 403],
    [8, actor, 409], [44, admin, 409],
  ])('service deletion for target %s with actor %j returns %s', async (id, currentActor, statusCode) => {
    const expected = { statusCode }
    if (statusCode === 409) expected.code = 'ACCOUNT_DELETION_UNAVAILABLE'
    await expect(usuarioService.deleteUsuario(id, currentActor)).rejects.toMatchObject(expected)
    expect(supabase.from).not.toHaveBeenCalled()
    expect(users.size).toBe(3)
  })

  test('external consumers cannot invoke the private creation mechanism', () => {
    expect(usuarioService._createUsuario).toBeUndefined()
    expect(usuarioService['#createUsuario']).toBeUndefined()
    expect(() => usuarioService._createUsuario(registration, 'admin')).toThrow(TypeError)
    expect(() => Function('service', 'return service.#createUsuario({}, "admin")')).toThrow(SyntaxError)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  test.each([undefined, actor])('public admin creation requires an authorized actor: %j', async (currentActor) => {
    await expect(usuarioService.createAdmin(registration, currentActor)).rejects.toMatchObject({
      statusCode: currentActor ? 403 : 401,
    })
    await expect(usuarioService.createUsuario({ ...registration, rol: 'admin' })).rejects.toMatchObject({ statusCode: 400 })
    expect(supabase.from).not.toHaveBeenCalled()
  })
})
