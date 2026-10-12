const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes, generateKeyPairSync, createHash, sign } = require('node:crypto');
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const express = require('express');
const { isoCBOR } = require('@simplewebauthn/server/helpers');

const origin = 'http://localhost:3000';
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
  const auth = createAuth({ database });
  const { createAuthRoutes } = require('../routes/auth');
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use('/api/auth', createAuthRoutes({ database, settings: { PASSKEY_ORIGIN: origin }, limiter: (req, res, next) => next() }));
  app.use('/api/parties', require('../routes/parties'));
  app.use('/api/queue', auth.requireAuth, require('../routes/queue'));
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  delete process.env.YOUTUBE_API_KEY;

  async function request(endpoint, { method = 'GET', body, token, requestOrigin = origin } = {}) {
    const headers = { 'Content-Type': 'application/json', Origin: requestOrigin };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${baseUrl}${endpoint}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    return { status: response.status, data: text ? JSON.parse(text) : null };
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

  let admin;
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

  const firstParty = expect(await post('/parties', { name: 'Party one', organizer_name: 'Host one' }, admin.token), 201);
  const secondParty = expect(await post('/parties', { name: 'Party two', organizer_name: 'Host two' }, member.token), 201);
  const partyId = firstParty.party.id;
  let invitation;
  let guest;
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