const express = require('express');
const db = require('../db');

const router = express.Router();

// POST /api/devices
// Body: { uuid, friendly_name }
router.post('/', (req, res) => {
  const { uuid, friendly_name } = req.body;
  if (!uuid) {
    return res.status(400).json({ napaka: 'UUID naprave je obvezen.' });
  }
  // Prevent duplicates per user
  const existing = db.prepare(
    'SELECT id FROM devices WHERE user_id = ? AND uuid = ?'
  ).get(req.user.id, uuid);
  if (existing) {
    return res.status(409).json({ napaka: 'Ta naprava je že shranjena.' });
  }
  try {
    const result = db.prepare(
      'INSERT INTO devices (user_id, uuid, friendly_name) VALUES (?, ?, ?)'
    ).run(req.user.id, uuid, friendly_name || null);
    const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(device);
  } catch (e) {
    res.status(500).json({ napaka: 'Napaka pri shranjevanju naprave.' });
  }
});

// GET /api/devices  — list saved devices for current user
router.get('/', (req, res) => {
  try {
    const rows = db.prepare(
      'SELECT * FROM devices WHERE user_id = ? ORDER BY created_at DESC'
    ).all(req.user.id);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ napaka: 'Napaka pri pridobivanju naprav.' });
  }
});

// DELETE /api/devices/:id  — forget device (must belong to current user)
router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ napaka: 'Neveljaven ID naprave.' });

  const device = db.prepare('SELECT id FROM devices WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!device) {
    return res.status(404).json({ napaka: 'Naprava ni najdena.' });
  }
  try {
    db.prepare('DELETE FROM devices WHERE id = ?').run(id);
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ napaka: 'Napaka pri brisanju naprave.' });
  }
});

module.exports = router;
