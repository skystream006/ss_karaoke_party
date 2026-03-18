const express = require('express');
const router = express.Router();
const pool = require('../db/db');
const { writeLimiter } = require('../middleware/rateLimiter');
const { requireAdmin } = require('../middleware/auth');

// Order all songs by position so completed songs remain in their original place
const QUEUE_ORDER_BY = `position ASC`;

// GET /api/queue/:partyId - Get the queue for a party
router.get('/:partyId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT q.id, q.party_id, q.member_id, q.singer_name, q.video_id,
              q.video_title, q.video_thumbnail, q.position, q.status, q.added_at
       FROM queue q
       WHERE q.party_id = $1
       ORDER BY ${QUEUE_ORDER_BY}`,
      [req.params.partyId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch queue' });
  }
});

// POST /api/queue/:partyId - Add a song to the queue
router.post('/:partyId', writeLimiter, async (req, res) => {
  const { member_id, singer_name, video_id, video_title, video_thumbnail } = req.body;
  if (!singer_name || !video_id || !video_title) {
    return res.status(400).json({ error: 'singer_name, video_id, and video_title are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const partyResult = await client.query(
      'SELECT is_locked FROM parties WHERE id = $1',
      [req.params.partyId]
    );
    if (partyResult.rows[0]?.is_locked) {
      await client.query('ROLLBACK');
      return res.status(423).json({ error: 'Party is locked. Queue edits are not allowed.' });
    }

    // Get next position
    const posResult = await client.query(
      `SELECT COALESCE(MAX(position), 0) + 1 AS next_pos
       FROM queue WHERE party_id = $1`,
      [req.params.partyId]
    );
    const position = posResult.rows[0].next_pos;

    const result = await client.query(
      `INSERT INTO queue (party_id, member_id, singer_name, video_id, video_title, video_thumbnail, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.params.partyId, member_id || null, singer_name, video_id, video_title, video_thumbnail || null, position]
    );

    await client.query('COMMIT');

    const newItem = result.rows[0];
    // Emit socket event with full updated queue so all clients refresh their list
    const io = req.app.get('io');
    if (io) {
      const updatedQueue = await pool.query(
        `SELECT * FROM queue WHERE party_id = $1
         ORDER BY ${QUEUE_ORDER_BY}`,
        [req.params.partyId]
      );
      io.to(req.params.partyId).emit('queue:update', { action: 'add', queue: updatedQueue.rows });
    }

    res.status(201).json(newItem);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to add song to queue' });
  } finally {
    client.release();
  }
});

