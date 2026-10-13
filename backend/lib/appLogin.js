const { createHash } = require('node:crypto');
const { authError } = require('./passkeys');
const { hashToken, newToken, validToken } = require('../middleware/auth');

const APP_REDIRECT_URI = 'com.sskaraoke.player:/oauth/callback';
const APP_CODE_TTL_MS = 2 * 60 * 1000;

function appLoginRequest(value, config) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 4
    || value.redirect_uri !== APP_REDIRECT_URI || value.code_challenge_method !== 'S256'
    || !validToken(value.code_challenge) || !validToken(value.state)) {
    throw authError(400, 'Invalid app sign-in request. Start sign-in again from the app.');
  }
  if (!config.origin.startsWith('https://')) {
    throw authError(403, 'App sign-in requires an HTTPS passkey origin.');
  }
  return { redirect_uri: APP_REDIRECT_URI, code_challenge: value.code_challenge,
    code_challenge_method: 'S256', state: value.state };
}

function appTokenRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 3 || value.redirect_uri !== APP_REDIRECT_URI
    || !validToken(value.code) || !validToken(value.code_verifier)) {
    throw authError(400, 'Invalid or expired app sign-in code. Start sign-in again from the app.');
  }
  return { codeHash: hashToken(value.code), redirectUri: APP_REDIRECT_URI,
    codeChallenge: createHash('sha256').update(value.code_verifier, 'ascii').digest('base64url') };
}

async function issueAppLoginCode(client, userId, request) {
  const code = newToken();
  await client.query('DELETE FROM auth_app_codes WHERE expires_at <= NOW()');
  await client.query(
    `INSERT INTO auth_app_codes (code_hash, user_id, code_challenge, redirect_uri, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [hashToken(code), userId, request.code_challenge, request.redirect_uri, new Date(Date.now() + APP_CODE_TTL_MS)]
  );
  const callback = new URL(APP_REDIRECT_URI);
  callback.searchParams.set('code', code);
  callback.searchParams.set('state', request.state);
  return { redirectUrl: callback.href };
}

async function consumeAppLoginCode(client, request) {
  const parameters = [request.codeHash, request.codeChallenge, request.redirectUri];
  const { rows } = await client.query(
    `SELECT account.id FROM auth_users account JOIN auth_app_codes code ON code.user_id = account.id
     WHERE code.code_hash = $1 AND code.code_challenge = $2 AND code.redirect_uri = $3
       AND code.expires_at > NOW() AND account.status = 'approved' FOR UPDATE OF account`, parameters
  );
  if (!rows.length) throw authError(400, 'Invalid or expired app sign-in code. Start sign-in again from the app.');
  const consumed = await client.query(
    `DELETE FROM auth_app_codes WHERE code_hash = $1 AND code_challenge = $2 AND redirect_uri = $3
       AND expires_at > clock_timestamp() AND user_id = $4 RETURNING user_id`, [...parameters, rows[0].id]
  );
  if (!consumed.rows.length) throw authError(400, 'Invalid or expired app sign-in code. Start sign-in again from the app.');
  return consumed.rows[0].user_id;
}

module.exports = { APP_REDIRECT_URI, APP_CODE_TTL_MS, appLoginRequest, appTokenRequest,
  issueAppLoginCode, consumeAppLoginCode };