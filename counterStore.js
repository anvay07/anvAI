"use strict";

const { pool, DB_ENABLED } = require("./db");

// Global "I love you" tally. Persisted in Postgres when available; falls back
// to an in-memory count otherwise (resets on restart, but the feature still
// works without a database so anonymous-only deployments aren't broken).
const LOVE = "love_count";
let memoryCount = 0;

// Matches heartfelt expressions of love directed at anvAI — "i love you",
// "ily", "i luv u", "love you so much", "i love this", etc. Kept deliberately
// forgiving of spacing/punctuation but anchored so it doesn't fire on
// "i love pizza" or "i'd love to".
const LOVE_RE =
  /\b(i\s*(really\s*|so\s*)?(love|luv|❤️?|luvv+)\s*(you|u|ya|this|anvai|it)|ily+|i\s*love\s*you|love\s*(you|u|ya)\s*(so\s*much|lots|too)?)\b/i;

function isLoveMessage(text) {
  if (typeof text !== "string") return false;
  // Normalise curly apostrophes and collapse repeated whitespace
  const normalized = text.replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
  return LOVE_RE.test(normalized);
}

async function incrementLove() {
  if (!DB_ENABLED) {
    return ++memoryCount;
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO counters (name, value) VALUES ($1, 1)
       ON CONFLICT (name) DO UPDATE SET value = counters.value + 1
       RETURNING value`,
      [LOVE]
    );
    return Number(rows[0].value);
  } catch (error) {
    console.error("[counterStore] incrementLove error", error);
    return null;
  }
}

async function getLoveCount() {
  if (!DB_ENABLED) return memoryCount;
  try {
    const { rows } = await pool.query(`SELECT value FROM counters WHERE name = $1`, [LOVE]);
    return rows.length ? Number(rows[0].value) : 0;
  } catch (error) {
    console.error("[counterStore] getLoveCount error", error);
    return 0;
  }
}

// Fire-and-forget: bump the tally when a message expresses love. Never blocks
// or fails the chat request.
function maybeCountLove(text) {
  if (isLoveMessage(text)) {
    incrementLove().catch((e) => console.error("[counterStore] maybeCountLove", e));
  }
}

module.exports = { isLoveMessage, incrementLove, getLoveCount, maybeCountLove };
