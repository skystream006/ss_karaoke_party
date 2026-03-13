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

module.exports = { generalLimiter, writeLimiter, searchLimiter };
