const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../middleware');

const router = express.Router();

// GET /api/admin/users
router.get('/users', requireAdmin, (req, res) => {
  try {
    const users = db.prepare(`
      SELECT u.id, u.ime, u.email, u.created_at, COUNT(r.id) AS runs_count
      FROM users u
      LEFT JOIN runs r ON u.id = r.user_id
      GROUP BY u.id, u.ime, u.email, u.created_at
      ORDER BY u.created_at DESC
    `).all();

    const devices = db.prepare(`
      SELECT user_id, friendly_name, svc_uuid, char_uuid
      FROM devices
    `).all();

    const devicesByUser = {};
    for (const d of devices) {
      if (!devicesByUser[d.user_id]) devicesByUser[d.user_id] = [];
      devicesByUser[d.user_id].push({
        friendly_name: d.friendly_name,
        svc_uuid: d.svc_uuid,
        char_uuid: d.char_uuid
      });
    }

    const parsedUsers = users.map(u => ({
      ...u,
      devices: devicesByUser[u.id] || []
    }));

    res.json(parsedUsers);
  } catch (e) {
    console.error('Error in GET /api/admin/users:', e);
    res.status(500).json({ napaka: 'Napaka pri pridobivanju uporabnikov: ' + e.message });
  }
});

// POST /api/admin/users/:id/role
router.post('/users/:id/role', requireAdmin, (req, res) => {
  const userId = req.params.id;
  const { role } = req.body;
  if (!['admin', 'user'].includes(role)) {
    return res.status(400).json({ napaka: 'Neveljavna vloga.' });
  }
  try {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ napaka: 'Napaka pri spreminjanju vloge.' });
  }
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', requireAdmin, (req, res) => {
  const userId = req.params.id;
  try {
    db.transaction(() => {
      db.prepare('DELETE FROM runs WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM devices WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    })();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ napaka: 'Napaka pri brisanju uporabnika.' });
  }
});

// GET /api/admin/users/:id/runs
router.get('/users/:id/runs', requireAdmin, (req, res) => {
  const userId = req.params.id;
  try {
    const runs = db.prepare('SELECT * FROM runs WHERE user_id = ? ORDER BY datum DESC').all(userId);
    res.json(runs);
  } catch (e) {
    res.status(500).json({ napaka: 'Napaka pri pridobivanju tekov.' });
  }
});

// DELETE /api/admin/runs/:id
router.delete('/runs/:id', requireAdmin, (req, res) => {
  const runId = req.params.id;
  try {
    db.prepare('DELETE FROM runs WHERE id = ?').run(runId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ napaka: 'Napaka pri brisanju teka.' });
  }
});

module.exports = router;
