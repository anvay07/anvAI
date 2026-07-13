"use strict";

const { pool, DB_ENABLED } = require("./db");

function deriveTitle(text) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "New chat";
  if (clean.length <= 42) return clean;
  const truncated = clean.slice(0, 42);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated) + "…";
}

async function createChatSession(id, userId) {
  if (!DB_ENABLED) return;
  await pool.query(
    `INSERT INTO chat_sessions (id, user_id) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
    [id, userId]
  );
}

// Ownership check — the only thing standing between one account and another
// account's chat content. Always gate reads/writes/deletes through this.
async function isOwnedSession(chatSessionId, userId) {
  if (!DB_ENABLED) return false;
  const { rows } = await pool.query(
    `SELECT 1 FROM chat_sessions WHERE id = $1 AND user_id = $2`,
    [chatSessionId, userId]
  );
  return rows.length > 0;
}

async function appendMessage(chatSessionId, role, content, metadata) {
  if (!DB_ENABLED) return;
  await pool.query(
    `INSERT INTO chat_messages (chat_session_id, role, content, metadata) VALUES ($1, $2, $3, $4)`,
    [chatSessionId, role, content, metadata ? JSON.stringify(metadata) : null]
  );

  const preview = deriveTitle(content);
  const isUser = role === "user";
  await pool.query(
    `UPDATE chat_sessions
     SET updated_at = now(),
         preview = $2,
         title = CASE WHEN $3 AND title = 'New chat' THEN $2 ELSE title END
     WHERE id = $1`,
    [chatSessionId, preview, isUser]
  );
}

async function listChatSessions(userId) {
  if (!DB_ENABLED) return [];
  const { rows } = await pool.query(
    `SELECT id, title, preview, created_at, updated_at
     FROM chat_sessions WHERE user_id = $1 ORDER BY updated_at DESC`,
    [userId]
  );
  return rows;
}

// Returns null if the session doesn't exist or isn't owned by userId —
// callers must treat both cases identically (404), never leak which one it was.
async function getChatMessages(chatSessionId, userId) {
  if (!DB_ENABLED) return null;
  const owned = await isOwnedSession(chatSessionId, userId);
  if (!owned) return null;
  const { rows } = await pool.query(
    `SELECT role, content, metadata, created_at
     FROM chat_messages WHERE chat_session_id = $1 ORDER BY created_at ASC`,
    [chatSessionId]
  );
  return rows;
}

async function deleteChatSession(chatSessionId, userId) {
  if (!DB_ENABLED) return false;
  const { rowCount } = await pool.query(
    `DELETE FROM chat_sessions WHERE id = $1 AND user_id = $2`,
    [chatSessionId, userId]
  );
  return rowCount > 0;
}

module.exports = {
  createChatSession,
  isOwnedSession,
  appendMessage,
  listChatSessions,
  getChatMessages,
  deleteChatSession,
};
