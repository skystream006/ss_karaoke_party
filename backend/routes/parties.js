const express = require('express');
const router = express.Router();
const pool = require('../db/db');
const { v4: uuidv4 } = require('uuid');
const { writeLimiter } = require('../middleware/rateLimiter');

const DEFAULT_ORGANIZER_NAME = 'Organizer';
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

// GET /api/parties/all - List all parties (active and inactive)
router.get('/all', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, join_code, is_active, created_at FROM parties ORDER BY created_at DESC'
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

// GET /api/parties/members/search - Search members by name across all parties
router.get('/members/search', async (req, res) => {
  const { name } = req.query;
  if (!name || !name.trim() || name.trim().length < 2) {
    return res.json([]);
  }
  try {
    const result = await pool.query(
      `SELECT pm.id, pm.name, pm.party_id, pm.role, pm.joined_at, p.name AS party_name
       FROM party_members pm
       JOIN parties p ON pm.party_id = p.id
       WHERE pm.name ILIKE $1
       ORDER BY pm.joined_at DESC
       LIMIT 10`,
      [`%${name.trim()}%`]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to search members' });
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
  const memberRole = role === 'organizer' ? 'organizer' : 'guest';
  if (!name && memberRole !== 'organizer') {
    return res.status(400).json({ error: 'Name is required' });
  }
  const memberName = name || DEFAULT_ORGANIZER_NAME;

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
      [req.params.id, memberName, memberRole]
    );
    res.status(201).json(memberResult.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to join party' });
  }
});

// PATCH /api/parties/:id - Update party details (e.g. name)
router.patch('/:id', writeLimiter, async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Party name is required' });
  }
  try {
    const result = await pool.query(
      'UPDATE parties SET name = $1 WHERE id = $2 RETURNING id, name, join_code, is_active, created_at',
      [name.trim(), req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Party not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update party' });
  }
});

// PATCH /api/parties/:id/reactivate - Reactivate an ended party
router.patch('/:id/reactivate', async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE parties SET is_active = true WHERE id = $1 RETURNING id, name, join_code, is_active, created_at',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Party not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reactivate party' });
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

// DELETE /api/parties/:id/remove - Permanently delete a party and all its data
router.delete('/:id/remove', async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM parties WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Party not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to remove party' });
  }
});

// GET /api/parties/:id/members - List all members of a party
router.get('/:id/members', async (req, res) => {
  try {
    const partyResult = await pool.query('SELECT id FROM parties WHERE id = $1', [req.params.id]);
    if (partyResult.rows.length === 0) {
      return res.status(404).json({ error: 'Party not found' });
    }
    const result = await pool.query(
      'SELECT id, party_id, name, role, joined_at FROM party_members WHERE party_id = $1 ORDER BY joined_at ASC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch members' });
  }
});

// PATCH /api/parties/:id/members/:memberId - Update a party member
router.patch('/:id/members/:memberId', writeLimiter, async (req, res) => {
  const { name, role } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Member name is required' });
  }
  const memberRole = role === 'organizer' ? 'organizer' : 'guest';
  try {
    const result = await pool.query(
      'UPDATE party_members SET name = $1, role = $2 WHERE id = $3 AND party_id = $4 RETURNING id, party_id, name, role, joined_at',
      [name.trim(), memberRole, req.params.memberId, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Member not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update member' });
  }
});

// DELETE /api/parties/:id/members/:memberId - Remove a party member
router.delete('/:id/members/:memberId', writeLimiter, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM party_members WHERE id = $1 AND party_id = $2 RETURNING id',
      [req.params.memberId, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Member not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

module.exports = router;
