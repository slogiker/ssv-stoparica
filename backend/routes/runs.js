const express = require('express');
const db = require('../db');

const router = express.Router();

// Filter → SQL WHERE clause fragment + cutoff timestamp
function filterClause(filter) {
  const periods = { dan: 86400, teden: 604800, mesec: 2592000, leto: 31536000 };
  if (periods[filter]) {
    return `AND datum >= datetime('now', '-${periods[filter]} seconds')`;
  }
  return '';
}

// Escape SQL LIKE special characters so user-supplied ekipa search is literal.
function escapeLike(s) {
  return s.replace(/[%_\\]/g, '\\$&');
}

// Prefix CSV cell values that start with formula-trigger characters (=+-@|) with
// a tab so spreadsheet apps don't evaluate them as formulas.
function csvSafe(value) {
  if (typeof value === 'string' && /^[=+\-@|]/.test(value)) {
    return '\t' + value;
  }
  return value;
}

// GET /api/runs
// Query: ?filter=dan|teden|mesec|leto  &disciplina=zimska|letna  &ekipa=...
router.get('/', (req, res) => {
  const { filter, disciplina, ekipa } = req.query;
  let sql = 'SELECT * FROM runs WHERE user_id = ?';
  const params = [req.user.id];

  if (filter) sql += ' ' + filterClause(filter);
  if (disciplina) { sql += ' AND disciplina = ?'; params.push(disciplina); }
  // Escape LIKE metacharacters so a search for e.g. "50%" isn't treated as a wildcard.
  if (ekipa)      { sql += ' AND ekipa LIKE ? ESCAPE \'\\\''; params.push('%' + escapeLike(ekipa) + '%'); }

  sql += ' ORDER BY datum DESC';

  try {
    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ napaka: 'Napaka pri pridobivanju rezultatov.' });
  }
});

// POST /api/runs
// Body: { ekipa, disciplina, cas_s }
router.post('/', (req, res) => {
  const { ekipa, disciplina, cas_s } = req.body;
  if (!cas_s || typeof cas_s !== 'number' || cas_s <= 0) {
    return res.status(400).json({ napaka: 'Neveljaven čas.' });
  }
  if (disciplina && !['zimska', 'letna'].includes(disciplina)) {
    return res.status(400).json({ napaka: 'Disciplina mora biti zimska ali letna.' });
  }
  if (ekipa && (typeof ekipa !== 'string' || ekipa.length > 50)) {
    return res.status(400).json({ napaka: 'Ime ekipe je predolgo (največ 50 znakov).' });
  }
  try {
    const result = db.prepare(
      'INSERT INTO runs (user_id, ekipa, disciplina, cas_s) VALUES (?, ?, ?, ?)'
    ).run(req.user.id, ekipa || null, disciplina || null, cas_s);
    const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(run);
  } catch (e) {
    res.status(500).json({ napaka: 'Napaka pri shranjevanju rezultata.' });
  }
});

// GET /api/runs/pr  — lowest cas_s for current user
// Must be defined before /:id if ever added
router.get('/pr', (req, res) => {
  try {
    const row = db.prepare(
      'SELECT * FROM runs WHERE user_id = ? ORDER BY cas_s ASC LIMIT 1'
    ).get(req.user.id);
    res.json(row || null);
  } catch (e) {
    res.status(500).json({ napaka: 'Napaka pri pridobivanju osebnega rekorda.' });
  }
});

// GET /api/runs/export  — CSV download
router.get('/export', (req, res) => {
  try {
    const rows = db.prepare(
      'SELECT id, ekipa, disciplina, cas_s, datum FROM runs WHERE user_id = ? ORDER BY datum DESC'
    ).all(req.user.id);

    const lines = ['id,ekipa,disciplina,cas_s,cas_format,datum'];
    for (const r of rows) {
      const total_s = Math.floor(r.cas_s);
      const cs = Math.round((r.cas_s % 1) * 100);
      const cas_format = String(Math.floor(total_s / 60)).padStart(2, '0') + ':' +
                         String(total_s % 60).padStart(2, '0') + '.' +
                         String(cs).padStart(2, '0');
      // Escape double-quotes for RFC 4180 CSV, then guard against formula injection
      // (values starting with = + - @ | could be executed by Excel/LibreOffice).
      const ekipa = csvSafe((r.ekipa || '').replace(/"/g, '""'));
      lines.push(`${r.id},"${ekipa}",${r.disciplina || ''},${r.cas_s},${cas_format},${r.datum}`);
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="ssv-rezultati.csv"');
    res.send(lines.join('\r\n'));
  } catch (e) {
    res.status(500).json({ napaka: 'Napaka pri izvozu.' });
  }
});

// DELETE /api/runs/:id
router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) return res.status(400).json({ napaka: 'Neveljaven ID.' });
  try {
    const run = db.prepare('SELECT id FROM runs WHERE id = ? AND user_id = ?').get(id, req.user.id);
    if (!run) return res.status(404).json({ napaka: 'Vnos ni najden.' });
    db.prepare('DELETE FROM runs WHERE id = ?').run(id);
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ napaka: 'Napaka pri brisanju.' });
  }
});

module.exports = router;
