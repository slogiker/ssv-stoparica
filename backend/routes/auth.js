const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { requireAuth } = require('../middleware');

const router = express.Router();
const SALT_ROUNDS = 12;
const TOKEN_TTL = '7d';

// POST /api/auth/register
// Body: { ime, email, geslo }
router.post('/register', async (req, res) => {
  const { ime, email, geslo } = req.body;
  if (!ime || !email || !geslo) {
    return res.status(400).json({ napaka: 'Ime, e-pošta in geslo so obvezni.' });
  }
  if (geslo.length < 8) {
    return res.status(400).json({ napaka: 'Geslo mora imeti vsaj 8 znakov.' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    return res.status(409).json({ napaka: 'Ta e-poštni naslov je že registriran.' });
  }
  try {
    const geslo_hash = await bcrypt.hash(geslo, SALT_ROUNDS);
    const result = db.prepare('INSERT INTO users (ime, email, geslo_hash) VALUES (?, ?, ?)').run(ime, email, geslo_hash);
    const token = jwt.sign({ id: result.lastInsertRowid, ime, email }, process.env.JWT_SECRET, { expiresIn: TOKEN_TTL });
    res.status(201).json({ token, ime });
  } catch (e) {
    res.status(500).json({ napaka: 'Napaka pri registraciji. Prosimo, poskusite znova.' });
  }
});

// POST /api/auth/login
// Body: { login (ime or email), geslo }
router.post('/login', async (req, res) => {
  const { login, geslo } = req.body;
  if (!login || !geslo) {
    return res.status(400).json({ napaka: 'Prijava in geslo sta obvezna.' });
  }
  const user = db.prepare('SELECT * FROM users WHERE email = ? OR ime = ?').get(login, login);
  if (!user) {
    return res.status(401).json({ napaka: 'Napačna prijava ali geslo.' });
  }
  try {
    const match = await bcrypt.compare(geslo, user.geslo_hash);
    if (!match) {
      return res.status(401).json({ napaka: 'Napačna prijava ali geslo.' });
    }
    const token = jwt.sign({ id: user.id, ime: user.ime, email: user.email }, process.env.JWT_SECRET, { expiresIn: TOKEN_TTL });
    res.json({ token, ime: user.ime });
  } catch (e) {
    res.status(500).json({ napaka: 'Napaka pri prijavi. Prosimo, poskusite znova.' });
  }
});

// PUT /api/auth/profile  — update display name
router.put('/profile', requireAuth, async (req, res) => {
  const { ime } = req.body;
  if (!ime || !ime.trim()) return res.status(400).json({ napaka: 'Ime ne sme biti prazno.' });
  try {
    db.prepare('UPDATE users SET ime = ? WHERE id = ?').run(ime.trim(), req.user.id);
    const token = jwt.sign({ id: req.user.id, ime: ime.trim(), email: req.user.email }, process.env.JWT_SECRET, { expiresIn: TOKEN_TTL });
    res.json({ token, ime: ime.trim() });
  } catch (e) {
    res.status(500).json({ napaka: 'Napaka pri posodabljanju profila.' });
  }
});

// PUT /api/auth/password  — change password
router.put('/password', requireAuth, async (req, res) => {
  const { trenutno, novo } = req.body;
  if (!trenutno || !novo) return res.status(400).json({ napaka: 'Obe gesli sta obvezni.' });
  if (novo.length < 8) return res.status(400).json({ napaka: 'Novo geslo mora imeti vsaj 8 znakov.' });
  try {
    const user = db.prepare('SELECT geslo_hash FROM users WHERE id = ?').get(req.user.id);
    const match = await bcrypt.compare(trenutno, user.geslo_hash);
    if (!match) return res.status(401).json({ napaka: 'Trenutno geslo ni pravilno.' });
    const geslo_hash = await bcrypt.hash(novo, SALT_ROUNDS);
    db.prepare('UPDATE users SET geslo_hash = ? WHERE id = ?').run(geslo_hash, req.user.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ napaka: 'Napaka pri spremembi gesla.' });
  }
});

// DELETE /api/auth/account  — delete account and all data
router.delete('/account', requireAuth, (req, res) => {
  try {
    db.prepare('DELETE FROM runs    WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM devices WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM users   WHERE id = ?').run(req.user.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ napaka: 'Napaka pri brisanju računa.' });
  }
});

module.exports = router;
