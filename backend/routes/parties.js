const express = require('express');
const router = express.Router();
const pool = require('../db/db');
const { v4: uuidv4 } = require('uuid');
const { writeLimiter } = require('../middleware/rateLimiter');

// Generate a short join code
function generateJoinCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// GET /api/parties - List all active parties
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, join_code, created_at FROM parties WHERE is_active = true ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch parties' });
  }
});

// POST /api/parties - Create a new party
router.post('/', writeLimiter, async (req, res) => {
  const { name, organizer_name } = req.body;
  if (!name || !organizer_name) {
    return res.status(400).json({ error: 'Party name and organizer name are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Generate unique join code
    let joinCode;
    let attempts = 0;
    while (attempts < 10) {
      joinCode = generateJoinCode();
      const existing = await client.query('SELECT id FROM parties WHERE join_code = $1', [joinCode]);
      if (existing.rows.length === 0) break;
      attempts++;
    }

    const partyResult = await client.query(
      'INSERT INTO parties (name, join_code) VALUES ($1, $2) RETURNING *',
      [name, joinCode]
    );
    const party = partyResult.rows[0];

    const memberResult = await client.query(
      'INSERT INTO party_members (party_id, name, role) VALUES ($1, $2, $3) RETURNING *',
      [party.id, organizer_name, 'organizer']
    );

    await client.query('COMMIT');
    res.status(201).json({ party, member: memberResult.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to create party' });
  } finally {
    client.release();
  }
});

// GET /api/parties/:id - Get party details
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, join_code, is_active, created_at FROM parties WHERE id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Party not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch party' });
  }
});

// GET /api/parties/join/:code - Look up a party by join code
router.get('/join/:code', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, join_code, is_active FROM parties WHERE join_code = $1 AND is_active = true',
      [req.params.code.toUpperCase()]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Party not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to find party' });
  }
});

// POST /api/parties/:id/join - Join a party
router.post('/:id/join', writeLimiter, async (req, res) => {
  const { name, role } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }
  const memberRole = role === 'organizer' ? 'organizer' : 'guest';

  try {
    const partyResult = await pool.query(
      'SELECT id FROM parties WHERE id = $1 AND is_active = true',
      [req.params.id]
    );
    if (partyResult.rows.length === 0) {
      return res.status(404).json({ error: 'Party not found or not active' });
    }

    const memberResult = await pool.query(
      'INSERT INTO party_members (party_id, name, role) VALUES ($1, $2, $3) RETURNING *',
      [req.params.id, name, memberRole]
    );
    res.status(201).json(memberResult.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to join party' });
  }
});

// DELETE /api/parties/:id - End a party (organizer only)
router.delete('/:id', async (req, res) => {
  try {
    await pool.query(
      'UPDATE parties SET is_active = false WHERE id = $1',
      [req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to end party' });
  }
});

module.exports = router;
