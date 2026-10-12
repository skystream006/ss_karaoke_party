const { randomUUID } = require('node:crypto');
const { isIP } = require('node:net');

function authError(status, message) {
  return Object.assign(new Error(message), { status });
}

function passkeyConfigurations(settings = process.env) {
  const primaryOrigin = settings.PASSKEY_ORIGIN || settings.FRONTEND_URL || 'http://localhost:3000';
  const configurations = [{ origin: primaryOrigin, rpID: settings.PASSKEY_RP_ID }];
  if (settings.PASSKEY_ORIGIN_SECONDARY || settings.PASSKEY_RP_ID_SECONDARY) {
    if (!settings.PASSKEY_ORIGIN_SECONDARY || !settings.PASSKEY_RP_ID_SECONDARY) {
      throw authError(503, 'Both secondary passkey settings are required.');
    }
    configurations.push({ origin: settings.PASSKEY_ORIGIN_SECONDARY, rpID: settings.PASSKEY_RP_ID_SECONDARY });
  }
  return configurations.map(({ origin, rpID }) => {
    let url;
    try { url = new URL(origin); } catch { throw authError(503, 'Invalid passkey origin configuration.'); }
    const hostname = rpID || url.hostname;
    const defaultPortOrigin = `${url.origin}:${url.protocol === 'https:' ? '443' : '80'}`;
    if ((url.origin !== origin && defaultPortOrigin !== origin) || url.username || url.password || isIP(hostname)
      || !/^[a-z0-9]+(?:[.-][a-z0-9-]+)*$/.test(hostname)
      || (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost'))
      || (url.hostname !== hostname && !url.hostname.endsWith(`.${hostname}`))) {
      throw authError(503, 'Passkeys require an HTTPS origin and matching hostname RP ID (or http://localhost).');
    }
    return { origin: url.origin, rpID: hostname };
  });
}

function passkeyConfig(origin, settings) {
  const configuration = passkeyConfigurations(settings).find((entry) => entry.origin === origin);
  if (!configuration) throw authError(403, 'This origin is not enabled for passkeys.');
  return configuration;
}

function createChallenges({ now = Date.now, capacity = 1000, ttl = 5 * 60 * 1000 } = {}) {
  const challenges = new Map();
  return {
    issue(value) {
      for (const [requestId, entry] of challenges) {
        if (entry.expiresAt <= now()) challenges.delete(requestId);
      }
      if (challenges.size >= capacity) throw authError(429, 'Too many pending passkey requests. Try again later.');
      const requestId = randomUUID();
      challenges.set(requestId, { ...value, expiresAt: now() + ttl });
      return requestId;
    },
    consume(requestId, kind, origin, sessionId) {
      const entry = challenges.get(requestId);
      challenges.delete(requestId);
      if (!entry || entry.expiresAt <= now() || entry.kind !== kind || entry.origin !== origin
        || entry.sessionId !== sessionId) {
        throw authError(400, 'Passkey request expired or invalid. Please try again.');
      }
      return entry;
    },
  };
}

module.exports = { authError, passkeyConfigurations, passkeyConfig, createChallenges };