const express = require('express');
const { randomUUID } = require('node:crypto');
const webauthnServer = require('@simplewebauthn/server');
const pool = require('../db/db');
const { createAuth, requireAccount, requireAdmin, publicSession, validId } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');
const { authError, passkeyConfig, createChallenges } = require('../lib/passkeys');

function createAuthRoutes({ database = pool, webauthn = webauthnServer, settings = process.env,
  challenges = createChallenges(), limiter = authLimiter } = {}) {
  const router = express.Router();
  const auth = createAuth({ database });
  const route = (handler) => async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      const status = error.status || (error.code === '23505' ? 409 : 500);
      res.status(status).json({ error: error.status ? error.message
        : status === 409 ? 'That account name or passkey is already registered.' : 'Authentication request failed.' });
    }
  };

  async function transaction(operation) {
    const client = await database.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function sessionResult(userId, client) {
    const token = await auth.createSession({ userId }, client);
    return { token, ...publicSession(await auth.resolveSession(token, client)) };
  }

  async function saveCredential(client, userId, credential, rpID) {
    await client.query(
      `INSERT INTO auth_credentials (id, user_id, public_key, counter, transports, rp_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [credential.id, userId, Buffer.from(credential.publicKey), credential.counter,
        JSON.stringify(credential.transports || []), rpID]
    );
  }

  async function registrationOptions(user, config, excludeCredentials = []) {
    return webauthn.generateRegistrationOptions({
      rpName: 'Karaoke Party', rpID: config.rpID,
      userID: Buffer.from(user.id), userName: user.name, userDisplayName: user.name,
      attestationType: 'none', excludeCredentials,
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
  }

  async function verifyRegistration(response, request) {
    let result;
    try {
      result = await webauthn.verifyRegistrationResponse({ response,
        expectedChallenge: request.challenge, expectedOrigin: request.origin, expectedRPID: request.rpID,
        requireUserVerification: true });
    } catch { throw authError(400, 'Passkey verification failed.'); }
    if (!result.verified || !result.registrationInfo) throw authError(400, 'Passkey verification failed.');
    return result.registrationInfo.credential;
  }

  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.post('/', (req, res) => {
    res.status(410).json({ error: 'Password login has been removed. Sign in with a passkey.' });
  });
  router.get('/qr-session', (req, res) => {
    res.status(410).json({ error: 'A valid host invitation is required to join a party.' });
  });

  router.post('/register/options', limiter, route(async (req, res) => {
    const config = passkeyConfig(req.get('origin'), settings);
    const name = typeof req.body.name === 'string' ? req.body.name.trim().replace(/\s+/g, ' ') : '';
    if (name.length < 2 || name.length > 60 || /[\x00-\x1f\x7f]/.test(name)) {
      throw authError(400, 'Account names must contain 2 to 60 characters.');
    }
    const existing = await database.query('SELECT id FROM auth_users WHERE LOWER(name) = LOWER($1)', [name]);
    if (existing.rows.length) throw authError(409, 'That account name is already registered.');
    const user = { id: randomUUID(), name };
    const options = await registrationOptions(user, config);
    const requestId = challenges.issue({ ...config, kind: 'register', challenge: options.challenge, user });
    res.json({ requestId, options });
  }));

  router.post('/register/verify', limiter, route(async (req, res) => {
    const request = challenges.consume(req.body.requestId, 'register', req.get('origin'));
    const credential = await verifyRegistration(req.body.response, request);
    const result = await transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(1948271)');
      const { rows } = await client.query('SELECT NOT EXISTS (SELECT 1 FROM auth_users) AS bootstrap');
      const bootstrap = rows[0].bootstrap;
      await client.query('INSERT INTO auth_users (id, name, role, status) VALUES ($1, $2, $3, $4)',
        [request.user.id, request.user.name, bootstrap ? 'admin' : 'member', bootstrap ? 'approved' : 'pending']);
      await saveCredential(client, request.user.id, credential, request.rpID);
      return bootstrap ? sessionResult(request.user.id, client)
        : { pending: true, message: 'Passkey registered. An administrator must approve your account before sign-in.' };
    });
    res.status(201).json(result);
  }));

  router.post('/login/options', limiter, route(async (req, res) => {
    const config = passkeyConfig(req.get('origin'), settings);
    const options = await webauthn.generateAuthenticationOptions({ rpID: config.rpID, userVerification: 'required' });
    const requestId = challenges.issue({ ...config, kind: 'login', challenge: options.challenge });
    res.json({ requestId, options });
  }));

  router.post('/login/verify', limiter, route(async (req, res) => {
    const request = challenges.consume(req.body.requestId, 'login', req.get('origin'));
    const result = await transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT credential.*, account.status FROM auth_credentials credential
         JOIN auth_users account ON account.id = credential.user_id
         WHERE credential.id = $1 AND credential.rp_id = $2 FOR UPDATE OF credential, account`,
        [typeof req.body.response?.id === 'string' ? req.body.response.id : '', request.rpID]
      );
      const credential = rows[0];
      if (!credential) throw authError(400, 'Passkey verification failed.');
      if (credential.status !== 'approved') throw authError(403,
        credential.status === 'pending' ? 'Your account is awaiting administrator approval.' : 'Your account access has been revoked.');
      const userHandle = req.body.response?.response?.userHandle;
      if (userHandle && userHandle !== Buffer.from(credential.user_id).toString('base64url')) {
        throw authError(400, 'Passkey verification failed.');
      }
      let verification;
      try {
        verification = await webauthn.verifyAuthenticationResponse({ response: req.body.response,
          expectedChallenge: request.challenge, expectedOrigin: request.origin, expectedRPID: request.rpID,
          requireUserVerification: true,
          credential: { id: credential.id, publicKey: new Uint8Array(credential.public_key),
            counter: Number(credential.counter), transports: credential.transports } });
      } catch { throw authError(400, 'Passkey verification failed.'); }
      if (!verification.verified) throw authError(400, 'Passkey verification failed.');
      await client.query('UPDATE auth_credentials SET counter = $1, last_used_at = NOW() WHERE id = $2',
        [verification.authenticationInfo.newCounter, credential.id]);
      return sessionResult(credential.user_id, client);
    });
    res.json(result);
  }));

  router.use(auth.requireAuth);
  router.get('/me', (req, res) => res.json(publicSession(req.auth)));
  router.post('/logout', route(async (req, res) => {
    await database.query('DELETE FROM auth_sessions WHERE id = $1', [req.auth.sessionId]);
    req.app.get('io')?.in(`session:${req.auth.sessionId}`).disconnectSockets(true);
    res.sendStatus(204);
  }));

  router.use(requireAccount);
  router.get('/passkeys', route(async (req, res) => {
    const { rows } = await database.query(
      'SELECT id, transports, rp_id, created_at, last_used_at FROM auth_credentials WHERE user_id = $1 ORDER BY created_at',
      [req.auth.userId]);
    res.json(rows);
  }));
  router.post('/passkeys/options', limiter, route(async (req, res) => {
    const config = passkeyConfig(req.get('origin'), settings);
    const { rows } = await database.query('SELECT id, transports FROM auth_credentials WHERE user_id = $1 AND rp_id = $2',
      [req.auth.userId, config.rpID]);
    const options = await registrationOptions(req.auth.user, config, rows);
    const requestId = challenges.issue({ ...config, kind: 'enroll', challenge: options.challenge,
      userId: req.auth.userId, sessionId: req.auth.sessionId });
    res.json({ requestId, options });
  }));
  router.post('/passkeys/verify', limiter, route(async (req, res) => {
    const request = challenges.consume(req.body.requestId, 'enroll', req.get('origin'), req.auth.sessionId);
    if (request.userId !== req.auth.userId) throw authError(400, 'Passkey request invalid.');
    const credential = await verifyRegistration(req.body.response, request);
    await transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT account.id FROM auth_users account JOIN auth_sessions session ON session.user_id = account.id
         WHERE account.id = $1 AND account.status = 'approved' AND session.id = $2 AND session.expires_at > NOW()
         FOR UPDATE OF account, session`, [req.auth.userId, req.auth.sessionId]);
      if (!rows.length) throw authError(403, 'Account access is no longer available.');
      await saveCredential(client, req.auth.userId, credential, request.rpID);
    });
    res.status(201).json({ verified: true });
  }));
  router.delete('/passkeys/:id', route(async (req, res) => {
    await transaction(async (client) => {
      await client.query('SELECT id FROM auth_users WHERE id = $1 FOR UPDATE', [req.auth.userId]);
      const { rows } = await client.query('SELECT id FROM auth_credentials WHERE user_id = $1', [req.auth.userId]);
      if (!rows.some((credential) => credential.id === req.params.id)) throw authError(404, 'Passkey not found.');
      if (rows.length <= 1) throw authError(409, 'Keep at least one passkey on your account.');
      await client.query('DELETE FROM auth_credentials WHERE id = $1 AND user_id = $2', [req.params.id, req.auth.userId]);
    });
    res.sendStatus(204);
  }));

  router.get('/users', requireAdmin, route(async (req, res) => {
    const { rows } = await database.query('SELECT id, name, role, status, created_at FROM auth_users ORDER BY created_at');
    res.json(rows);
  }));
  router.patch('/users/:id', requireAdmin, route(async (req, res) => {
    const { role, status } = req.body;
    if (!validId(req.params.id) || (!role && !status)
      || (role !== undefined && !['admin', 'member'].includes(role))
      || (status !== undefined && !['pending', 'approved', 'revoked'].includes(status))) {
      throw authError(400, 'Invalid account update.');
    }
    const user = await transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(1948271)');
      const administrator = await client.query("SELECT id FROM auth_users WHERE id = $1 AND role = 'admin' AND status = 'approved' FOR UPDATE",
        [req.auth.userId]);
      if (!administrator.rows.length) throw authError(403, 'Admin access required.');
      const { rows } = await client.query('SELECT * FROM auth_users WHERE id = $1 FOR UPDATE', [req.params.id]);
      const target = rows[0];
      if (!target) throw authError(404, 'Account not found.');
      const nextRole = role || target.role;
      const nextStatus = status || target.status;
      if (target.id === req.auth.userId && nextStatus !== 'approved') throw authError(409, 'You cannot revoke your own access.');
      if (target.role === 'admin' && target.status === 'approved' && (nextRole !== 'admin' || nextStatus !== 'approved')) {
        const others = await client.query("SELECT id FROM auth_users WHERE role = 'admin' AND status = 'approved' AND id <> $1 LIMIT 1", [target.id]);
        if (!others.rows.length) throw authError(409, 'Keep at least one approved administrator.');
      }
      const result = await client.query('UPDATE auth_users SET role = $1, status = $2 WHERE id = $3 RETURNING id, name, role, status, created_at',
        [nextRole, nextStatus, target.id]);
      await client.query('DELETE FROM auth_sessions WHERE user_id = $1', [target.id]);
      return result.rows[0];
    });
    req.app.get('io')?.in(`user:${user.id}`).disconnectSockets(true);
    res.json(user);
  }));
  return router;
}

module.exports = createAuthRoutes();
module.exports.createAuthRoutes = createAuthRoutes;
