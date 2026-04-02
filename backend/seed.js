// Run once to populate DB with test user + random runs
// Usage: node seed.js
require('dotenv').config();
const bcrypt = require('bcrypt');
const db = require('./db');

async function seed() {
  // ── Test user ──
  const existing = db.prepare("SELECT id FROM users WHERE email = 'test@test.com'").get();
  if (existing) {
    db.prepare("DELETE FROM runs WHERE user_id = ?").run(existing.id);
    db.prepare("DELETE FROM devices WHERE user_id = ?").run(existing.id);
    db.prepare("DELETE FROM users WHERE id = ?").run(existing.id);
    console.log('Removed existing test user.');
  }

  const hash = await bcrypt.hash('test', 12);
  const { lastInsertRowid: userId } = db.prepare(
    "INSERT INTO users (ime, email, geslo_hash) VALUES ('test', 'test@test.com', ?)"
  ).run(hash);
  console.log(`Created user: test / test  (id=${userId})`);

  // ── Random runs ──
  const ekipe = ['Člani-A', 'Člani-B'];
  const discs = ['zimska', 'letna'];
  const now   = Date.now();
  const insert = db.prepare(
    "INSERT INTO runs (user_id, ekipa, disciplina, cas_s, datum) VALUES (?, ?, ?, ?, ?)"
  );

  // 40 runs spread over the last 3 months, slight improvement trend
  for (let i = 0; i < 40; i++) {
    const daysAgo  = Math.floor(Math.random() * 90);
    const datum    = new Date(now - daysAgo * 86400000).toISOString();
    // Base time 35s, slight improvement over time (newer runs slightly faster), ±5s noise
    const base_ms  = 35000 - (i / 40) * 8000 + (Math.random() - 0.5) * 10000;
    const cas_s    = parseFloat((Math.max(18, base_ms / 1000)).toFixed(3));
    const ekipa    = ekipe[Math.floor(Math.random() * ekipe.length)];
    const disc     = discs[Math.floor(Math.random() * 2)];
    insert.run(userId, ekipa, disc, cas_s, datum);
  }
  console.log('Inserted 40 runs (18s–45s range, slight improvement trend).');
  console.log('\nLogin with:  ime/email = test   geslo = test');
}

seed().catch(err => { console.error(err); process.exit(1); });
