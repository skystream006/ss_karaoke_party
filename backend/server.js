require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pool = require('./db/db');
const { generalLimiter, writeLimiter, searchLimiter } = require('./middleware/rateLimiter');

const app = express();
const server = http.createServer(app);

// CORS configuration
const allowedOrigins = process.env.FRONTEND_URL
  ? [process.env.FRONTEND_URL]
  : ['http://localhost:3000', 'http://localhost:3001'];

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
  },
});

app.set('io', io);

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

// Apply general rate limiter to all API routes
app.use('/api', generalLimiter);

// Routes (more specific limiters are applied per-route inside route files)
app.use('/api/parties', require('./routes/parties'));
app.use('/api/queue', require('./routes/queue'));
app.use('/api/youtube', searchLimiter, require('./routes/youtube'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Server info (local IP address)
app.get('/api/server-info', (req, res) => {
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

// Socket.IO
io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  socket.on('join:party', (partyId) => {
    socket.join(partyId);
    console.log(`Socket ${socket.id} joined party room: ${partyId}`);
  });

  socket.on('leave:party', (partyId) => {
    socket.leave(partyId);
    console.log(`Socket ${socket.id} left party room: ${partyId}`);
  });

  // Organizer broadcasts current playback position to guests
  socket.on('video:progress', ({ partyId, currentTime, duration }) => {
    if (
      typeof partyId !== 'string' ||
      typeof currentTime !== 'number' || !isFinite(currentTime) || currentTime < 0 ||
      typeof duration !== 'number' || !isFinite(duration) || duration < 0
    ) return;
    socket.to(partyId).emit('video:progress', { currentTime, duration });
  });

  // Guest requests a seek; organizer receives and seeks the player
  socket.on('video:seek', ({ partyId, seekTime }) => {
    if (
      typeof partyId !== 'string' ||
      typeof seekTime !== 'number' || !isFinite(seekTime) || seekTime < 0
    ) return;
    socket.to(partyId).emit('video:seek', { seekTime });
  });

  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

// Initialize database schema then start server
async function initDb() {
  try {
    const sqlPath = path.join(__dirname, 'db', 'init.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await pool.query(sql);
    console.log('Database schema initialized');
  } catch (err) {
    console.error('Failed to initialize database schema:', err.message);
  }
}

const PORT = process.env.PORT || 5000;

initDb().then(() => {
  server.listen(PORT, () => {
    console.log(`Karaoke Party backend listening on port ${PORT}`);
  });
});
