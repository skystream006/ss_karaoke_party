const rateLimit = require('express-rate-limit');

/**
 * General API rate limiter: 200 requests per 15 minutes per IP.
 */
const generalLimiter = rateLimit({
  validate: { xForwardedForHeader: false },
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

/**
 * Stricter limiter for write operations (create party, join party, add to queue).
 * 60 requests per 15 minutes per IP.
 */
const writeLimiter = rateLimit({
  validate: { xForwardedForHeader: false },
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

/**
 * YouTube search limiter: 30 requests per minute per IP
 * (keeps costs reasonable on the YouTube API quota).
 */
const searchLimiter = rateLimit({
  validate: { xForwardedForHeader: false },
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many search requests, please wait a moment.' },
});

const authLimiter = rateLimit({
  validate: { xForwardedForHeader: false },
  windowMs: 5 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Please try again later.' },
});

function createHostScreenLoginLimiter({ onBlocked = async () => {} } = {}) {
  return rateLimit({
    validate: { xForwardedForHeader: false },
    windowMs: 10 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    handler: async (req, res) => {
      try {
        await onBlocked(req);
        res.status(429).json({ error: 'Too many HOST login attempts. Please wait for the 10-minute retry window to reset.' });
      } catch (error) {
        res.status(503).json({ error: error.status === 503 ? error.message : 'HOST login is temporarily unavailable.' });
      }
    },
  });
}

module.exports = { generalLimiter, writeLimiter, searchLimiter, authLimiter, createHostScreenLoginLimiter };
