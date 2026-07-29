// db.js — real persistence layer using the `sqlite3` npm package (stable,
// pure-C++-addon-with-prebuilt-binaries driver — NOT the experimental
// node:sqlite built-in). sqlite3's API is callback-based, so this module
// wraps it in a small Promise layer and exposes the same `run`/`get`/`all`
// shape the rest of the app already uses — the only difference from before
// is that these functions now return Promises, so every call site awaits
// them. Swapping this file for a Prisma+Postgres client later is still a
// drop-in replacement — the exported surface (run, get, all) is
// intentionally ORM-shaped.

import sqlite3pkg from 'sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Verbose mode gives useful stack traces on SQL errors in dev; harmless in
// production.
const sqlite3 = sqlite3pkg.verbose();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'data', 'ilovemeow.db');

// SQLite can create the .db file itself, but it cannot create missing
// parent directories — on a fresh clone, a fresh Railway deploy, or a fresh
// volume mount in Docker, the data/ folder may not exist yet, which fails
// with "unable to open database file". Create it up front if needed. This
// never assumes the project root itself is writable — only this one
// existing data directory, which is all persistence needs.
const DB_DIR = path.dirname(DB_PATH);
try {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
} catch (err) {
  throw new Error(
    `Could not create database directory at ${DB_DIR}: ${err.message}. ` +
    `Make sure the process has write access to this path.`
  );
}

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    throw new Error(`Unable to open database file at ${DB_PATH}: ${err.message}`);
  }
});
db.exec('PRAGMA foreign_keys = ON;');

const SCHEMA_SQL = `
-- Note: CREATE TABLE IF NOT EXISTS only applies to brand-new databases.
-- If you already have a deployed ilovemeow.db with an older meowments schema,
-- you'll need a real migration (ALTER TABLE ... ADD COLUMN) to pick up the
-- parent_id/pinned/edited_at/deleted/gif_url columns below — this file won't
-- retrofit an existing table for you.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  bio TEXT DEFAULT '',
  avatar_emoji TEXT DEFAULT '🐱',
  avatar_url TEXT DEFAULT '',
  cover_url TEXT DEFAULT '',
  fish_coins INTEGER DEFAULT 20,
  meowment_points INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cats (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  breed TEXT DEFAULT '',
  gender TEXT DEFAULT '',
  birthday TEXT DEFAULT '',
  color TEXT DEFAULT '',
  favorite_food TEXT DEFAULT '',
  favorite_toy TEXT DEFAULT '',
  mood TEXT DEFAULT 'Content',
  bio TEXT DEFAULT '',
  avatar_emoji TEXT DEFAULT '🐾',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS meows (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cat_id TEXT REFERENCES cats(id) ON DELETE SET NULL,
  caption TEXT DEFAULT '',
  image_url TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purrs (
  meow_id TEXT NOT NULL REFERENCES meows(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (meow_id, user_id)
);

-- Superseded by the reactions table below (one typed reaction per user per
-- Meow, switchable between 8 cat-themed types). The purrs table above is
-- kept only so older data isn't silently dropped; no route reads or writes
-- to it anymore.
CREATE TABLE IF NOT EXISTS reactions (
  meow_id TEXT NOT NULL REFERENCES meows(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (meow_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_reactions_meow ON reactions(meow_id);

CREATE TABLE IF NOT EXISTS meowments (
  id TEXT PRIMARY KEY,
  meow_id TEXT NOT NULL REFERENCES meows(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES meowments(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  gif_url TEXT DEFAULT '',
  pinned INTEGER DEFAULT 0,
  edited_at TEXT DEFAULT NULL,
  deleted INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS follows (
  follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (follower_id, followee_id)
);

CREATE TABLE IF NOT EXISTS search_logs (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_search_logs_query ON search_logs(query);
CREATE INDEX IF NOT EXISTS idx_search_logs_created ON search_logs(created_at);
CREATE TABLE IF NOT EXISTS game_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  started_at TEXT DEFAULT (datetime('now')),
  used INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS game_scores (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  score INTEGER NOT NULL,
  max_combo INTEGER DEFAULT 0,
  duration_ms INTEGER NOT NULL,
  coins_earned INTEGER DEFAULT 0,
  xp_earned INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_game_scores_lookup ON game_scores(game, created_at);
CREATE INDEX IF NOT EXISTS idx_game_scores_user ON game_scores(user_id, game);

CREATE TABLE IF NOT EXISTS user_achievements (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_key TEXT NOT NULL,
  unlocked_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, achievement_key)
);

CREATE TABLE IF NOT EXISTS daily_challenge_completions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge_date TEXT NOT NULL,
  game TEXT NOT NULL,
  completed_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, challenge_date)
);
`;

// ---- Promise wrappers around sqlite3's callback API ----
// These are the only primitives the rest of the file (and the rest of the
// app) uses, so every other piece of setup below goes through them too.

function execAsync(sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => (err ? reject(err) : resolve()));
  });
}

function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function callback(err) {
      if (err) return reject(err);
      // Mirror node:sqlite's StatementResultingChanges shape so every
      // existing caller (which only ever reads plain fields off the
      // result, if at all) keeps working unchanged.
      resolve({ lastInsertRowid: this.lastID, changes: this.changes });
    });
  });
}

function getAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

// ---- Schema setup (runs once at import time, awaited before any query
// executes — see the `ready` promise below) ----

async function initSchema() {
  await execAsync(SCHEMA_SQL);

  // Lightweight self-healing migration: CREATE TABLE IF NOT EXISTS above
  // only applies to brand-new databases (see note above), so an
  // already-deployed ilovemeow.db needs its new avatar_url/cover_url
  // columns added explicitly. ALTER TABLE ADD COLUMN is safe to attempt
  // unconditionally here — SQLite has no "ADD COLUMN IF NOT EXISTS", so we
  // just swallow the "duplicate column" error on databases that already
  // have it.
  for (const stmt of [
    `ALTER TABLE users ADD COLUMN avatar_url TEXT DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN cover_url TEXT DEFAULT ''`,
  ]) {
    try {
      await execAsync(stmt);
    } catch (err) {
      if (!/duplicate column/i.test(err.message)) throw err;
    }
  }
}

// Every exported function awaits this first, so callers never race the
// schema/migration step above — including the very first request handled
// right after the process starts.
export const ready = initSchema();

export async function run(sql, params = []) {
  await ready;
  return runAsync(sql, params);
}

export async function get(sql, params = []) {
  await ready;
  return getAsync(sql, params);
}

export async function all(sql, params = []) {
  await ready;
  return allAsync(sql, params);
}

export default db;
