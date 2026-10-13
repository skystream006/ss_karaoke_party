const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const { createChallenges, passkeyConfig } = require('../lib/passkeys');
const { createAuth, hashToken } = require('../middleware/auth');
const { APP_REDIRECT_URI, APP_CODE_TTL_MS, appLoginRequest, appTokenRequest,
  issueAppLoginCode, consumeAppLoginCode } = require('../lib/appLogin');

test('HOSTSCREEN can access organizer entry points but not passkey accounts or searches', () => {
  const { requireAccount, requireOrganizerAccount, forbidHostscreen, requireAdmin } = require('../middleware/auth');
  for (const level of ['hostscreen', 'admin', 'member', 'guest']) {
    const req = { auth: { userId: level === 'guest' ? null : 'account', level }, authLevel: level };
    for (const [guard, allowed] of [
      [requireAccount, ['admin', 'member'].includes(level)],
      [requireOrganizerAccount, level !== 'guest'],
      [forbidHostscreen, level !== 'hostscreen'],
      [requireAdmin, level === 'admin'],
    ]) {
      let result;
      const res = { status: (status) => { result = status; return res; }, json: () => {} };
      guard(req, res, () => { result = 200; });
      assert.equal(result, allowed ? 200 : 403, `${guard.name}: ${level}`);
    }
  }
});

test('HOST login fails closed without a configured key and rejects malformed or incorrect keys', async (context) => {
  const { createAuthRoutes } = require('../routes/auth');
  const database = { connect: async () => { throw new Error('Invalid keys must not open a transaction'); } };
  const app = express();
  app.use(express.json());
  for (const [prefix, settings] of [['disabled', {}], ['enabled', { HOST_SCREEN_LOGIN_KEY: 'configured-test-key' }]]) {
    app.use(`/${prefix}`, createAuthRoutes({ database, settings, limiter: (req, res, next) => next() }));
  }
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  context.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  for (const [prefix, key, status] of [['disabled', 'anything', 503], ['enabled', 'wrong', 401],
    ['enabled', null, 401], ['enabled', ['configured-test-key'], 401], ['enabled', '', 401]]) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/${prefix}/hostscreen/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }),
    });
    assert.equal(response.status, status);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).token, undefined);
  }
});

test('app sign-in accepts only the fixed callback, S256 secrets and an HTTPS passkey origin', () => {
  const config = { origin: 'https://party.example.test' };
  const request = { redirect_uri: APP_REDIRECT_URI, code_challenge_method: 'S256',
    code_challenge: 'c'.repeat(43), state: 's'.repeat(43) };
  assert.deepEqual(appLoginRequest(request, config), request);
  assert.notEqual(appLoginRequest(request, config), request);
  assert.equal(appLoginRequest(undefined, config), undefined);
  for (const invalid of [null, [], 'invalid', {},
    { ...request, redirect_uri: 'https://attacker.test/callback' },
    { ...request, redirect_uri: 'com.sskaraoke.player://oauth/callback' },
    { ...request, redirect_uri: `${APP_REDIRECT_URI}?extra=value` },
    { ...request, redirect_uri: `${APP_REDIRECT_URI}#fragment` },
    { ...request, code_challenge_method: 'plain' },
    { ...request, code_challenge: ['c'.repeat(43)] },
    { ...request, code_challenge: 'c'.repeat(42) },
    { ...request, code_challenge: `${'c'.repeat(42)}=` },
    { ...request, state: '' },
    { ...request, state: 's'.repeat(44) },
    { ...request, state: { value: request.state } },
    { ...request, token: 'unexpected' },
  ]) assert.throws(() => appLoginRequest(invalid, config), { status: 400 });
  assert.throws(() => appLoginRequest(request, { origin: 'http://localhost:3000' }), { status: 403 });
});

