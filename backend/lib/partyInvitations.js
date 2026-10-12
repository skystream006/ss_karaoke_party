const pool = require('../db/db');
const { createAuth, hashToken, newToken, validToken, validId, publicSession } = require('../middleware/auth');
const { authError } = require('./passkeys');

function createPartyInvitations({ database = pool } = {}) {
  const auth = createAuth({ database });

  async function find(token, partyId, client = database, lock = false) {
    if (!validToken(token) || (partyId !== undefined && !validId(partyId))) {
      throw authError(403, 'Invalid or expired host invitation.');
    }
    const { rows } = await client.query(
      `SELECT invitation.id, invitation.party_id, invitation.host_session_id,
              LEAST(invitation.expires_at, host.expires_at) AS expires_at,
              party.name AS party_name, member.name AS host_name
       FROM party_invitations invitation
       JOIN auth_sessions host ON host.id = invitation.host_session_id
       JOIN auth_users account ON account.id = host.user_id
       JOIN party_members member ON member.id = invitation.host_member_id
       JOIN parties party ON party.id = invitation.party_id
       WHERE invitation.token_hash = $1 AND ($2::uuid IS NULL OR invitation.party_id = $2)
         AND invitation.expires_at > NOW() AND host.expires_at > NOW()
         AND account.status = 'approved' AND member.user_id = host.user_id
         AND member.party_id = party.id AND member.role = 'organizer' AND party.is_active = true
       ${lock ? 'FOR SHARE OF invitation, host, account, member, party' : ''}`,
      [hashToken(token), partyId || null]
    );
    if (!rows[0]) throw authError(403, 'Invalid or expired host invitation.');
    return rows[0];
  }

  async function issue(session, partyId) {
    if (!session?.userId || !validId(partyId)) throw authError(403, 'A signed-in host is required.');
    const client = await database.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT member.id, host.expires_at FROM party_members member
         JOIN parties party ON party.id = member.party_id
         JOIN auth_sessions host ON host.user_id = member.user_id
         JOIN auth_users account ON account.id = host.user_id
         WHERE member.party_id = $1 AND member.user_id = $2 AND member.role = 'organizer'
           AND host.id = $3 AND host.expires_at > NOW() AND account.status = 'approved' AND party.is_active = true
         FOR UPDATE OF host, member, party`, [partyId, session.userId, session.sessionId]);
      if (!rows[0]) throw authError(403, 'Join this party as a host before creating an invitation.');
      const previous = await client.query(
        'DELETE FROM party_invitations WHERE host_session_id = $1 AND host_member_id = $2 RETURNING id',
        [session.sessionId, rows[0].id]);
      const token = newToken();
      const expiresAt = new Date(Math.min(Date.now() + 12 * 60 * 60 * 1000, new Date(rows[0].expires_at).getTime()));
      const result = await client.query(
        `INSERT INTO party_invitations (token_hash, party_id, host_member_id, host_session_id, expires_at)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [hashToken(token), partyId, rows[0].id, session.sessionId, expiresAt]);
      await client.query('COMMIT');
      return { id: result.rows[0].id, token, partyId, expiresAt, revokedIds: previous.rows.map((entry) => entry.id) };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function join(partyId, body) {
    const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
    if (!name || name.length > 60 || /[\x00-\x1f\x7f]/.test(name)) throw authError(400, 'Enter a name between 1 and 60 characters.');
    if ((body.role !== undefined && body.role !== 'guest') || body.member_id || body.user_id) {
      throw authError(403, 'Invitations grant guest access only.');
    }
    if (!validToken(body.invitation) || !validId(partyId)) throw authError(403, 'Invalid or expired host invitation.');
    const client = await database.connect();
    try {
      await client.query('BEGIN');
      const invitation = await find(body.invitation, partyId, client, true);
      const { rows } = await client.query(
        "INSERT INTO party_members (party_id, name, role) VALUES ($1, $2, 'guest') RETURNING id, party_id, name, role, joined_at",
        [partyId, name]);
      const member = rows[0];
      const token = await auth.createSession({ partyId, memberId: member.id,
        hostSessionId: invitation.host_session_id, invitationId: invitation.id, expiresAt: invitation.expires_at }, client);
      const session = await auth.resolveSession(token, client);
      if (!session) throw authError(403, 'Host invitation is no longer available.');
      await client.query('COMMIT');
      return { member, token, ...publicSession(session) };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  return { find, issue, join };
}

module.exports = { createPartyInvitations };