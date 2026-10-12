const defaultAuth = require('../middleware/auth');

function registerPartySockets(io, { auth = defaultAuth } = {}) {
  io.use(async (socket, next) => {
    try {
      const session = await auth.resolveSession(socket.handshake.auth?.token);
      if (!session) return next(new Error('Unauthorized'));
      socket.data.session = session;
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const session = socket.data.session;
    socket.join(`session:${session.sessionId}`);
    if (session.userId) socket.join(`user:${session.userId}`);
    if (session.memberId) socket.join(`member:${session.memberId}`);
    if (session.hostSessionId) socket.join(`session:${session.hostSessionId}`);
    if (session.hostUserId) socket.join(`user:${session.hostUserId}`);
    if (session.hostMemberId) socket.join(`member:${session.hostMemberId}`);
    if (session.invitationId) socket.join(`invitation:${session.invitationId}`);
    const expiry = setTimeout(() => socket.disconnect(true), Math.max(0, new Date(session.expiresAt).getTime() - Date.now()));
    expiry.unref?.();
    socket.on('disconnect', () => clearTimeout(expiry));
    let windowStart = Date.now();
    let eventCount = 0;

    async function access(partyId, joining = false) {
      if (Date.now() - windowStart > 10000) { windowStart = Date.now(); eventCount = 0; }
      eventCount += 1;
      if (eventCount > 120) { socket.disconnect(true); return null; }
      try {
        const current = await auth.resolveSession(socket.handshake.auth?.token);
        if (!current) { socket.disconnect(true); return null; }
        if (!joining && !socket.rooms.has(partyId)) return null;
        const party = await auth.getPartyAccess(current, partyId);
        if (!party) { socket.leave(partyId); return null; }
        return party;
      } catch {
        socket.disconnect(true);
        return null;
      }
    }

    socket.on('join:party', async (partyId, acknowledge) => {
      const party = await access(partyId, true);
      if (party) {
        await socket.join(partyId);
        if (party.member_id) socket.join(`member:${party.member_id}`);
      }
      if (typeof acknowledge === 'function') acknowledge(party ? { ok: true } : { error: 'Party access denied.' });
    });
    socket.on('leave:party', (partyId) => {
      if (defaultAuth.validId(partyId)) socket.leave(partyId);
    });
    socket.on('video:progress', async (payload = {}) => {
      const { partyId, currentTime, duration } = payload || {};
      if (!Number.isFinite(currentTime) || currentTime < 0 || !Number.isFinite(duration) || duration < 0) return;
      const party = await access(partyId);
      if (party?.isHost) socket.to(partyId).emit('video:progress', { currentTime, duration });
    });
    socket.on('video:seek', async (payload = {}) => {
      const { partyId, seekTime } = payload || {};
      if (!Number.isFinite(seekTime) || seekTime < 0) return;
      const party = await access(partyId);
      if (party && (!party.is_locked || party.isHost)) socket.to(partyId).emit('video:seek', { seekTime });
    });
    socket.on('audio:settings', async (payload = {}) => {
      const { partyId, settings } = payload || {};
      if (!settings || !Number.isFinite(settings.key) || settings.key < -12 || settings.key > 12
        || !Number.isFinite(settings.tempo) || settings.tempo < 0.5 || settings.tempo > 2
        || !Number.isFinite(settings.vocalLevel) || settings.vocalLevel < 0 || settings.vocalLevel > 100) return;
      const party = await access(partyId);
      if (party && (!party.is_locked || party.isHost)) {
        socket.to(partyId).emit('audio:settings', { settings: { key: settings.key, tempo: settings.tempo, vocalLevel: settings.vocalLevel } });
      }
    });
  });
}

module.exports = { registerPartySockets };