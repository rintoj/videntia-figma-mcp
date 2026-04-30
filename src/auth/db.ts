import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

const DB_PATH = process.env.DB_PATH ?? join(process.cwd(), 'data', 'auth.db')

// Ensure the directory exists
mkdirSync(dirname(DB_PATH), { recursive: true })

export const db = new Database(DB_PATH, { create: true })
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           TEXT PRIMARY KEY,
    email        TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    verified     INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS verification_tokens (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token      TEXT UNIQUE NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    key_hash     TEXT UNIQUE NOT NULL,
    key_prefix   TEXT NOT NULL,
    created_at   INTEGER NOT NULL,
    last_used_at INTEGER,
    revoked      INTEGER NOT NULL DEFAULT 0
  );
`)
