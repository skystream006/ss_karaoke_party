const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createPartyInvitations } = require('../lib/partyInvitations');
const { createAuth, requireAccount } = require('../middleware/auth');

test('invitation joins reject weak secrets and role or identity escalation before database access', async () => {
  const invitations = createPartyInvitations({ database: {
    query: () => { throw new Error('Unexpected database access'); },
    connect: () => { throw new Error('Unexpected database access'); },
  } });
  for (const invitation of [undefined, '', 'ABC123', randomUUID(), ['a'.repeat(43)]]) {
    await assert.rejects(invitations.join(randomUUID(), { name: 'Guest', invitation }), { status: 403 });
  }
  for (const extra of [{ role: 'organizer' }, { role: 'admin' }, { user_id: randomUUID() }, { member_id: randomUUID() }]) {
    await assert.rejects(invitations.join(randomUUID(), { name: 'Guest', invitation: 'a'.repeat(43), ...extra }), { status: 403 });
  }
  await assert.rejects(invitations.issue({ level: 'guest' }, randomUUID()), { status: 403 });
});

test('party access is bound to verified membership, not a supplied member ID or role', async () => {
  const partyId = randomUUID();
  let calls = 0;
  let membership = { id: partyId, is_active: true, member_id: randomUUID(), role: 'guest' };
  const auth = createAuth({ database: { query: async () => { calls += 1; return { rows: [membership] }; } } });
  const guest = { level: 'guest', partyId, memberId: membership.member_id };
  assert.equal(await auth.getPartyAccess(guest, randomUUID()), null);
  assert.equal(calls, 0);
  assert.equal((await auth.getPartyAccess(guest, partyId)).isHost, false);
  membership.role = 'organizer';
  assert.equal((await auth.getPartyAccess(guest, partyId)).isHost, false);
  membership = { id: partyId, is_active: true, member_id: null };
  assert.equal(await auth.getPartyAccess({ level: 'member', userId: randomUUID() }, partyId), null);
  let status;
  requireAccount({ auth: guest }, { status(value) { status = value; return this; }, json() {} },
    () => assert.fail('Guest must not pass the account guard'));
  assert.equal(status, 403);
});

test('sockets reject cross-party rooms, guest host broadcasts and revoked sessions', async (context) => {
  const { registerPartySockets } = require('../lib/partySockets');
  const partyId = randomUUID();
  let current = { sessionId: randomUUID(), partyId, level: 'guest', memberId: randomUUID(),
    hostSessionId: randomUUID(), hostUserId: randomUUID(), invitationId: randomUUID(),
    expiresAt: new Date(Date.now() + 60000) };
  let middleware;
  let connected;
  const handlers = {};
  const events = [];
  let disconnected = false;
  const socket = {
    handshake: { auth: { token: 'fixture' } }, data: {}, rooms: new Set(),
    join(room) { this.rooms.add(room); }, leave(room) { this.rooms.delete(room); },
    on(event, handler) { handlers[event] = handler; },
    disconnect() { disconnected = true; handlers.disconnect?.(); },
    to(room) { return { emit: (event, data) => events.push({ room, event, data }) }; },
  };
  registerPartySockets({ use(handler) { middleware = handler; }, on(event, handler) { connected = handler; } },
    { auth: { resolveSession: async () => current,
      getPartyAccess: async (session, id) => id === session.partyId ? { isHost: false, member_id: session.memberId } : null } });
  await new Promise((resolve, reject) => middleware(socket, (error) => error ? reject(error) : resolve()));
  connected(socket);
  context.after(() => handlers.disconnect());
  let acknowledgement;
  const otherParty = randomUUID();
  await handlers['join:party'](otherParty, (value) => { acknowledgement = value; });
  assert.ok(acknowledgement.error);
  assert.equal(socket.rooms.has(otherParty), false);
  await handlers['join:party'](partyId, (value) => { acknowledgement = value; });
  assert.equal(acknowledgement.ok, true);
  assert.equal(socket.rooms.has(`session:${current.hostSessionId}`), true);
  await handlers['video:progress']({ partyId, currentTime: 5, duration: 60 });
  await handlers['video:seek']({ partyId: otherParty, seekTime: 5 });
  assert.equal(events.length, 0);
  await handlers['video:seek']({ partyId, seekTime: 5 });
  assert.equal(events.length, 1);
  current = null;
  await handlers['video:seek']({ partyId, seekTime: 10 });
  assert.equal(disconnected, true);
  assert.equal(events.length, 1);
  await new Promise((resolve) => middleware({ handshake: { auth: {} }, data: {} }, (error) => {
    assert.equal(error.message, 'Unauthorized'); resolve();
  }));
});