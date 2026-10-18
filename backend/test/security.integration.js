const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes, generateKeyPairSync, createHash, sign } = require('node:crypto');
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const express = require('express');
const { isoCBOR } = require('@simplewebauthn/server/helpers');

const origin = 'https://party.example.test';
const hostScreenKey = 'integration-only-hostscreen-key';
const digest = (value) => createHash('sha256').update(value).digest();

function authenticator() {
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicKey = keys.publicKey.export({ format: 'jwk' });
  const credentialId = randomBytes(32);
  const credential = { id: credentialId.toString('base64url'), rawId: credentialId.toString('base64url'),
    type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform' };
  let userHandle;
  let counter = 0;
  return {
    id: credential.id,
    register(options) {
      userHandle = options.user.id;
      const cose = isoCBOR.encode(new Map([[1, 2], [3, -7], [-1, 1],
        [-2, Buffer.from(publicKey.x, 'base64url')], [-3, Buffer.from(publicKey.y, 'base64url')]]));
      const length = Buffer.alloc(2);
      length.writeUInt16BE(credentialId.length);
      const authData = Buffer.concat([digest(options.rp.id), Buffer.from([0x45]), Buffer.alloc(4),
        Buffer.alloc(16), length, credentialId, Buffer.from(cose)]);
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin }));
      return { ...credential, response: { clientDataJSON: clientDataJSON.toString('base64url'), transports: ['internal'],
        attestationObject: Buffer.from(isoCBOR.encode(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]))).toString('base64url') } };
    },
    login(options, { verified = true, requestOrigin = origin, tamper = false } = {}) {
      counter += 1;
      const count = Buffer.alloc(4);
      count.writeUInt32BE(counter);
      const authenticatorData = Buffer.concat([digest(options.rpId), Buffer.from([verified ? 0x05 : 0x01]), count]);
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin: requestOrigin }));
      const signature = sign('sha256', Buffer.concat([authenticatorData, digest(clientDataJSON)]), keys.privateKey);
      if (tamper) signature[signature.length - 1] ^= 1;
      return { ...credential, response: { clientDataJSON: clientDataJSON.toString('base64url'),
        authenticatorData: authenticatorData.toString('base64url'), signature: signature.toString('base64url'), userHandle } };
    },
  };
}

