const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'stoparica.db');

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Run migrations — idempotent, safe to call on every startup
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ime         TEXT NOT NULL,
    email       TEXT UNIQUE NOT NULL,
    geslo_hash  TEXT NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS runs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER REFERENCES users(id),
    ekipa       VARCHAR(50),
    disciplina  TEXT CHECK(disciplina IN ('zimska', 'letna')),
    cas_s       REAL NOT NULL,
    datum       DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS devices (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER REFERENCES users(id),
    uuid          TEXT NOT NULL,
    friendly_name TEXT,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

module.exports = db;
