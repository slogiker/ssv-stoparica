const jwt = require('jsonwebtoken');
const db  = require('./db');

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ napaka: 'Prijava je potrebna.' });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // Confirm user still exists (handles deleted accounts)
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(payload.id);
    if (!user) return res.status(401).json({ napaka: 'Seja je potekla. Prosimo, prijavite se znova.' });
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ napaka: 'Seja je potekla. Prosimo, prijavite se znova.' });
  }
}

module.exports = { requireAuth };
