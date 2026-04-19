'use strict';
/**
 * seed-demo.js — ensures a demo user exists with realistic run history.
 *
 * Called automatically on backend startup from index.js. Completely idempotent:
 * if the demo user already exists, returns immediately without touching the DB.
 *
 * Demo credentials:
 *   Email:    test@ssv.test
 *   Password: test1234
 */

const bcrypt = require('bcrypt');

// Random float in [min, max] rounded to 2 decimal places
function rnd(min, max) {
  return Math.round((min + Math.random() * (max - min)) * 100) / 100;
}

// ISO datetime string (UTC), daysAgo days back from now, at a realistic evening hour (17-20h UTC).
// Stored and compared in UTC throughout to avoid local-offset skew when
// re-parsing the string inside the transaction loop.
function rndDate(daysAgo) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(17 + Math.floor(Math.random() * 3), Math.floor(Math.random() * 60), 0, 0);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * seedDemo(db) — async, safe to call on every startup.
 * @param {import('better-sqlite3').Database} db
 */
async function seedDemo(db) {
  // Early-exit if demo user already exists
  const existing = db.prepare("SELECT id FROM users WHERE email = 'test@ssv.test'").get();
  if (existing) {
    console.log('Demo user present, skipping seed.');
    return;
  }

  const hash = await bcrypt.hash('test1234', 12);
  const { lastInsertRowid: userId } = db.prepare(
    "INSERT INTO users (ime, email, geslo_hash) VALUES ('test', 'test@ssv.test', ?)"
  ).run(hash);

  const insertRun = db.prepare(
    'INSERT INTO runs (user_id, ekipa, disciplina, cas_s, datum) VALUES (?, ?, ?, ?, ?)'
  );

  // ── Session definitions ─────────────────────────────────────────────────
  // Zimska: 5 sessions × 4-5 runs = 20-25 total, times clamped to 15-45s
  // Letna:  5 sessions × 4-5 runs = 20-25 total, times clamped to 35-70s
  // Both show realistic season-long improvement (early sessions hug upper end).
  const sessions = [
    // ── ZIMSKA ──────────────────────────────────────────────────────────
    { disc: 'zimska', ekipa: 'Člani-A', daysAgo: 180, runs: [
        rnd(38, 45), rnd(33, 45), rnd(30, 42), rnd(27, 40) ]},
    { disc: 'zimska', ekipa: 'Člani-A', daysAgo: 150, runs: [
        rnd(26, 38), rnd(23, 35), rnd(21, 32), rnd(20, 30), rnd(22, 33) ]},
    { disc: 'zimska', ekipa: 'Člani-A', daysAgo: 120, runs: [
        rnd(20, 30), rnd(18, 27), rnd(17, 26), rnd(16, 24), rnd(18, 27) ]},
    { disc: 'zimska', ekipa: 'Člani-A', daysAgo:  90, runs: [
        rnd(16, 24), rnd(15, 22), rnd(15, 21), rnd(16, 23) ]},
    { disc: 'zimska', ekipa: 'Člani-A', daysAgo:  60, runs: [
        rnd(15, 21), rnd(15, 20), rnd(15, 20), rnd(15, 22), rnd(16, 23) ]},

    // ── LETNA ───────────────────────────────────────────────────────────
    { disc: 'letna',  ekipa: 'Člani-A', daysAgo:  90, runs: [
        rnd(58, 70), rnd(52, 68), rnd(48, 64), rnd(45, 62) ]},
    { disc: 'letna',  ekipa: 'Člani-A', daysAgo:  70, runs: [
        rnd(46, 62), rnd(43, 58), rnd(41, 55), rnd(39, 53), rnd(41, 56) ]},
    { disc: 'letna',  ekipa: 'Člani-A', daysAgo:  50, runs: [
        rnd(40, 55), rnd(38, 52), rnd(36, 50), rnd(35, 48), rnd(37, 51) ]},
    { disc: 'letna',  ekipa: 'Člani-A', daysAgo:  28, runs: [
        rnd(36, 50), rnd(35, 47), rnd(35, 46), rnd(36, 48) ]},
    { disc: 'letna',  ekipa: 'Člani-A', daysAgo:  10, runs: [
        rnd(35, 45), rnd(35, 44), rnd(35, 44), rnd(35, 46), rnd(36, 47) ]},
  ];

  // Insert all sessions in a single transaction
  let total = 0;
  db.transaction((sessions) => {
    for (const s of sessions) {
      const baseDate = rndDate(s.daysAgo);
      for (let i = 0; i < s.runs.length; i++) {
        // Space runs ~3-8 minutes apart within a session.
        // baseDate is already a UTC string, so append 'Z' without replace().
        const d = new Date(baseDate.replace(' ', 'T') + 'Z');
        d.setUTCMinutes(d.getUTCMinutes() + i * (3 + Math.floor(Math.random() * 5)));
        const datum = d.toISOString().replace('T', ' ').slice(0, 19);
        insertRun.run(userId, s.ekipa, s.disc, s.runs[i], datum);
        total++;
      }
    }
  })(sessions);

  const zimska = sessions.filter(s => s.disc === 'zimska').reduce((n, s) => n + s.runs.length, 0);
  const letna  = sessions.filter(s => s.disc === 'letna' ).reduce((n, s) => n + s.runs.length, 0);

  console.log(`[seed-demo] Created demo user (id=${userId}, login: test@ssv.test / test1234, ${total} runs: ${zimska} zimska, ${letna} letna).`);
}

module.exports = { seedDemo };
