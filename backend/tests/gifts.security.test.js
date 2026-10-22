import { jest, describe, test, expect, beforeEach, afterEach, afterAll } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const originalSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'isolated-gifts-security-test-key';
let tables;
let operations;
let failure;
let readBarrier;
const emissions = [];
const io = { to: (room) => ({ emit: (event, payload) => emissions.push({ room, event, payload }) }) };
const chat = { createConversationFromGift: jest.fn() };
const presence = { getActivePresenceSession: jest.fn() };

// The real client never loads. Queries run only against these per-test rows.
// Deliberately return extra columns to verify response allowlists independently of SELECT.
const supabase = {
  from: jest.fn((table) => {
    if (!tables[table]) throw new Error(`Unexpected test table: ${table}`);
    let operation = 'select';
    let payload;
    const filters = [];
    const execute = () => {
      operations.push({ table, operation, payload, filters: [...filters] });
      if (failure?.table === table && failure.operation === operation) {
        return { data: null, error: { message: 'db-private-token-secret', ...failure.error } };
      }
      let rows = tables[table].filter((row) => filters.every((fn) => fn(row)));
      if (operation === 'update') {
        rows.forEach((row) => Object.assign(row, payload));
      } else if (operation === 'insert') {
        rows = [{ id: 900 + tables[table].length, is_read: false, internal_secret: 'db-private-token-secret', ...payload }];
        tables[table].push(...rows);
      }
      return { data: rows.map((row) => ({ ...row })), error: null };
    };
    const single = async () => {
      const result = execute();
      // Force both responders to read pending before either may UPDATE.
      if (readBarrier && table === 'gifts' && operation === 'select') await readBarrier();
      return { ...result, data: result.data?.[0] ?? null };
    };
    const query = {
      select: () => query,
      order: () => query,
      limit: () => query,
      eq: (key, value) => { filters.push((row) => String(row[key]) === String(value)); return query; },
      is: (key, value) => { filters.push((row) => row[key] === value); return query; },
      in: (key, values) => { filters.push((row) => values.map(String).includes(String(row[key]))); return query; },
      gt: (key, value) => { filters.push((row) => row[key] > value); return query; },
      gte: (key, value) => { filters.push((row) => row[key] >= value); return query; },
      or: (expression) => {
        if (table === 'social_user_blocks') {
          const pairs = [...expression.matchAll(/blocker_id.eq.(\d+),blocked_id.eq.(\d+)/g)];
          if (pairs.length !== 2) throw new Error('Unsupported block predicate');
          filters.push((row) => pairs.some(([, a, b]) => Number(row.blocker_id) === Number(a) && Number(row.blocked_id) === Number(b)));
        } else if (table === 'gifts' && expression.startsWith('status.eq.pending,')) {
          const now = expression.split('redeem_expires_at.gt.')[1].slice(0, -1);
          filters.push((row) => row.status === 'pending' ||
            (['accepted_anon', 'accepted_id', 'accepted_chat'].includes(row.status) && row.redeem_expires_at > now));
        } else throw new Error('Unsupported OR predicate');
        return query;
      },
      insert: (value) => { operation = 'insert'; payload = value; return query; },
      update: (value) => { operation = 'update'; payload = value; return query; },
      single,
      maybeSingle: single,
      then: (resolve, reject) => Promise.resolve(execute()).then(resolve, reject),
    };
    return query;
  }),
};

jest.unstable_mockModule('../src/config/supabaseClient.js', () => ({ default: supabase }));
jest.unstable_mockModule('../src/modules/social/chat.service.js', () => ({ default: chat }));
jest.unstable_mockModule('../src/modules/social/social.service.js', () => ({ default: presence }));
jest.unstable_mockModule('../src/sockets/socketStore.js', () => ({ getIO: () => io }));
jest.unstable_mockModule('../src/sockets/socketInstance.js', () => ({ getSocketInstance: () => io }));
const { default: router } = await import('../src/modules/social/gifts.router.js');
const { default: service } = await import('../src/modules/social/gifts.service.js');
const app = express();
app.use(express.json());
app.use('/api/social/gifts', router);