test('PostgreSQL passkey and invitation security integration', async (context) => {
  const connectionString = process.env.TEST_DATABASE_URL;
  assert.ok(connectionString, 'Set TEST_DATABASE_URL to a disposable PostgreSQL database ending in _test.');
  assert.match(new URL(connectionString).pathname, /_test$/);
  const schema = `security_${randomUUID().replace(/-/g, '')}`;
  const root = new Pool({ connectionString });
  await root.query(`CREATE SCHEMA ${schema}`);
  const database = new Pool({ connectionString, options: `-c search_path=${schema},public` });
  let server;
  context.after(async () => {
    if (server) await new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); });
    await database.end();
    await root.query(`DROP SCHEMA ${schema} CASCADE`);
    await root.end();
  });
  const migrations = path.join(__dirname, '../db/migrations');
  for (const name of readdirSync(migrations).sort((first, second) => first.localeCompare(second, undefined, { numeric: true }))) {
    if (name.endsWith('.sql')) await database.query(readFileSync(path.join(migrations, name), 'utf8'));
  }
  require.cache[require.resolve('../db/db')] = { exports: database };
  const { createAuth, hashToken } = require('../middleware/auth');
  const { APP_REDIRECT_URI } = require('../lib/appLogin');
  const auth = createAuth({ database });
  const { createAuthRoutes } = require('../routes/auth');
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use('/api/auth', createAuthRoutes({ database, settings: { PASSKEY_ORIGIN: origin, HOST_SCREEN_LOGIN_KEY: hostScreenKey }, limiter: (req, res, next) => next() }));
  app.use('/api/parties', require('../routes/parties'));
  app.use('/api/queue', auth.requireAuth, require('../routes/queue'));
  app.use('/api/youtube', auth.requireAuth, require('../routes/youtube'));
  app.use('/api/ssmusic', auth.requireAuth, require('../routes/ssmusic').createSsmusicRoutes({
    database, auth, client: { request: async () => { throw new Error('HOSTSCREEN must never call upstream search'); } },
  }).apiRouter);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  delete process.env.YOUTUBE_API_KEY;

  async function request(endpoint, { method = 'GET', body, token, requestOrigin = origin } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (requestOrigin !== null) headers.Origin = requestOrigin;
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${baseUrl}${endpoint}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    return { status: response.status, data: text ? JSON.parse(text) : null,
      cacheControl: response.headers.get('cache-control') };
  }
  const post = (endpoint, body, token) => request(endpoint, { method: 'POST', body, token });
  const expect = (response, status) => {
    assert.equal(response.status, status, JSON.stringify(response.data));
    return response.data;
  };
  async function login(key, changes) {
    const options = expect(await post('/auth/login/options', {}), 200);
    return post('/auth/login/verify', { requestId: options.requestId, response: key.login(options.options, changes) });
  }

  function appRequest() {
    const verifier = randomBytes(32).toString('base64url');
    return { verifier, parameters: { redirect_uri: APP_REDIRECT_URI, code_challenge_method: 'S256',
      code_challenge: digest(verifier).toString('base64url'), state: randomBytes(32).toString('base64url') } };
  }
  async function authorizeApp(key) {
    const flow = appRequest();
    const options = expect(await post('/auth/login/options', { appLogin: flow.parameters }), 200);
    const response = await post('/auth/login/verify', { requestId: options.requestId,
      response: key.login(options.options), appLogin: appRequest().parameters });
    const authorization = expect(response, 200);
    assert.deepEqual(Object.keys(authorization), ['redirectUrl']);
    assert.equal(response.cacheControl, 'no-store');
    const callback = new URL(authorization.redirectUrl);
    const code = callback.searchParams.get('code');
    assert.match(code, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(authorization.redirectUrl, `${APP_REDIRECT_URI}?code=${code}&state=${flow.parameters.state}`);
    return { ...flow, code };
  }
  const exchange = (flow, changes = {}) => request('/auth/app/token', { method: 'POST', requestOrigin: null,
    body: { code: flow.code, code_verifier: flow.verifier, redirect_uri: APP_REDIRECT_URI, ...changes } });

  let admin;
  let adminKey;
  let member;
  let memberKey;
  let pendingId;
  await context.test('concurrent first registrations create exactly one approved administrator', async () => {
    const candidates = await Promise.all(['First host', 'Second host'].map(async (name) => {
      const key = authenticator();
      const options = expect(await post('/auth/register/options', { name, role: 'admin' }), 200);
      return { key, requestId: options.requestId, response: key.register(options.options) };
    }));
    const results = await Promise.all(candidates.map(({ requestId, response }) => post('/auth/register/verify', { requestId, response, role: 'admin' })));
    results.forEach((result) => expect(result, 201));
    assert.equal(results.filter((result) => result.data.level === 'admin').length, 1);
    const pendingIndex = results.findIndex((result) => result.data.pending);
    memberKey = candidates[pendingIndex].key;
    adminKey = candidates[results.findIndex((result) => result.data.token)].key;
    admin = results.find((result) => result.data.token).data;
    const rows = (await database.query('SELECT * FROM auth_users')).rows;
    assert.equal(rows.filter((user) => user.status === 'approved' && user.role === 'admin').length, 1);
    pendingId = rows.find((user) => user.status === 'pending').id;
    assert.equal(rows.find((user) => user.id === pendingId).role, 'member');
    const stored = (await database.query('SELECT token_hash FROM auth_sessions')).rows;
    assert.equal(stored[0].token_hash, hashToken(admin.token));
    assert.notEqual(stored[0].token_hash, admin.token);
    expect(await post('/auth/register/verify', candidates[0]), 400);
    assert.equal((await createAuth({ database }).resolveSession(admin.token)).userId, admin.user.id);
  });

  await context.test('pending users cannot login until approved and real signatures and user verification are required', async () => {
    expect(await login(memberKey), 403);
    expect(await request(`/auth/users/${pendingId}`, { method: 'PATCH', token: admin.token, body: { status: 'approved' } }), 200);
    member = expect(await login(memberKey), 200);
    assert.equal(member.level, 'member');
    expect(await login(memberKey, { verified: false }), 400);
    expect(await login(memberKey, { tamper: true }), 400);
    expect(await login(memberKey, { requestOrigin: 'https://attacker.test' }), 400);
    expect(await request(`/auth/users/${pendingId}`, { method: 'PATCH', token: member.token, body: { role: 'admin' } }), 403);
    expect(await request(`/auth/users/${admin.user.id}`, { method: 'PATCH', token: admin.token, body: { role: 'member' } }), 409);
    expect(await request(`/auth/users/${admin.user.id}`, { method: 'PATCH', token: admin.token, body: { status: 'revoked' } }), 409);
  });

  await context.test('HOSTSCREEN key login grants only organizer entry and cannot search, create parties or manage accounts', async () => {
    expect(await request('/auth/account-info'), 401);
    for (const account of [admin, member]) {
      const info = await request('/auth/account-info', { token: account.token });
      assert.equal(expect(info, 200).HOST_SCREEN_LOGIN_KEY, hostScreenKey);
      assert.equal(info.cacheControl, 'no-store');
    }
    expect(await post('/auth/hostscreen/login', { key: 'incorrect' }), 401);
    const response = await post('/auth/hostscreen/login', { key: hostScreenKey, role: 'admin' });
    const screen = expect(response, 200);
    assert.equal(response.cacheControl, 'no-store');
    assert.equal(screen.level, 'hostscreen');
    assert.equal(screen.user.name, 'HOSTSCREEN');
    assert.equal(screen.user.role, 'hostscreen');
    assert.equal(JSON.stringify(screen).includes(hostScreenKey), false);
    assert.equal(expect(await request('/auth/me', { token: screen.token }), 200).level, 'hostscreen');
    const anotherScreen = expect(await post('/auth/hostscreen/login', { key: hostScreenKey }), 200);
    assert.equal(anotherScreen.user.id, screen.user.id);
    assert.notEqual(anotherScreen.token, screen.token);
    for (const endpoint of ['/auth/account-info', '/auth/hostscreen/login-attempts', '/auth/passkeys', '/auth/users', '/parties/all',
      '/parties/members/search?name=Alex', '/parties/members/names', '/youtube/search?q=music',
      '/youtube/video?url=dQw4w9WgXcQ', '/ssmusic/search?q=music']) {
      expect(await request(endpoint, { token: screen.token }), 403);
    }
    expect(await post('/auth/passkeys/options', {}, screen.token), 403);
    expect(await post('/parties', { name: 'Denied', organizer_name: 'Screen' }, screen.token), 403);
    expect(await request(`/auth/users/${screen.user.id}`, { method: 'PATCH', token: admin.token, body: { role: 'admin' } }), 403);
    const created = expect(await post('/parties', { name: 'Screen test', organizer_name: 'Host' }, member.token), 201);
    const partyId = created.party.id;
    expect(await request(`/parties/${partyId}`, { token: screen.token }), 403);
    assert.ok(expect(await request('/parties', { token: screen.token }), 200).some((party) => party.id === partyId));
    expect(await post(`/parties/${partyId}/join`, { role: 'guest' }, screen.token), 403);
    const joined = expect(await post(`/parties/${partyId}/join`, {}, screen.token), 201);
    assert.equal(joined.role, 'organizer');
    expect(await request(`/parties/${partyId}`, { token: screen.token }), 200);
    expect(await request(`/queue/${partyId}`, { token: screen.token }), 200);
    for (const [method, endpoint, body] of [
      ['PATCH', `/parties/${partyId}/lock`, { is_locked: true }],
      ['PATCH', `/parties/${partyId}/lock`, { is_locked: false }],
      ['PATCH', `/parties/${partyId}`, { name: 'Changed by screen' }],
      ['PATCH', `/parties/${partyId}/reactivate`, {}],
      ['POST', `/parties/${partyId}/duplicate`, {}],
      ['DELETE', `/parties/${partyId}`, undefined],
      ['DELETE', `/parties/${partyId}/remove`, undefined],
      ['PATCH', `/parties/${partyId}/members/${joined.id}`, { name: 'Changed', role: 'organizer' }],
      ['DELETE', `/parties/${partyId}/members/${joined.id}`, undefined],
    ]) {
      expect(await request(endpoint, { method, body, token: screen.token }), 403);
    }
    const unchangedParty = expect(await request(`/parties/${partyId}`, { token: screen.token }), 200);
    assert.equal(unchangedParty.name, 'Screen test');
    assert.equal(unchangedParty.is_active, true);
    assert.equal(unchangedParty.is_locked, false);
    expect(await request(`/parties/${partyId}/lock`, { method: 'PATCH', token: member.token, body: { is_locked: true } }), 200);
    expect(await request(`/parties/${partyId}/lock`, { method: 'PATCH', token: screen.token, body: { is_locked: false } }), 403);
    assert.equal(expect(await request(`/parties/${partyId}`, { token: screen.token }), 200).is_locked, true);
    expect(await request(`/parties/${partyId}/lock`, { method: 'PATCH', token: member.token, body: { is_locked: false } }), 200);
    expect(await request(`/parties/${partyId}/members/${joined.id}`, {
      method: 'PATCH', token: admin.token, body: { name: 'Screen', role: 'guest' },
    }), 404);
    const invitation = expect(await post(`/parties/${partyId}/invitations`, {}, screen.token), 201);
    expect(await post(`/parties/${partyId}/join`, { name: 'Screen guest', invitation: invitation.token }, screen.token), 403);
    const guest = expect(await post(`/parties/${partyId}/join`, { name: 'Invited guest', invitation: invitation.token }), 201);
    expect(await request('/auth/account-info', { token: guest.token }), 403);
    expect(await request('/auth/hostscreen/login-attempts', { token: guest.token }), 403);
    expect(await request('/auth/hostscreen/login-attempts', { method: 'DELETE', token: guest.token }), 403);
    expect(await post('/auth/logout', {}, screen.token), 204);
    expect(await request('/auth/me', { token: screen.token }), 401);
    expect(await request('/auth/me', { token: guest.token }), 401);
    expect(await post('/auth/logout', {}, anotherScreen.token), 204);
    expect(await request(`/parties/${partyId}/remove`, { method: 'DELETE', token: admin.token }), 200);
  });

  await context.test('HOST login records persist without secrets and only admins can paginate them', async () => {
    const endpoint = '/auth/hostscreen/login-attempts';
    expect(await request(endpoint), 401);
    expect(await request(endpoint, { token: member.token }), 403);
    const initialResponse = await request(endpoint, { token: admin.token });
    const initial = expect(initialResponse, 200);
    assert.equal(initialResponse.cacheControl, 'no-store');
    assert.equal(initial.items.length, 3);
    assert.equal(initial.failedCount, 1);
    assert.deepEqual(initial.items.map((item) => item.outcome), ['success', 'success', 'invalid_key']);
    assert.ok(initial.items[0].ip_address.includes('127.0.0.1'));
    assert.ok(Number.isFinite(Date.parse(initial.items[0].occurred_at)));
    assert.deepEqual(Object.keys(initial.items[0]).sort(), ['id', 'ip_address', 'occurred_at', 'outcome']);
    assert.equal(JSON.stringify(initial).includes(hostScreenKey), false);
    for (let attempt = 0; attempt < 7; attempt += 1) {
      expect(await post('/auth/hostscreen/login', { key: 'audit-test-invalid-key' }), 401);
    }
    expect(await post('/auth/hostscreen/login', { key: hostScreenKey }), 429);
    const recorded = expect(await request(endpoint, { token: admin.token }), 200);
    assert.equal(recorded.items.length, 11);
    assert.equal(recorded.failedCount, 9);
    assert.equal(recorded.items[0].outcome, 'rate_limited');
    assert.equal(recorded.items.filter((item) => item.outcome === 'invalid_key').length, 8);
    assert.equal(JSON.stringify(recorded).includes('audit-test-invalid-key'), false);
    const columns = (await database.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'hostscreen_login_attempts'`,
      [schema])).rows.map((column) => column.column_name).sort();
    assert.deepEqual(columns, ['id', 'ip_address', 'occurred_at', 'outcome']);
    for (const cursor of ['0', '-1', 'bad', '9223372036854775808', '1&before=2']) {
      expect(await request(`${endpoint}?before=${cursor}`, { token: admin.token }), 400);
    }
    await database.query(
      `INSERT INTO hostscreen_login_attempts (ip_address, outcome)
      SELECT '2001:db8::1'::inet, 'success' FROM generate_series(1, 55)`);
    const first = expect(await request(endpoint, { token: admin.token }), 200);
    assert.equal(first.items.length, 50);
    assert.equal(first.nextCursor, first.items.at(-1).id);
    for (let index = 1; index < first.items.length; index += 1) {
      assert.ok(BigInt(first.items[index - 1].id) > BigInt(first.items[index].id));
    }
    await database.query("INSERT INTO hostscreen_login_attempts (ip_address, outcome) VALUES ('192.0.2.1', 'rate_limited')");
    const second = expect(await request(`${endpoint}?before=${first.nextCursor}`, { token: admin.token }), 200);
    assert.equal(second.items.length, 16);
    assert.equal(second.nextCursor, null);
    assert.equal(new Set([...first.items, ...second.items].map((item) => item.id)).size, 66);
    app.use('/api/restarted-auth', createAuthRoutes({ database }));
    const reloaded = expect(await request('/restarted-auth/hostscreen/login-attempts', { token: admin.token }), 200);
    assert.equal(reloaded.items[0].ip_address, '192.0.2.1');
    const empty = expect(await request(`${endpoint}?before=${second.items.at(-1).id}`, { token: admin.token }), 200);
    assert.deepEqual(empty, { items: [], nextCursor: null, recordCount: 67, failedCount: 10, recordLimit: 50, loginDisabled: false });
  });

  await context.test('50 failed attempts disable new HOST logins across routers until an administrator clears them', async () => {
    const settings = { HOST_SCREEN_LOGIN_KEY: hostScreenKey };
    app.use('/api/host-cap', createAuthRoutes({ database, settings, hostLimiter: (req, res, next) => next() }));
    const endpoint = '/host-cap/hostscreen/login-attempts';
    const loginEndpoint = '/host-cap/hostscreen/login';
    await database.query('DELETE FROM hostscreen_login_attempts');
    await database.query(
      `INSERT INTO hostscreen_login_attempts (ip_address, outcome)
      SELECT '192.0.2.1'::inet, 'invalid_key' FROM generate_series(1, 49)`);
    const existingScreen = expect(await post(loginEndpoint, { key: hostScreenKey }), 200);
    const before = expect(await request(endpoint, { token: admin.token }), 200);
    assert.equal(before.recordCount, 50);
    assert.equal(before.failedCount, 49);
    assert.equal(before.loginDisabled, false);
    const failures = await Promise.all(Array.from({ length: 8 }, () => post(loginEndpoint, { key: 'wrong' })));
    for (const failure of failures) {
      assert.match(expect(failure, 503).error, /administrator clears/);
    }
    const full = expect(await request(endpoint, { token: admin.token }), 200);
    assert.equal(full.recordCount, 51);
    assert.equal(full.failedCount, 50);
    assert.equal(full.recordLimit, 50);
    assert.equal(full.loginDisabled, true);
    assert.equal((await database.query('SELECT COUNT(*)::int AS count FROM hostscreen_login_attempts')).rows[0].count, 51);
    assert.match(expect(await post(loginEndpoint, { key: hostScreenKey }), 503).error, /administrator clears/);
    expect(await request('/auth/me', { token: existingScreen.token }), 200);
    app.use('/api/host-cap-restarted', createAuthRoutes({ database, settings }));
    assert.match(expect(await post('/host-cap-restarted/hostscreen/login', { key: hostScreenKey }), 503).error, /administrator clears/);
    for (const token of [undefined, member.token, existingScreen.token]) {
      expect(await request(endpoint, { method: 'DELETE', token }), token ? 403 : 401);
    }
    assert.equal(expect(await request(endpoint, { token: admin.token }), 200).recordCount, 51);
    const cleared = await request(endpoint, { method: 'DELETE', token: admin.token });
    expect(cleared, 204);
    assert.equal(cleared.cacheControl, 'no-store');
    assert.deepEqual(expect(await request(endpoint, { token: admin.token }), 200),
      { items: [], nextCursor: null, recordCount: 0, failedCount: 0, recordLimit: 50, loginDisabled: false });
    const resumed = expect(await post('/host-cap-restarted/hostscreen/login', { key: hostScreenKey }), 200);
    expect(await post('/auth/hostscreen/login', { key: hostScreenKey }), 429);
    const afterResume = expect(await request(endpoint, { token: admin.token }), 200);
    assert.equal(afterResume.recordCount, 2);
    assert.equal(afterResume.failedCount, 1);
    await database.query(
      `INSERT INTO hostscreen_login_attempts (ip_address, outcome)
      SELECT '192.0.2.1'::inet, 'invalid_key' FROM generate_series(1, 48)`);
    assert.match(expect(await post('/auth/hostscreen/login', { key: hostScreenKey }), 503).error, /administrator clears/);
    const blockedByRateLimit = expect(await request(endpoint, { token: admin.token }), 200);
    assert.equal(blockedByRateLimit.recordCount, 51);
    assert.equal(blockedByRateLimit.failedCount, 50);
    assert.equal(blockedByRateLimit.loginDisabled, true);
    expect(await request(endpoint, { method: 'DELETE', token: admin.token }), 204);
    expect(await request(endpoint, { method: 'DELETE', token: admin.token }), 204);
    expect(await post('/auth/logout', {}, existingScreen.token), 204);
    expect(await post('/auth/logout', {}, resumed.token), 204);
  });

  await context.test('successful HOST logins are atomic with their audit record and never advance or reset the failure cap', async () => {
    const settings = { HOST_SCREEN_LOGIN_KEY: hostScreenKey };
    const failingDatabase = {
      query: (...args) => database.query(...args),
      connect: async () => {
        const client = await database.connect();
        return {
          query: (sql, values) => {
            if (sql.startsWith('INSERT INTO hostscreen_login_attempts') && values[1] === 'success') {
              throw new Error('Simulated success audit failure');
            }
            return client.query(sql, values);
          },
          release: () => client.release(),
        };
      },
    };
    app.use('/api/host-audit-fail', createAuthRoutes({ database: failingDatabase, settings }));
    const sessionsBefore = Number((await database.query('SELECT COUNT(*) FROM auth_sessions')).rows[0].count);
    expect(await post('/host-audit-fail/hostscreen/login', { key: hostScreenKey }), 503);
    assert.equal(Number((await database.query('SELECT COUNT(*) FROM auth_sessions')).rows[0].count), sessionsBefore);
    assert.equal(Number((await database.query('SELECT COUNT(*) FROM hostscreen_login_attempts')).rows[0].count), 0);
    await database.query(
      `INSERT INTO hostscreen_login_attempts (ip_address, outcome)
       SELECT '192.0.2.1'::inet, 'invalid_key' FROM generate_series(1, 49)`);
    await database.query(
      `INSERT INTO hostscreen_login_attempts (ip_address, outcome)
       SELECT '192.0.2.1'::inet, 'success' FROM generate_series(1, 1000)`);
    const results = await Promise.all(Array.from({ length: 3 }, () => post('/host-cap/hostscreen/login', { key: hostScreenKey })));
    const sessions = results.map((result) => expect(result, 200));
    for (const session of sessions) {
      expect(await request('/auth/me', { token: session.token }), 200);
    }
    const records = expect(await request('/auth/hostscreen/login-attempts', { token: admin.token }), 200);
    assert.equal(records.recordCount, 1052);
    assert.equal(records.failedCount, 49);
    assert.equal(records.loginDisabled, false);
    assert.equal(records.items[0].outcome, 'success');
    for (const session of sessions) {
      assert.equal(JSON.stringify(records).includes(session.token), false);
    }
    assert.equal(JSON.stringify(records).includes(hostScreenKey), false);
    expect(await post('/host-cap/hostscreen/login', { key: 'wrong' }), 503);
    expect(await post('/host-cap/hostscreen/login', { key: hostScreenKey }), 503);
    const blocked = expect(await request('/auth/hostscreen/login-attempts', { token: admin.token }), 200);
    assert.equal(blocked.recordCount, 1053);
    assert.equal(blocked.failedCount, 50);
    assert.equal(blocked.loginDisabled, true);
    assert.equal(Number((await database.query('SELECT COUNT(*) FROM auth_sessions')).rows[0].count), sessionsBefore + 3);
    expect(await request('/auth/hostscreen/login-attempts', { method: 'DELETE', token: admin.token }), 204);
    for (const session of sessions) {
      expect(await post('/auth/logout', {}, session.token), 204);
    }
  });

  await context.test('additional passkeys are bound to the signed-in account and its single-use session challenge', async () => {
    const key = authenticator();
    const first = expect(await post('/auth/passkeys/options', {}, admin.token), 200);
    const response = key.register(first.options);
    expect(await post('/auth/passkeys/verify', { requestId: first.requestId, response }, member.token), 400);
    expect(await post('/auth/passkeys/verify', { requestId: first.requestId, response }, admin.token), 400);
    const second = expect(await post('/auth/passkeys/options', {}, admin.token), 200);
    expect(await post('/auth/passkeys/verify', { requestId: second.requestId, response: key.register(second.options) }, admin.token), 201);
    assert.equal(expect(await login(key), 200).user.id, admin.user.id);
    const passkeys = expect(await request('/auth/passkeys', { token: admin.token }), 200);
    assert.equal(passkeys.length, 2);
    expect(await request(`/auth/passkeys/${key.id}`, { method: 'DELETE', token: member.token }), 404);
    expect(await request(`/auth/passkeys/${key.id}`, { method: 'DELETE', token: admin.token }), 204);
    expect(await request(`/auth/passkeys/${passkeys.find((entry) => entry.id !== key.id).id}`, { method: 'DELETE', token: admin.token }), 409);
  });

  await context.test('app codes require fresh WebAuthn and cannot bypass signature, origin or user verification', async () => {
    const flow = appRequest();
    for (const parameters of [{ ...flow.parameters, redirect_uri: 'https://attacker.test' },
      { ...flow.parameters, code_challenge_method: 'plain' }, { ...flow.parameters, state: [] }]) {
      expect(await post('/auth/login/options', { appLogin: parameters }, admin.token), 400);
    }
    for (const changes of [{ verified: false }, { tamper: true }, { requestOrigin: 'https://attacker.test' }]) {
      const options = expect(await post('/auth/login/options', { appLogin: flow.parameters }, admin.token), 200);
      const body = { requestId: options.requestId, response: memberKey.login(options.options, changes) };
      expect(await post('/auth/login/verify', body, admin.token), 400);
      expect(await post('/auth/login/verify', body, admin.token), 400);
    }
    assert.equal((await database.query('SELECT * FROM auth_app_codes')).rows.length, 0);
  });

  await context.test('native app exchange needs no Origin or cookies and concurrent redemption issues only one session', async () => {
    for (const [key, account] of [[memberKey, member], [adminKey, admin]]) {
      const before = Number((await database.query('SELECT COUNT(*) FROM auth_sessions')).rows[0].count);
      const flow = await authorizeApp(key);
      assert.equal(Number((await database.query('SELECT COUNT(*) FROM auth_sessions')).rows[0].count), before);
      const stored = (await database.query('SELECT * FROM auth_app_codes WHERE code_hash = $1', [hashToken(flow.code)])).rows[0];
      assert.equal(stored.user_id, account.user.id);
      assert.equal(stored.code_challenge, flow.parameters.code_challenge);
      assert.equal(stored.redirect_uri, APP_REDIRECT_URI);
      assert.ok(stored.expires_at.getTime() > Date.now());
      assert.ok(stored.expires_at.getTime() <= Date.now() + 2 * 60 * 1000);
      assert.equal(JSON.stringify(stored).includes(flow.code), false);
      const responses = await Promise.all([exchange(flow), exchange(flow)]);
      assert.deepEqual(responses.map((response) => response.status).sort(), [200, 400]);
      const response = responses.find((result) => result.status === 200);
      assert.equal(response.cacheControl, 'no-store');
      const session = response.data;
      assert.equal(session.level, account.level);
      assert.equal(session.user.name, account.user.name);
      assert.equal(session.user.id, account.user.id);
      assert.notEqual(session.token, account.token);
      assert.ok(Date.parse(session.expiresAt) > Date.now());
      assert.match(session.expiresAt, /Z$/);
      assert.equal(Number((await database.query('SELECT COUNT(*) FROM auth_sessions')).rows[0].count), before + 1);
      expect(await exchange(flow), 400);
      expect(await request('/auth/me', { token: session.token, requestOrigin: null }), 200);
      expect(await request('/auth/logout', { method: 'POST', token: session.token, requestOrigin: null, body: {} }), 204);
      expect(await request('/auth/me', { token: session.token, requestOrigin: null }), 401);
      expect(await request('/auth/me', { token: account.token }), 200);
    }
  });

  await context.test('app codes reject wrong verifiers, callbacks and expiry without issuing sessions', async () => {
    const flow = await authorizeApp(memberKey);
    expect(await exchange(flow, { code_verifier: randomBytes(32).toString('base64url') }), 400);
    expect(await exchange(flow, { redirect_uri: `${APP_REDIRECT_URI}/` }), 400);
    expect(await exchange(flow, { code: ['invalid'] }), 400);
    expect(await exchange(flow), 200);
    const expired = await authorizeApp(memberKey);
    await database.query("UPDATE auth_app_codes SET expires_at = NOW() - INTERVAL '1 second' WHERE code_hash = $1", [hashToken(expired.code)]);
    expect(await exchange(expired), 400);
  });

  await context.test('app registration waits for approval and successful sign-in must follow approval', async () => {
    const key = authenticator();
    const flow = appRequest();
    const options = expect(await post('/auth/register/options', { name: 'App applicant', appLogin: flow.parameters }), 200);
    const registration = expect(await post('/auth/register/verify', { requestId: options.requestId,
      response: key.register(options.options) }), 201);
    assert.equal(registration.pending, true);
    assert.equal(registration.token, undefined);
    assert.equal(registration.redirectUrl, undefined);
    const pending = expect(await post('/auth/login/options', { appLogin: flow.parameters }), 200);
    expect(await post('/auth/login/verify', { requestId: pending.requestId, response: key.login(pending.options) }), 403);
    const userId = (await database.query("SELECT id FROM auth_users WHERE name = 'App applicant'")).rows[0].id;
    expect(await request(`/auth/users/${userId}`, { method: 'PATCH', token: admin.token, body: { status: 'approved' } }), 200);
    assert.equal(expect(await exchange(await authorizeApp(key)), 200).user.id, userId);
  });

  await context.test('exchange rechecks account approval and access changes cannot resurrect outstanding codes', async () => {
    const flow = await authorizeApp(memberKey);
    for (const status of ['pending', 'revoked']) {
      await database.query('UPDATE auth_users SET status = $1 WHERE id = $2', [status, member.user.id]);
      expect(await exchange(flow), 400);
    }
    expect(await request(`/auth/users/${member.user.id}`, { method: 'PATCH', token: admin.token, body: { status: 'approved' } }), 200);
    expect(await exchange(flow), 400);
    const next = await authorizeApp(memberKey);
    expect(await request(`/auth/users/${member.user.id}`, { method: 'PATCH', token: admin.token, body: { status: 'revoked' } }), 200);
    expect(await exchange(next), 400);
    expect(await request(`/auth/users/${member.user.id}`, { method: 'PATCH', token: admin.token, body: { status: 'approved' } }), 200);
    expect(await exchange(next), 400);
    member = expect(await login(memberKey), 200);
  });

  const firstParty = expect(await post('/parties', { name: 'Party one', organizer_name: 'Host one' }, admin.token), 201);
  const secondParty = expect(await post('/parties', { name: 'Party two', organizer_name: 'Host two' }, member.token), 201);
  const partyId = firstParty.party.id;
  let invitation;
  let guest;
  let sharedInvitation;
  let sharedGuest;
  await context.test('QR generation requires a joined host and every generation has a unique secret', async () => {
    expect(await post(`/parties/${partyId}/invitations`, {}, member.token), 403);
    invitation = expect(await post(`/parties/${partyId}/invitations`, {}, admin.token), 201);
    assert.match(invitation.token, /^[A-Za-z0-9_-]{43}$/);
    const stored = (await database.query('SELECT * FROM party_invitations WHERE id = $1', [invitation.id])).rows[0];
    assert.equal(stored.token_hash, hashToken(invitation.token));
    assert.equal(stored.host_member_id, firstParty.member.id);
    assert.equal(stored.host_session_id, (await auth.resolveSession(admin.token)).sessionId);
    assert.equal(expect(await post('/parties/invitations/resolve', { invitation: invitation.token }), 200).party.id, partyId);
    expect(await post(`/parties/${partyId}/join`, { name: 'Intruder', role: 'organizer' }), 401);
    expect(await post(`/parties/${partyId}/join`, { name: 'Intruder', invitation: firstParty.party.join_code }), 403);
    expect(await post(`/parties/${secondParty.party.id}/join`, { name: 'Guest', invitation: invitation.token }), 403);
    expect(await post(`/parties/${partyId}/join`, { name: 'Guest', role: 'organizer', invitation: invitation.token }), 403);
    expect(await post(`/parties/${partyId}/join`, { name: 'Guest', member_id: firstParty.member.id, invitation: invitation.token }), 403);
    guest = expect(await post(`/parties/${partyId}/join`, { name: 'Host one', invitation: invitation.token }), 201);
    assert.equal(guest.level, 'guest');
    assert.equal(guest.member.role, 'guest');
    assert.notEqual(guest.member.id, firstParty.member.id);
    const another = expect(await post(`/parties/${partyId}/join`, { name: 'Host one', invitation: invitation.token }), 201);
    assert.notEqual(another.member.id, guest.member.id);
  });

  await context.test('existing guests and account members share active invitations without rotating or escalating access', async () => {
    expect(await request(`/parties/${partyId}/invitations/current`), 401);
    expect(await request(`/parties/${secondParty.party.id}/invitations/current`, { token: guest.token }), 403);
    expect(await request(`/parties/${partyId}/invitations/current`, { token: member.token }), 403);
    sharedInvitation = expect(await request(`/parties/${partyId}/invitations/current`, { token: guest.token }), 200);
    assert.match(sharedInvitation.token, /^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
    assert.equal(sharedInvitation.expiresAt, invitation.expiresAt);
    assert.equal(expect(await post('/parties/invitations/resolve', { invitation: sharedInvitation.token }), 200).party.id, partyId);
    const tampered = `${invitation.id}.${'a'.repeat(43)}`;
    expect(await post('/parties/invitations/resolve', { invitation: tampered }), 403);
    expect(await post(`/parties/${secondParty.party.id}/join`, { name: 'Guest', invitation: sharedInvitation.token }), 403);
    expect(await post(`/parties/${partyId}/join`, { name: 'Guest', role: 'organizer', invitation: sharedInvitation.token }), 403);
    sharedGuest = expect(await post(`/parties/${partyId}/join`, { name: 'Shared guest', invitation: sharedInvitation.token }), 201);
    assert.equal(sharedGuest.level, 'guest');
    assert.equal((await auth.resolveSession(sharedGuest.token)).invitationId, invitation.id);
    assert.equal((await database.query('SELECT COUNT(*) FROM party_invitations WHERE party_id = $1', [partyId])).rows[0].count, '1');
    expect(await request('/auth/me', { token: guest.token }), 200);
    expect(await post(`/parties/${partyId}/join`, { name: 'Account guest', role: 'guest' }, member.token), 201);
    const shared = expect(await request(`/parties/${partyId}/invitations/current`, { token: member.token }), 200);
    assert.equal(shared.token, sharedInvitation.token);
  });

  await context.test('guest HTTP access is restricted to its own party and server-owned member identity', async () => {
    assert.equal(expect(await request('/auth/me', { token: guest.token }), 200).partyId, partyId);
    for (const endpoint of ['/parties', '/parties/all', '/parties/members/names', '/parties/members/search?name=Ho',
      '/auth/users', '/auth/passkeys', `/parties/${secondParty.party.id}`, `/parties/${secondParty.party.id}/members`,
      `/queue/${secondParty.party.id}`, `/parties/${partyId}/members/${firstParty.member.id}`]) {
      expect(await request(endpoint, { token: guest.token }), 403);
    }
    expect(await request(`/parties/${partyId}`, { token: guest.token }), 200);
    expect(await request(`/parties/${partyId}/members/${guest.member.id}`, { token: guest.token }), 200);
    expect(await request(`/queue/${partyId}`, { token: guest.token }), 200);
    expect(await post(`/parties/${secondParty.party.id}/join`, { name: 'Host one', role: 'organizer' }, guest.token), 403);
    expect(await post(`/parties/${partyId}/invitations`, {}, guest.token), 403);
    expect(await request(`/parties/${partyId}/lock`, { method: 'PATCH', token: guest.token,
      body: { is_locked: true, member_id: firstParty.member.id } }), 403);
    expect(await request(`/parties/${partyId}`, { method: 'DELETE', token: guest.token }), 403);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const suffix = method === 'PUT' ? '/reorder' : method === 'PATCH' ? '/reset' : method === 'DELETE' ? `/${randomUUID()}` : '';
      expect(await request(`/queue/${secondParty.party.id}${suffix}`, { method, token: guest.token, body: {} }), 403);
    }
    const song = { video_id: 'abcdefghijk', video_title: 'Song', singer_name: 'Forged name' };
    expect(await post(`/queue/${partyId}`, { ...song, member_id: firstParty.member.id }, guest.token), 403);
    expect(await post(`/queue/${partyId}`, { ...song, member_id: secondParty.member.id }, admin.token), 403);
    const queued = expect(await post(`/queue/${partyId}`, song, guest.token), 201);
    assert.equal(queued.member_id, guest.member.id);
    assert.equal(queued.singer_name, guest.member.name);
  });

  await context.test('rotation, expiration and host logout revoke both the QR link and derived guest sessions', async () => {
    const next = expect(await post(`/parties/${partyId}/invitations`, {}, admin.token), 201);
    assert.notEqual(next.id, invitation.id);
    assert.notEqual(next.token, invitation.token);
    expect(await post('/parties/invitations/resolve', { invitation: sharedInvitation.token }), 403);
    expect(await request('/auth/me', { token: sharedGuest.token }), 401);
    expect(await request(`/queue/${partyId}`, { token: guest.token }), 401);
    expect(await post(`/parties/${partyId}/join`, { name: 'Guest', invitation: invitation.token }), 403);
    invitation = next;
    guest = expect(await post(`/parties/${partyId}/join`, { name: 'Guest', invitation: invitation.token }), 201);
    await database.query("UPDATE party_invitations SET expires_at = NOW() - INTERVAL '1 second' WHERE id = $1", [invitation.id]);
    expect(await request(`/queue/${partyId}`, { token: guest.token }), 401);
    expect(await post('/parties/invitations/resolve', { invitation: invitation.token }), 403);
    const hostInvite = expect(await post(`/parties/${secondParty.party.id}/invitations`, {}, member.token), 201);
    const hostGuest = expect(await post(`/parties/${secondParty.party.id}/join`, { name: 'Guest', invitation: hostInvite.token }), 201);
    expect(await post('/auth/logout', {}, member.token), 204);
    expect(await request('/auth/me', { token: hostGuest.token }), 401);
    expect(await post('/parties/invitations/resolve', { invitation: hostInvite.token }), 403);
    member = expect(await login(memberKey), 200);
    expect(await post('/parties/invitations/resolve', { invitation: hostInvite.token }), 403);
  });

  await context.test('ending and reactivating a party never resurrects invitations or guest access', async () => {
    const next = expect(await post(`/parties/${partyId}/invitations`, {}, admin.token), 201);
    const joined = expect(await post(`/parties/${partyId}/join`, { name: 'Guest', invitation: next.token }), 201);
    expect(await request(`/parties/${partyId}`, { method: 'DELETE', token: admin.token }), 200);
    expect(await request(`/parties/${partyId}/reactivate`, { method: 'PATCH', token: admin.token, body: {} }), 200);
    expect(await post('/parties/invitations/resolve', { invitation: next.token }), 403);
    expect(await request('/auth/me', { token: joined.token }), 401);
  });

  await context.test('account revocation invalidates host and guest sessions and later passkey login', async () => {
    const next = expect(await post(`/parties/${secondParty.party.id}/invitations`, {}, member.token), 201);
    const joined = expect(await post(`/parties/${secondParty.party.id}/join`, { name: 'Guest', invitation: next.token }), 201);
    expect(await request(`/auth/users/${member.user.id}`, { method: 'PATCH', token: admin.token, body: { status: 'revoked' } }), 200);
    expect(await request('/auth/me', { token: member.token }), 401);
    expect(await request('/auth/me', { token: joined.token }), 401);
    expect(await post('/parties/invitations/resolve', { invitation: next.token }), 403);
    expect(await login(memberKey), 403);
  });
});