test('app token requests use S256 and cannot alter the callback or use malformed credentials', () => {
  const request = { code: 'c'.repeat(43), redirect_uri: APP_REDIRECT_URI,
    code_verifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk' };
  assert.deepEqual(appTokenRequest(request), { codeHash: hashToken(request.code), redirectUri: APP_REDIRECT_URI,
    codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM' });
  for (const invalid of [undefined, null, [], {}, { ...request, code: 'bad' },
    { ...request, code: ['c'.repeat(43)] }, { ...request, code_verifier: 'short' },
    { ...request, code_verifier: `${'c'.repeat(42)}=` }, { ...request, state: 'unexpected' },
    { ...request, redirect_uri: `${APP_REDIRECT_URI}/` },
  ]) assert.throws(() => appTokenRequest(invalid), { status: 400 });
});

test('app authorization persists only a bound code hash and returns exactly code and state', async () => {
  const statements = [];
  const client = { query: async (...args) => { statements.push(args); return { rows: [] }; } };
  const request = { redirect_uri: APP_REDIRECT_URI, code_challenge: 'c'.repeat(43), state: 's'.repeat(43) };
  const startedAt = Date.now();
  const result = await issueAppLoginCode(client, 'verified-account', request);
  assert.deepEqual(Object.keys(result), ['redirectUrl']);
  const callback = new URL(result.redirectUrl);
  const code = callback.searchParams.get('code');
  assert.match(code, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(result.redirectUrl, `${APP_REDIRECT_URI}?code=${code}&state=${request.state}`);
  assert.equal(statements[1][1][0], hashToken(code));
  assert.deepEqual(statements[1][1].slice(1, 4), ['verified-account', request.code_challenge, APP_REDIRECT_URI]);
  assert.ok(statements[1][1][4].getTime() >= startedAt + APP_CODE_TTL_MS);
  assert.ok(statements[1][1][4].getTime() <= Date.now() + APP_CODE_TTL_MS);
  assert.equal(JSON.stringify(statements).includes(code), false);
});

test('app code exchange locks an approved account before an atomic bound deletion', async () => {
  const request = appTokenRequest({ code: 'c'.repeat(43), code_verifier: 'v'.repeat(43), redirect_uri: APP_REDIRECT_URI });
  for (const responses of [[[]], [[{ id: 'account' }], []], [[{ id: 'account' }], [{ user_id: 'account' }]]]) {
    const statements = [];
    const client = { query: async (...args) => { statements.push(args); return { rows: responses[statements.length - 1] }; } };
    if (responses.at(-1).length) assert.equal(await consumeAppLoginCode(client, request), 'account');
    else await assert.rejects(consumeAppLoginCode(client, request), { status: 400 });
    assert.match(statements[0][0], /account.status = 'approved' FOR UPDATE OF account/);
    assert.deepEqual(statements[0][1], [request.codeHash, request.codeChallenge, APP_REDIRECT_URI]);
    if (statements.length > 1) {
      assert.match(statements[1][0], /DELETE FROM auth_app_codes/);
      assert.match(statements[1][0], /expires_at > clock_timestamp\(\)/);
      assert.deepEqual(statements[1][1], [request.codeHash, request.codeChallenge, APP_REDIRECT_URI, 'account']);
    }
  }
});

test('passkey configurations accept only configured origins and hostname RP IDs', () => {
  const settings = { PASSKEY_ORIGIN: 'https://party.example.test', PASSKEY_RP_ID: 'party.example.test',
    PASSKEY_ORIGIN_SECONDARY: 'http://localhost:3002', PASSKEY_RP_ID_SECONDARY: 'localhost' };
  assert.equal(passkeyConfig('http://localhost:3002', settings).rpID, 'localhost');
  for (const origin of ['https://attacker.test', 'null', undefined, 'https://party.example.test.attacker.test']) {
    assert.throws(() => passkeyConfig(origin, settings), { status: 403 });
  }
  for (const configuration of [
    { PASSKEY_ORIGIN: 'http://party.example.test' },
    { PASSKEY_ORIGIN: 'https://127.0.0.1', PASSKEY_RP_ID: '127.0.0.1' },
    { PASSKEY_ORIGIN: 'https://party.example.test', PASSKEY_RP_ID: 'other.test' },
    { PASSKEY_ORIGIN_SECONDARY: 'https://other.test' },
  ]) assert.throws(() => passkeyConfig('https://party.example.test', configuration), { status: 503 });
});

test('passkey challenges are bounded, expiring, single-use and bound to ceremony, origin and session', () => {
  let now = 1000;
  const store = createChallenges({ now: () => now, capacity: 1, ttl: 100 });
  const value = { kind: 'enroll', origin: 'https://party.test', sessionId: 'session', challenge: 'challenge' };
  const first = store.issue(value);
  assert.throws(() => store.issue(value), { status: 429 });
  assert.equal(store.consume(first, 'enroll', value.origin, 'session').challenge, 'challenge');
  assert.throws(() => store.consume(first, 'enroll', value.origin, 'session'), { status: 400 });
  for (const [kind, origin, sessionId] of [
    ['login', value.origin, 'session'], ['enroll', 'https://other.test', 'session'], ['enroll', value.origin, 'other'],
  ]) {
    const requestId = store.issue(value);
    assert.throws(() => store.consume(requestId, kind, origin, sessionId), { status: 400 });
    assert.throws(() => store.consume(requestId, 'enroll', value.origin, 'session'), { status: 400 });
  }
  const expired = store.issue(value);
  now += 100;
  assert.throws(() => store.consume(expired, 'enroll', value.origin, 'session'), { status: 400 });
  assert.ok(store.issue(value));
});

test('sessions persist only token hashes and cannot be issued from a bare role', async () => {
  const statements = [];
  const auth = createAuth({ database: { query: async (...args) => { statements.push(args); return { rows: [] }; } } });
  await assert.rejects(auth.createSession('admin'));
  const token = await auth.createSession({ userId: 'verified-account' });
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(statements[0][1][0], hashToken(token));
  assert.equal(JSON.stringify(statements).includes(token), false);
  assert.equal(await auth.resolveSession('old-uuid-session'), null);
  assert.equal(await auth.getPartyAccess({ level: 'guest', partyId: 'own-party' }, 'other-party'), null);
  assert.equal(statements.length, 1);
});

test('legacy password and anonymous QR login cannot issue sessions', async (context) => {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', require('../routes/auth'));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/auth`;

  for (const [path, options] of [
    ['', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'anything' }) }],
    ['/qr-session', {}],
  ]) {
    const response = await fetch(`${baseUrl}${path}`, options);
    assert.equal(response.status, 410);
    const result = await response.json();
    assert.equal(result.token, undefined);
    assert.equal(result.level, undefined);
  }
});

test('native token exchange is rate-limited and non-cacheable without Origin or browser authentication', async (context) => {
  const { createAuthRoutes } = require('../routes/auth');
  const limiter = require('express-rate-limit')({ windowMs: 60000, limit: 1, standardHeaders: true, legacyHeaders: false });
  const database = { connect: async () => { throw new Error('Malformed requests must not open a transaction'); } };
  const app = express();
  app.use(express.json());
  app.use('/auth', createAuthRoutes({ database, limiter }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  context.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  for (const status of [400, 429]) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/auth/app/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(response.status, status);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    if (status === 429) assert.ok(response.headers.get('retry-after'));
  }
});

test('real WebAuthn options require user verification and invalid registration cannot create accounts', async (context) => {
  const { createAuthRoutes } = require('../routes/auth');
  const statements = [];
  const database = { query: async (sql) => { statements.push(sql); return { rows: [] }; },
    connect: async () => { throw new Error('Invalid verification must not open a transaction'); } };
  const app = express();
  app.use(express.json());
  app.use('/auth', createAuthRoutes({ database, settings: { PASSKEY_ORIGIN: 'http://localhost:3000' },
    limiter: (req, res, next) => next() }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  context.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const post = (path, body, origin = 'http://localhost:3000') => fetch(`http://127.0.0.1:${server.address().port}/auth${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body),
  });
  assert.equal((await post('/register/options', { name: 'Host' }, 'https://attacker.test')).status, 403);
  assert.equal(statements.length, 0);
  const registration = await post('/register/options', { name: 'Host', role: 'admin' });
  assert.equal(registration.status, 200);
  const { options, requestId } = await registration.json();
  assert.equal(options.rp.id, 'localhost');
  assert.equal(options.authenticatorSelection.residentKey, 'required');
  assert.equal(options.authenticatorSelection.userVerification, 'required');
  assert.equal((await post('/register/verify', { requestId, response: { id: 'forged' } })).status, 400);
  assert.equal((await post('/register/verify', { requestId, response: { id: 'forged' } })).status, 400);
  const login = await (await post('/login/options', {})).json();
  assert.equal(login.options.userVerification, 'required');
  assert.equal(login.options.allowCredentials?.length || 0, 0);
  assert.equal(statements.length, 1);
});