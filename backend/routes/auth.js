const express = require('express');
const router = express.Router();
const { createSession, validatePassword } = require('../middleware/auth');

/**
 * POST /api/auth
 * Validates a password and returns a session token with its auth level.
 * Body: { password: string }
 * Response: { token: string, level: 'member' | 'admin' }
 */
router.post('/', (req, res) => {
  const { password = '' } = req.body;

  const level = validatePassword(password);
  if (!level) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  const token = createSession(level);
  res.json({ level, token });
});

/**
 * GET /api/auth/qr-session
 * Issues a short-lived member-level session token for QR-code access.
 * No authentication required — any request to a QR join URL triggers this.
 * Response: { token: string, level: 'member' }
 */
router.get('/qr-session', (req, res) => {
  const token = createSession('member');
  res.json({ token, level: 'member' });
});

module.exports = router;
