const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const { createChallenges, passkeyConfig } = require('../lib/passkeys');
const { createAuth, hashToken } = require('../middleware/auth');

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