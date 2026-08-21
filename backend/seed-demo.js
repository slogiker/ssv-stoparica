'use strict';
const bcrypt = require('bcrypt');

async function seedDemo(db) {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@ssv.test';
  const testEmail  = process.env.TEST_EMAIL  || 'test@ssv.test';
  const adminPass  = process.env.ADMIN_PASSWORD || 'admin-password';
  const testPass   = process.env.TEST_PASSWORD  || 'test1234';

  // Only insert Admin if they don't exist
  const admin = db.prepare("SELECT id FROM users WHERE email = ?").get(adminEmail);
  if (!admin) {
    const adminHash = await bcrypt.hash(adminPass, 12);
    db.prepare("INSERT INTO users (ime, email, geslo_hash, role) VALUES ('admin', ?, ?, 'admin')").run(adminEmail, adminHash);
    console.log('[seed-demo] Created admin user.');
  } else {
    // Ensure admin role is set
    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(admin.id);
  }

  // Only insert Test if they don't exist
  const test = db.prepare("SELECT id FROM users WHERE email = ?").get(testEmail);
  if (!test) {
    const testHash = await bcrypt.hash(testPass, 12);
    const { lastInsertRowid: userId } = db.prepare(
      "INSERT INTO users (ime, email, geslo_hash) VALUES ('test', ?, ?)"
    ).run(testEmail, testHash);
    console.log('[seed-demo] Created test user.');
  }
}

module.exports = { seedDemo };
