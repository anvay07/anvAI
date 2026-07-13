"use strict";

const { Pool } = require("pg");

// Auth + persisted chat history are entirely optional: the app works
// anonymously (in-memory + client-side cache) with zero DB configured.
// DATABASE_URL presence is what turns this layer on — see server.js.
const DB_ENABLED = Boolean(process.env.DATABASE_URL);

const pool = DB_ENABLED
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === "false" ? false : { rejectUnauthorized: false },
    })
  : null;

async function initSchema() {
  if (!DB_ENABLED) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      google_sub  TEXT UNIQUE NOT NULL,
      email       TEXT UNIQUE NOT NULL,
      name        TEXT,
      picture     TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      token       TEXT PRIMARY KEY,
      user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at  TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id          TEXT PRIMARY KEY,
      user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title       TEXT NOT NULL DEFAULT 'New chat',
      preview     TEXT NOT NULL DEFAULT '',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id              BIGSERIAL PRIMARY KEY,
      chat_session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role            TEXT NOT NULL,
      content         TEXT NOT NULL,
      metadata        JSONB,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS counters (
      name  TEXT PRIMARY KEY,
      value BIGINT NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_chat_sessions_user   ON chat_sessions(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(chat_session_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry  ON auth_sessions(expires_at);
  `);

  // pgcrypto provides gen_random_uuid(); create it if missing (no-op if already present).
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`).catch(() => {
    // Some managed Postgres plans restrict extension creation — if gen_random_uuid()
    // is already available (e.g. Postgres 13+ has it built in) this is harmless.
  });
}

module.exports = { pool, DB_ENABLED, initSchema };
