const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

// In-memory session store for all authenticated sessions
const sessions = new Map();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Periodically purge expired sessions to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (session.expires < now) {
      sessions.delete(token);
    }
  }
}, 60 * 60 * 1000); // run cleanup every hour

/**
 * Create a new session token for the given auth level.
 * Returns the token string.
 */
function createSession(level) {
  const token = uuidv4();
  sessions.set(token, { level, expires: Date.now() + SESSION_TTL_MS });
  return token;
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) {
    // Still do a dummy comparison to avoid length-based timing leaks
    crypto.timingSafeEqual(Buffer.from(a), Buffer.from(a));
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Validate a raw password against the configured env vars.
 * Returns 'admin', 'member', or null.
 */
function validatePassword(password) {
  if (!password) return null;
  if (process.env.API_ADMIN_PW && safeEqual(password, process.env.API_ADMIN_PW)) return 'admin';
  if (process.env.API_MEMBER_PW && safeEqual(password, process.env.API_MEMBER_PW)) return 'member';
  return null;
}

/**
 * Resolve the auth level for a given bearer token.
 * Returns 'admin', 'member', or null.
 */
function resolveAuthLevel(token) {
  if (!token) return null;

  const session = sessions.get(token);
  if (session) {
    if (session.expires < Date.now()) {
      sessions.delete(token);
      return null;
    }
    return session.level;
  }

  return null;
}

/**
 * Middleware: requires the request to carry a valid member or admin token.
 * Sets req.authLevel to 'member' or 'admin' on success.
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  const level = resolveAuthLevel(token);
  if (!level) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  req.authLevel = level;
  next();
}

/**
 * Middleware: requires the request to carry a valid admin token.
 * Must be used after requireAuth (relies on req.authLevel being set).
 */
function requireAdmin(req, res, next) {
  if (req.authLevel !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin, createSession, validatePassword };
