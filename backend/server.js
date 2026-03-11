require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const pool = require('./db/db');

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

// Routes
app.use('/api/parties', require('./routes/parties'));
app.use('/api/queue', require('./routes/queue'));
app.use('/api/youtube', require('./routes/youtube'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
