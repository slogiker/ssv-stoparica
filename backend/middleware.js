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
    // Confirm user still exists and get latest role/data from database
    const user = db.prepare('SELECT id, ime, email, role FROM users WHERE id = ?').get(payload.id);
    if (!user) return res.status(401).json({ napaka: 'Seja je potekla. Prosimo, prijavite se znova.' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ napaka: 'Seja je potekla. Prosimo, prijavite se znova.' });
  }
}

function requireAdmin(req, res, next) {
  const checkAdmin = () => {
    if (req.user && req.user.role === 'admin') {
      return next();
    }
    return res.status(403).json({ napaka: 'Dostop zavrnjen. Niste administrator.' });
  };

  if (req.user) {
    checkAdmin();
  } else {
    requireAuth(req, res, checkAdmin);
  }
}

module.exports = { requireAuth, requireAdmin };
