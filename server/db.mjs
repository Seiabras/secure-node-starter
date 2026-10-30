// The database: one SQLite file (node:sqlite, no dependency) in DATA_DIR, outside the code folder, so a new
// deploy never touches it. Every query in the project is a prepared statement with ? placeholders (ASVS 5.3.4).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      suspended INTEGER NOT NULL DEFAULT 0
    );
    -- Only the SHA-256 of each session token is stored: a copy of this file opens no session.
    CREATE TABLE IF NOT EXISTS sessions (
      hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    -- Pending sign-in codes, stored as an HMAC keyed with SECRET, never in clear.
    CREATE TABLE IF NOT EXISTS codes (
      email TEXT PRIMARY KEY,
      hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      sent_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sends (email TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS sends_email ON sends(email, at);
    -- Where people came from (?origin=): daily totals only, nothing links an origin to a person.
    CREATE TABLE IF NOT EXISTS origins (
      day TEXT NOT NULL,
      origin TEXT NOT NULL,
      visits INTEGER NOT NULL DEFAULT 0,
      signups INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, origin)
    );
  `);
  return db;
}
