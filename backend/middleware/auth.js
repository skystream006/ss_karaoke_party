const { randomBytes, createHash } = require('node:crypto');
const pool = require('../db/db');

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const hashToken = (token) => createHash('sha256').update(token).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');
const validToken = (token) => typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);
const validId = (value) => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);

function publicSession(session) {
  return {
    level: session.level,
    user: session.user,
    partyId: session.partyId,
    memberId: session.memberId,
    expiresAt: session.expiresAt,
  };
}

function createAuth({ database = pool } = {}) {
  async function createSession(principal, client = database) {
    if (!principal || (typeof principal !== 'object')
      || (!principal.userId && !(principal.partyId && principal.memberId && principal.hostSessionId && principal.invitationId))) {
      throw new Error('A verified account or party invitation is required');
    }
    const token = newToken();
    const expiresAt = new Date(Math.min(Date.now() + SESSION_TTL_MS,
      principal.expiresAt ? new Date(principal.expiresAt).getTime() : Infinity));
    await client.query(
      `INSERT INTO auth_sessions (token_hash, user_id, party_id, member_id, host_session_id, invitation_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [hashToken(token), principal.userId || null, principal.partyId || null, principal.memberId || null,
        principal.hostSessionId || null, principal.invitationId || null, expiresAt]
    );
    return token;
  }

  async function resolveSession(token, client = database) {
    if (!validToken(token)) return null;
    return readSession(hashToken(token), null, client);
  }

  async function resolveSessionById(sessionId, client = database) {
    if (!validId(sessionId)) return null;
    return readSession(null, sessionId, client);
  }

  async function readSession(tokenHash, sessionId, client) {
    const { rows } = await client.query(
      `SELECT session.id AS session_id, session.user_id, session.party_id, session.member_id,
              session.host_session_id, session.invitation_id, session.expires_at,
              account.name, account.role, host.user_id AS host_user_id, invitation.host_member_id
       FROM auth_sessions session
       LEFT JOIN auth_users account ON account.id = session.user_id
       LEFT JOIN party_invitations invitation ON invitation.id = session.invitation_id
       LEFT JOIN auth_sessions host ON host.id = session.host_session_id
       LEFT JOIN auth_users host_account ON host_account.id = host.user_id
       LEFT JOIN party_members host_member ON host_member.id = invitation.host_member_id
       LEFT JOIN party_members guest ON guest.id = session.member_id
       LEFT JOIN parties party ON party.id = session.party_id
      WHERE (session.token_hash = $1 OR session.id = $2::uuid) AND session.expires_at > NOW()
         AND ((session.user_id IS NOT NULL AND account.status = 'approved')
           OR (session.user_id IS NULL AND party.is_active = true
             AND guest.party_id = session.party_id AND guest.role = 'guest' AND guest.user_id IS NULL
             AND invitation.party_id = session.party_id AND invitation.expires_at > NOW()
             AND invitation.host_session_id = host.id AND host.expires_at > NOW()
             AND host_account.status = 'approved' AND host_member.user_id = host.user_id
             AND host_member.party_id = session.party_id AND host_member.role = 'organizer'))`,
      [tokenHash, sessionId]
    );
    const session = rows[0];
    if (!session) return null;
    return {
      sessionId: session.session_id,
      userId: session.user_id,
      user: session.user_id ? { id: session.user_id, name: session.name, role: session.role } : null,
      level: session.user_id ? session.role : 'guest',
      partyId: session.party_id,
      memberId: session.member_id,
      hostSessionId: session.host_session_id,
      hostUserId: session.host_user_id,
      hostMemberId: session.host_member_id,
      invitationId: session.invitation_id,
      expiresAt: session.expires_at,
    };
  }

  async function requireAuth(req, res, next) {
    const header = req.headers.authorization;
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : null;
    try {
      const session = await resolveSession(token);
      if (!session) return res.status(401).json({ error: 'Sign in or scan a current host invitation.' });
      req.auth = session;
      req.authLevel = session.level;
      next();
    } catch {
      res.status(503).json({ error: 'Authentication is temporarily unavailable.' });
    }
  }

  async function getPartyAccess(session, partyId) {
    if (!session || !validId(partyId) || (session.level === 'guest' && session.partyId !== partyId)) return null;
    const { rows } = await database.query(
      `SELECT party.id, party.is_active, party.is_locked, member.id AS member_id, member.name, member.role
       FROM parties party LEFT JOIN party_members member ON member.party_id = party.id
         AND (($2::uuid IS NOT NULL AND member.user_id = $2) OR ($3::uuid IS NOT NULL AND member.id = $3))
       WHERE party.id = $1`,
      [partyId, session.userId || null, session.memberId || null]
    );
    const party = rows[0];
    if (!party || (!party.member_id && session.level !== 'admin')) return null;
    if (!party.is_active && session.level !== 'admin') return null;
    return { ...party, isHost: session.level !== 'guest' && (session.level === 'admin' || party.role === 'organizer') };
  }

  function partyGuard(hostOnly) {
    return async (req, res, next) => {
      try {
        const party = await getPartyAccess(req.auth, req.params.partyId || req.params.id);
        if (!party || (hostOnly && !party.isHost)) return res.status(403).json({ error: 'Party access denied.' });
        req.partyAccess = party;
        next();
      } catch {
        res.status(503).json({ error: 'Party access could not be verified.' });
      }
    };
  }

  return { createSession, resolveSession, resolveSessionById, requireAuth, getPartyAccess,
    requirePartyAccess: partyGuard(false), requirePartyHost: partyGuard(true) };
}

function requireAccount(req, res, next) {
  if (!req.auth?.userId || !['admin', 'member'].includes(req.auth.level)) {
    return res.status(403).json({ error: 'An approved passkey account is required.' });
  }
  next();
}

function requireOrganizerAccount(req, res, next) {
  if (req.auth?.userId && req.auth.level === 'hostscreen') return next();
  return requireAccount(req, res, next);
}

function forbidHostscreen(req, res, next) {
  if (req.auth?.level === 'hostscreen') return res.status(403).json({ error: 'HOSTSCREEN cannot execute searches.' });
  next();
}

function requireAdmin(req, res, next) {
  if (req.authLevel !== 'admin' || !req.auth?.userId) return res.status(403).json({ error: 'Admin access required.' });
  next();
}

module.exports = { ...createAuth(), createAuth, requireAccount, requireOrganizerAccount, forbidHostscreen, requireAdmin, publicSession,
  hashToken, newToken, validToken, validId };