const sender = { id: 8, rol: 'cliente' };
const receiver = { id: 44, rol: 'cliente' };
const thirdParty = { id: 55, rol: 'cliente' };
const admin = { id: 99, rol: 'admin', venue_id: 1 };
const token = 'a35a5a9d-cd27-41fb-8126-52151e7d11ab';
const base = '/api/social/gifts';
const sendBody = { venue_id: 1, receiver_id: 44, product_id: 7 };
const http = (method, path, actor, body) => {
  const req = request(app)[method](`${base}${path}`);
  if (actor) req.set('Authorization', `Bearer ${jwt.sign(actor, process.env.JWT_SECRET, { expiresIn: '1h' })}`);
  return body === undefined ? req : req.send(body);
};
const mutations = () => operations.filter((op) => op.operation !== 'select');
const expectHold = (res) => {
  expect(res.status).toBe(409);
  expect(res.body.code).toBe('GIFTS_PAYMENTS_UNAVAILABLE');
  expect(mutations()).toEqual([]);
  expect(emissions).toEqual([]);
  expect(chat.createConversationFromGift).not.toHaveBeenCalled();
};

beforeEach(() => {
  const future = new Date(Date.now() + 3600000).toISOString();
  tables = {
    gifts: [
      { id: 100, sender_id: 8, receiver_id: 44, venue_id: 1, story_id: null, product_id: 7,
        product_nombre: 'Bebida', product_precio: 12000, status: 'pending', redeem_token: null,
        redeem_expires_at: null, redeemed_at: null, internal_secret: 'db-private-token-secret' },
      { id: 101, sender_id: 8, receiver_id: 44, venue_id: 1, status: 'accepted_id',
        product_nombre: 'Bebida', product_precio: 12000, redeem_token: token,
        redeem_expires_at: future, redeemed_at: null, internal_secret: 'db-private-token-secret' },
    ],
    usuarios: [8, 44, 55, 99].map((id) => ({ id_usuario: id, nombre: `User ${id}`, is_suspended: false })),
    social_profiles: [{ user_id: 8, display_name: 'Sender', avatar_url: 'https://example.test/avatar.png' },
      { user_id: 44, allow_gifts: true, allow_chat: true }],
    venues: [{ id: 1 }],
    productos: [{ id_producto: 7, nombre: 'Bebida', precio: 12000, venue_id: 1, disponible: true }],
    stories: [{ id: 10, user_id: 44, venue_id: 1 }],
    social_user_blocks: [],
    social_notifications: [],
  };
  operations = [];
  emissions.length = 0;
  failure = null;
  readBarrier = null;
  supabase.from.mockClear();
  chat.createConversationFromGift.mockReset();
  presence.getActivePresenceSession.mockReset().mockImplementation(async ({ user_id, venue_id }) => ({ user_id, venue_id }));
  jest.spyOn(console, 'debug').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('External network forbidden'); });
});

afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  jest.restoreAllMocks();
});
afterAll(() => {
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});

