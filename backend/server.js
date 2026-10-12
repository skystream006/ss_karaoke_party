require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const os = require('os');
const pool = require('./db/db');
const { generalLimiter, writeLimiter, searchLimiter } = require('./middleware/rateLimiter');
const { requireAuth, requireAccount } = require('./middleware/auth');
const { passkeyConfigurations } = require('./lib/passkeys');
const { registerPartySockets } = require('./lib/partySockets');
const ssmusic = require('./routes/ssmusic').createSsmusicRoutes();
const { createSsmusicJobs } = require('./lib/ssmusicJobs');

const app = express();
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', /^\d+$/.test(process.env.TRUST_PROXY)
    ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY);
}
const server = http.createServer(app);

// Database schema is managed by Flyway (see backend/db/migrations/).

// CORS configuration
const allowedOrigins = passkeyConfigurations().map(({ origin }) => origin);

const io = new Server(server, {
  maxHttpBufferSize: 8192,
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
  },
});

app.set('io', io);
const ssmusicJobs = createSsmusicJobs({ pool, io });
app.set('ssmusicJobs', ssmusicJobs);
server.on('close', () => ssmusicJobs.close());

app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: '64kb' }));
app.use('/api', (req, res, next) => {
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cache-Control', 'no-store');
  next();
});

// Apply general rate limiter to all API routes
app.use('/api', generalLimiter);

// Auth routes (no authentication required)
app.use('/api/auth', require('./routes/auth'));

// Health check (public — no auth required for monitoring)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Native media elements authenticate only with an expiring, single-resource ticket.
app.use('/api/ssmusic/media', ssmusic.mediaRouter);

app.use('/api/parties', require('./routes/parties'));

// Apply authentication to all remaining API routes
app.use('/api', requireAuth);

// Routes (more specific limiters are applied per-route inside route files)
app.use('/api/queue', require('./routes/queue'));
app.use('/api/youtube', searchLimiter, require('./routes/youtube'));
app.use('/api/ssmusic', searchLimiter, ssmusic.apiRouter);

// Server info (local IP address)
app.get('/api/server-info', requireAccount, (req, res) => {
  const interfaces = os.networkInterfaces();
  let localIp = null;
  for (const iface of Object.values(interfaces)) {
    for (const alias of iface) {
      if ((alias.family === 'IPv4' || alias.family === 4) && !alias.internal) {
        localIp = alias.address;
        break;
      }
    }
    if (localIp) break;
  }
  res.json({ ip: localIp });
});

registerPartySockets(io);

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`Karaoke Party backend listening on port ${PORT}`);
  ssmusicJobs.resume().catch(() => console.error('Failed to resume pending ssMusic jobs'));
});