// POST /api/queue/:partyId/play-next - Add a song to play right after the current song
router.post('/:partyId/play-next', writeLimiter, async (req, res) => {
  const { member_id, singer_name, video_id, video_title, video_thumbnail } = req.body;
  if (!singer_name || !video_id || !video_title) {
    return res.status(400).json({ error: 'singer_name, video_id, and video_title are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const partyResult = await client.query(
      'SELECT is_locked FROM parties WHERE id = $1',
      [req.params.partyId]
    );
    if (partyResult.rows[0]?.is_locked) {
      await client.query('ROLLBACK');
      return res.status(423).json({ error: 'Party is locked. Queue edits are not allowed.' });
    }

    // Find the insertion point:
    //   1. Right after the currently playing/paused song (if any)
    //   2. Right before the first queued song (if no active song)
    //   3. After the last song in the queue (if no queued songs remain)
    const anchorResult = await client.query(
      `SELECT COALESCE(
         (SELECT MAX(position) FROM queue WHERE party_id = $1 AND status IN ('playing', 'paused')),
         (SELECT MIN(position) - 1 FROM queue WHERE party_id = $1 AND status = 'queued'),
         (SELECT MAX(position) FROM queue WHERE party_id = $1),
         0
       ) AS anchor_pos`,
      [req.params.partyId]
    );
    const insertPosition = parseInt(anchorResult.rows[0].anchor_pos, 10) + 1;

    // Shift all songs (regardless of status) at or after insertPosition down by one
    // to avoid position conflicts with played songs that may sit at unexpected positions
    await client.query(
      `UPDATE queue SET position = position + 1
       WHERE party_id = $1 AND position >= $2`,
      [req.params.partyId, insertPosition]
    );

    const result = await client.query(
      `INSERT INTO queue (party_id, member_id, singer_name, video_id, video_title, video_thumbnail, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.params.partyId, member_id || null, singer_name, video_id, video_title, video_thumbnail || null, insertPosition]
    );

    await client.query('COMMIT');

    const io = req.app.get('io');
    if (io) {
      const updatedQueue = await pool.query(
        `SELECT * FROM queue WHERE party_id = $1 ORDER BY ${QUEUE_ORDER_BY}`,
        [req.params.partyId]
      );
      io.to(req.params.partyId).emit('queue:update', { action: 'add', queue: updatedQueue.rows });
    }

    res.status(201).json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to add song to queue' });
  } finally {
    client.release();
  }
});

// DELETE /api/queue/:partyId/:itemId - Remove a song from the queue
router.delete('/:partyId/:itemId', writeLimiter, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const partyResult = await client.query(
      'SELECT is_locked FROM parties WHERE id = $1',
      [req.params.partyId]
    );
    if (partyResult.rows[0]?.is_locked) {
      await client.query('ROLLBACK');
      return res.status(423).json({ error: 'Party is locked. Queue edits are not allowed.' });
    }

    const deleted = await client.query(
      'DELETE FROM queue WHERE id = $1 AND party_id = $2 RETURNING *',
      [req.params.itemId, req.params.partyId]
    );

    if (deleted.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Queue item not found' });
    }

    // Renumber positions for all remaining songs
    await client.query(
      `WITH ordered AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY position ASC) AS new_pos
        FROM queue
        WHERE party_id = $1
      )
      UPDATE queue SET position = ordered.new_pos
      FROM ordered WHERE queue.id = ordered.id`,
      [req.params.partyId]
    );

    await client.query('COMMIT');

    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      // Fetch updated queue
      const updatedQueue = await pool.query(
        `SELECT * FROM queue WHERE party_id = $1
         ORDER BY ${QUEUE_ORDER_BY}`,
        [req.params.partyId]
      );
      io.to(req.params.partyId).emit('queue:update', { action: 'remove', queue: updatedQueue.rows });
    }

    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to remove song from queue' });
  } finally {
    client.release();
  }
});

// PUT /api/queue/:partyId/reorder - Reorder the queue
router.put('/:partyId/reorder', writeLimiter, async (req, res) => {
  const { order } = req.body; // Array of { id, position }
  if (!Array.isArray(order)) {
    return res.status(400).json({ error: 'order must be an array' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const partyResult = await client.query(
      'SELECT is_locked FROM parties WHERE id = $1',
      [req.params.partyId]
    );
    if (partyResult.rows[0]?.is_locked) {
      await client.query('ROLLBACK');
      return res.status(423).json({ error: 'Party is locked. Queue edits are not allowed.' });
    }

    for (const item of order) {
      await client.query(
        'UPDATE queue SET position = $1 WHERE id = $2 AND party_id = $3',
        [item.position, item.id, req.params.partyId]
      );
    }

    await client.query('COMMIT');

    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      const updatedQueue = await pool.query(
        `SELECT * FROM queue WHERE party_id = $1
         ORDER BY ${QUEUE_ORDER_BY}`,
        [req.params.partyId]
      );
      io.to(req.params.partyId).emit('queue:update', { action: 'reorder', queue: updatedQueue.rows });
    }

    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to reorder queue' });
  } finally {
    client.release();
  }
});

// PATCH /api/queue/:partyId/reset - Reset all non-playing songs back to queued status
router.patch('/:partyId/reset', writeLimiter, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Reset all songs that are not currently playing back to queued
    await client.query(
      `UPDATE queue SET status = 'queued' WHERE party_id = $1 AND status != 'playing'`,
      [req.params.partyId]
    );

    await client.query('COMMIT');

    const io = req.app.get('io');
    if (io) {
      const updatedQueue = await pool.query(
        `SELECT * FROM queue WHERE party_id = $1
         ORDER BY ${QUEUE_ORDER_BY}`,
        [req.params.partyId]
      );
      io.to(req.params.partyId).emit('queue:update', { action: 'status', queue: updatedQueue.rows });
    }

    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to reset queue' });
  } finally {
    client.release();
  }
});

// PATCH /api/queue/:partyId/:itemId/status - Update item status (e.g., mark as playing/queued)
router.patch('/:partyId/:itemId/status', writeLimiter, async (req, res) => {
  const { status } = req.body;
  if (!['queued', 'playing', 'played', 'paused'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // If setting to playing, mark all other currently-playing or paused songs as played
    // so they don't re-appear at the front of the queue on the next skip
    if (status === 'playing') {
      await client.query(
        `UPDATE queue SET status = 'played' WHERE party_id = $1 AND id != $2 AND status IN ('playing', 'paused')`,
        [req.params.partyId, req.params.itemId]
      );
    }

    const result = await client.query(
      'UPDATE queue SET status = $1 WHERE id = $2 AND party_id = $3 RETURNING *',
      [status, req.params.itemId, req.params.partyId]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Queue item not found' });
    }

    await client.query('COMMIT');

    const io = req.app.get('io');
    if (io) {
      const updatedQueue = await pool.query(
        `SELECT * FROM queue WHERE party_id = $1
         ORDER BY ${QUEUE_ORDER_BY}`,
        [req.params.partyId]
      );
      io.to(req.params.partyId).emit('queue:update', { action: 'status', queue: updatedQueue.rows });
    }

    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to update status' });
  } finally {
    client.release();
  }
});

// PATCH /api/queue/:partyId/:itemId - Update the singer of a queue item (admin only)
router.patch('/:partyId/:itemId', requireAdmin, writeLimiter, async (req, res) => {
  const { singer_name, member_id } = req.body;
  if (typeof singer_name !== 'string' || !singer_name.trim()) {
    return res.status(400).json({ error: 'singer_name is required' });
  }

  try {
    const result = await pool.query(
      'UPDATE queue SET singer_name = $1, member_id = $2 WHERE id = $3 AND party_id = $4 RETURNING *',
      [singer_name.trim(), member_id || null, req.params.itemId, req.params.partyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Queue item not found' });
    }

    const io = req.app.get('io');
    if (io) {
      const updatedQueue = await pool.query(
        `SELECT * FROM queue WHERE party_id = $1 ORDER BY ${QUEUE_ORDER_BY}`,
        [req.params.partyId]
      );
      io.to(req.params.partyId).emit('queue:update', { action: 'update', queue: updatedQueue.rows });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update singer' });
  }
});

module.exports = router;