describe('mandatory JWT and actor identity', () => {
  test.each([
    ['post', '/send'], ['post', '/100/respond'], ['get', '/pending?receiver_id=44'],
    ['get', `/redeem/${token}`], ['post', `/redeem/${token}`],
    ['post', '/100/reaction'], ['get', '/100/reactions'],
  ])('%s %s rejects anonymous requests', async (method, path) => {
    const res = await http(method, path, null, method === 'post' ? {} : undefined);
    expect(res.status).toBe(401);
    expect(supabase.from).not.toHaveBeenCalled();
  });
  test.each(['not-a-jwt', jwt.sign(sender, 'wrong-secret'), jwt.sign(sender, process.env.JWT_SECRET, { expiresIn: -1 })])(
    'invalid or expired JWT is rejected', async (jwtToken) => {
      const res = await request(app).get(`${base}/pending`).set('Authorization', `Bearer ${jwtToken}`);
      expect(res.status).toBe(401);
      expect(supabase.from).not.toHaveBeenCalled();
    });
  test('send rejects a forged sender', async () => {
    const res = await http('post', '/send', sender, { ...sendBody, sender_id: 55 });
    expect(res.status).toBe(403);
    expect(supabase.from).not.toHaveBeenCalled();
  });
  test('pending rejects someone else even for an admin', async () => {
    for (const actor of [sender, admin]) {
      expect((await http('get', '/pending?receiver_id=44', actor)).status).toBe(403);
    }
    expect(supabase.from).not.toHaveBeenCalled();
  });
  test('response rejects forged body identity before querying', async () => {
    const res = await http('post', '/100/respond', sender, { receiver_id: 44, response: 'declined' });
    expect(res.status).toBe(403);
    expect(supabase.from).not.toHaveBeenCalled();
  });
  test.each([sender, thirdParty, admin])('only the stored receiver can respond (%j)', async (actor) => {
    const res = await http('post', '/100/respond', actor, { response: 'declined' });
    const missing = await http('post', '/999/respond', actor, { response: 'declined' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual(missing.body);
    expect(mutations()).toEqual([]);
  });
  test.each(['id', 'id_usuario', 'user_id'])('JWT %s is supported without a body receiver', async (field) => {
    const res = await http('get', '/pending', { [field]: 44, rol: 'cliente' });
    expect(res.status).toBe(200);
    expect(res.body.map((gift) => gift.id)).toEqual([100, 101]);
  });
});

describe('private reads and strict payloads', () => {
  test('receiver sees only own rows, public identity and own QR; extra DB fields never escape', async () => {
    tables.gifts.push({ ...tables.gifts[1], id: 102, receiver_id: 55, redeem_token: 'third-party-token' });
    const res = await http('get', '/pending?receiver_id=44', receiver);
    expect(res.status).toBe(200);
    expect(res.body.map((gift) => gift.id)).toEqual([100, 101]);
    expect(res.body[0].sender_nombre).toBe('Sender');
    expect(res.body[0].sender_foto).toBe('https://example.test/avatar.png');
    expect(res.body[1].redeem_token).toBe(token);
    expect(JSON.stringify(res.body)).not.toMatch(/third-party-token|db-private-token-secret/);
  });
  test('sender cannot obtain the receiver QR through pending', async () => {
    const res = await http('get', '/pending', sender);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
  test('redeemed and expired accepted gifts are excluded', async () => {
    tables.gifts[1].status = 'redeemed';
    tables.gifts.push({ ...tables.gifts[1], id: 103, status: 'accepted_chat', redeem_expires_at: '2000-01-01T00:00:00Z' });
    const res = await http('get', '/pending', receiver);
    expect(res.body.map((gift) => gift.id)).toEqual([100]);
  });
  test.each(['status', 'redeem_token', 'redeemed_by', 'actor', 'payment_status'])('send rejects unexpected %s', async (key) => {
    const res = await http('post', '/send', sender, { ...sendBody, [key]: 'forged' });
    expect(res.status).toBe(400);
    expect(supabase.from).not.toHaveBeenCalled();
  });
  test('response rejects injected privileged fields and invalid message', async () => {
    for (const body of [{ response: 'declined', redeem_token: 'forged' }, { response: 'declined', message: {} },
      { response: 'declined', message: 'a'.repeat(1001) }, { response: 'redeemed' }]) {
      expect((await http('post', '/100/respond', receiver, body)).status).toBe(400);
    }
    expect(mutations()).toEqual([]);
  });
  test.each([true, [], {}, '1.5', -1, 0])('malformed receiver ID %j cannot become an identity', async (receiver_id) => {
    expect((await http('post', '/send', sender, { ...sendBody, receiver_id })).status).toBe(400);
    expect(mutations()).toEqual([]);
  });
  test('database details are not returned in errors', async () => {
    failure = { table: 'gifts', operation: 'select' };
    const res = await http('get', '/pending', receiver);
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('db-private-token-secret');
  });
  test.each(['/100/reaction', '/100/reactions'])('unused broken legacy alias %s fails closed', async (path) => {
    const res = await http(path.endsWith('reactions') ? 'get' : 'post', path, sender, {});
    expect(res.status).toBe(410);
    expect(supabase.from).not.toHaveBeenCalled();
  });
});

describe('eligibility is preserved before the financial hold', () => {
  test('self gifting is forbidden', async () => {
    expect((await http('post', '/send', sender, { ...sendBody, receiver_id: 8 })).status).toBe(400);
    expect(mutations()).toEqual([]);
  });
  test.each(['hidden', 'contact_only', 'emergency'])('bilateral %s blocking forbids send', async (visibility_mode) => {
    tables.social_user_blocks.push({ blocker_id: 44, blocked_id: 8, visibility_mode });
    const res = await http('post', '/send', sender, sendBody);
    expect(res.status).toBe(403);
    expect(mutations()).toEqual([]);
  });
  test.each([8, 44])('valid presence is required for user %s', async (missingId) => {
    presence.getActivePresenceSession.mockImplementation(async ({ user_id, venue_id }) => user_id === missingId ? null : { venue_id });
    const res = await http('post', '/send', sender, sendBody);
    expect(res.status).toBe(400);
    expect(presence.getActivePresenceSession).toHaveBeenCalledWith({ user_id: missingId, venue_id: 1 });
    expect(mutations()).toEqual([]);
  });
  test('a disabled gift preference is respected', async () => {
    tables.social_profiles[1].allow_gifts = false;
    expect((await http('post', '/send', sender, sendBody)).status).toBe(400);
    expect(mutations()).toEqual([]);
  });
  test.each([8, 44])('suspended user %s is ineligible', async (id) => {
    tables.usuarios.find((u) => u.id_usuario === id).is_suspended = true;
    expect((await http('post', '/send', sender, sendBody)).status).toBe(400);
    expect(mutations()).toEqual([]);
  });
  test('nonexistent receiver is ineligible', async () => {
    expect((await http('post', '/send', sender, { ...sendBody, receiver_id: 999 })).status).toBe(400);
    expect(mutations()).toEqual([]);
  });
  test('product must be available and belong to the resolved venue', async () => {
    tables.productos[0].venue_id = 2;
    expect((await http('post', '/send', sender, sendBody)).status).toBe(400);
    tables.productos[0].venue_id = 1;
    tables.productos[0].disponible = false;
    expect((await http('post', '/send', sender, sendBody)).status).toBe(400);
    expect(mutations()).toEqual([]);
  });
  test('story venue and owner cannot be contradicted by the body', async () => {
    expect((await http('post', '/send', sender, { ...sendBody, story_id: 10, venue_id: 2 })).status).toBe(400);
    expect((await http('post', '/send', sender, { ...sendBody, story_id: 10, receiver_id: 55 })).status).toBe(400);
    expect(mutations()).toEqual([]);
  });
  test.each([{}, { story_id: 10 }, { sender_id: '8' }])('eligible story/direct send is contained without writes (%j)', async (extra) => {
    expectHold(await http('post', '/send', sender, { ...sendBody, ...extra }));
  });
});

describe('authorized responses, side effects and concurrent claims', () => {
  test('opaque UUID gift IDs keep working without assuming an undocumented numeric PK', async () => {
    const id = '196b547c-cdf2-4e25-8ddc-449754ae2041';
    tables.gifts[0].id = id;
    const res = await http('post', `/${id}/respond`, receiver, { response: 'declined' });
    expect(res.status).toBe(200);
    expect(res.body.gift_id).toBe(id);
    expect(tables.gifts[0].status).toBe('declined');
  });
  test('receiver can decline; anonymous notification and realtime rooms remain correct', async () => {
    const res = await http('post', '/100/respond', receiver, { receiver_id: '44', response: 'declined' });
    expect(res.status).toBe(200);
    expect(tables.gifts[0].status).toBe('declined');
    expect(tables.gifts[0].redeem_token).toBeNull();
    expect(tables.social_notifications).toHaveLength(1);
    const event = emissions.find((e) => e.event === 'notification:new');
    expect(event.room).toBe('user:8');
    expect(event.payload.user_id).toBe(8);
    expect(event.payload.actor_id).toBeNull();
    expect(event.payload.metadata.response).toBe('declined');
    expect(event.payload.metadata.actor_name).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('db-private-token-secret');
    const sent = emissions.find((e) => e.event === 'gift:responded' && e.room === 'user:8');
    expect(sent.payload).not.toHaveProperty('redeem_token');
    expect(sent.payload).not.toHaveProperty('notification');
    expect(emissions.some((e) => e.event === 'gift:pending-updated' && e.room === 'user:44')).toBe(true);
    expect(chat.createConversationFromGift).not.toHaveBeenCalled();
  });
  test('repeat decline creates no second notification', async () => {
    expect((await http('post', '/100/respond', receiver, { response: 'declined' })).status).toBe(200);
    expect((await http('post', '/100/respond', receiver, { response: 'declined' })).status).toBe(404);
    expect(tables.social_notifications).toHaveLength(1);
    expect(emissions.filter((e) => e.event === 'notification:new')).toHaveLength(1);
    expect(mutations().filter((op) => op.table === 'gifts')).toHaveLength(1);
  });
  test('simultaneous pending reads produce one successful CAS and one notification', async () => {
    let release;
    const both = new Promise((resolve) => { release = resolve; });
    let count = 0;
    readBarrier = async () => { if (++count === 2) release(); await both; };
    const results = await Promise.allSettled([1, 2].map(() => service.respondGift({ actor: receiver, gift_id: 100, response: 'declined' })));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected').reason.statusCode).toBe(409);
    expect(tables.social_notifications).toHaveLength(1);
    expect(mutations().filter((op) => op.table === 'gifts')).toHaveLength(2);
  });
  test.each(['accepted_anon', 'accepted_id', 'accepted_chat'])('%s cannot generate unpaid tokens or chat', async (response) => {
    expectHold(await http('post', '/100/respond', receiver, { response, message: 'Gracias' }));
    expect(tables.gifts[0].status).toBe('pending');
  });
  test('repeating an accepted response has no side effects', async () => {
    const res = await http('post', '/101/respond', receiver, { response: 'accepted_chat' });
    expect(res.status).toBe(404);
    expect(mutations()).toEqual([]);
    expect(chat.createConversationFromGift).not.toHaveBeenCalled();
  });
  test('simultaneous accept and decline cannot create a QR or duplicate notification', async () => {
    const results = await Promise.allSettled(['accepted_chat', 'declined'].map((response) =>
      service.respondGift({ actor: receiver, gift_id: 100, response })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(tables.gifts[0].status).toBe('declined');
    expect(tables.social_notifications).toHaveLength(1);
    expect(chat.createConversationFromGift).not.toHaveBeenCalled();
  });
  test('failed conditional update produces no notification or emit', async () => {
    failure = { table: 'gifts', operation: 'update' };
    const res = await http('post', '/100/respond', receiver, { response: 'declined' });
    expect(res.status).toBe(500);
    expect(tables.gifts[0].status).toBe('pending');
    expect(tables.social_notifications).toEqual([]);
    expect(emissions).toEqual([]);
  });
  test('notification failure cannot allow replay of a committed rejection', async () => {
    failure = { table: 'social_notifications', operation: 'insert' };
    expect((await http('post', '/100/respond', receiver, { response: 'declined' })).status).toBe(500);
    expect(tables.gifts[0].status).toBe('declined');
    failure = null;
    expect((await http('post', '/100/respond', receiver, { response: 'declined' })).status).toBe(404);
    expect(tables.social_notifications).toEqual([]);
  });
});

describe('venue-scoped token access and redemption containment', () => {
  test.each(['get', 'post'])('%s token endpoint denies all ordinary users including receiver and sender', async (method) => {
    for (const actor of [sender, receiver, thirdParty, { id: 77, rol: 'mesero', venue_id: 1 }]) {
      expect((await http(method, `/redeem/${token}`, actor, method === 'post' ? {} : undefined)).status).toBe(403);
    }
    expect(supabase.from).not.toHaveBeenCalled();
  });
  test.each(['get', 'post'])('%s denies another venue admin without revealing gift details', async (method) => {
    const actor = { ...admin, venue_id: 2 };
    const res = await http(method, `/redeem/${token}`, actor, method === 'post' ? {} : undefined);
    const missing = await http(method, '/redeem/does-not-exist', actor, method === 'post' ? {} : undefined);
    expect(res.status).toBe(404);
    expect(res.body).toEqual(missing.body);
    expect(mutations()).toEqual([]);
    expect(JSON.stringify(res.body)).not.toContain(token);
  });
  test('admin without assigned venue has no global bypass', async () => {
    const res = await http('get', `/redeem/${token}`, { id: 99, rol: 'admin' });
    expect(res.status).toBe(403);
    expect(supabase.from).not.toHaveBeenCalled();
  });
  test('own venue admin can inspect the QR without participant IDs or extra fields', async () => {
    const res = await http('get', `/redeem/${token}`, admin);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(101);
    expect(res.body.redeem_token).toBe(token);
    expect(res.body).not.toHaveProperty('sender_id');
    expect(res.body).not.toHaveProperty('receiver_id');
    expect(res.body).not.toHaveProperty('redeemed_by');
    expect(JSON.stringify(res.body)).not.toContain('db-private-token-secret');
    expect(res.body.isRedeemable).toBe(false);
  });
  test('authorized redemption is deliberately held until funding is implemented', async () => {
    expectHold(await http('post', `/redeem/${token}`, admin, {}));
    expect(tables.gifts[1].status).toBe('accepted_id');
  });
  test('already redeemed QR is rejected without another notification', async () => {
    tables.gifts[1].status = 'redeemed';
    tables.gifts[1].redeemed_at = new Date().toISOString();
    const res = await http('post', `/redeem/${token}`, admin, {});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('GIFT_NOT_AVAILABLE');
    expect(mutations()).toEqual([]);
    expect(emissions).toEqual([]);
  });
  test.each([null, '2000-01-01T00:00:00Z', 'invalid'])('invalid or expired deadline %s is rejected', async (expiresAt) => {
    tables.gifts[1].redeem_expires_at = expiresAt;
    const res = await http('post', `/redeem/${token}`, admin, {});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('GIFT_NOT_AVAILABLE');
    expect(mutations()).toEqual([]);
  });
});

describe('services do not bypass route authorization', () => {
  test.each([
    ['sendGift', { ...sendBody, sender_id: 8 }],
    ['respondGift', { gift_id: 100, receiver_id: 44, response: 'declined' }],
    ['getPendingGifts', { receiver_id: 44 }],
    ['getRedeemGiftByToken', { token }],
    ['redeemGiftByToken', { token, admin_id: 99 }],
  ])('%s requires a server-authenticated actor', async (method, args) => {
    await expect(service[method](args)).rejects.toMatchObject({ statusCode: 401 });
    expect(supabase.from).not.toHaveBeenCalled();
  });
  test('direct service calls reject forged identities, ordinary staff and third parties', async () => {
    await expect(service.sendGift({ ...sendBody, sender_id: 55, actor: sender })).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.getPendingGifts({ receiver_id: 44, actor: sender })).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.respondGift({ gift_id: 100, receiver_id: 44, actor: sender, response: 'declined' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.getRedeemGiftByToken({ token, actor: receiver })).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.redeemGiftByToken({ token, actor: { ...admin, venue_id: 2 } })).rejects.toMatchObject({ statusCode: 404 });
    expect(mutations()).toEqual([]);
    expect(service._createGiftOrder).toBeUndefined();
  });
});
