"use strict";

const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const { pool, DB_ENABLED } = require("./db");

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || null;
const AUTH_ENABLED = Boolean(DB_ENABLED && GOOGLE_CLIENT_ID);

const oauthClient = AUTH_ENABLED ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const COOKIE_NAME = "anvai_auth";

async function verifyGoogleIdToken(idToken) {
  const ticket = await oauthClient.verifyIdToken({
    idToken,
    audience: GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload || !payload.email_verified) {
    throw new Error("Google account email is not verified.");
  }
  return {
    googleSub: payload.sub,
    email: payload.email,
    name: payload.name || null,
    picture: payload.picture || null,
  };
}

async function upsertUser({ googleSub, email, name, picture }) {
  const { rows } = await pool.query(
    `INSERT INTO users (google_sub, email, name, picture)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (google_sub) DO UPDATE
       SET email = EXCLUDED.email, name = EXCLUDED.name, picture = EXCLUDED.picture
     RETURNING id, email, name, picture`,
    [googleSub, email, name, picture]
  );
  return rows[0];
}

async function createAuthSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await pool.query(
    `INSERT INTO auth_sessions (token, user_id, expires_at) VALUES ($1, $2, $3)`,
    [token, userId, expiresAt]
  );
  return { token, expiresAt };
}

async function deleteAuthSession(token) {
  if (!token) return;
  await pool.query(`DELETE FROM auth_sessions WHERE token = $1`, [token]);
}

async function getUserFromToken(token) {
  if (!token) return null;
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.name, u.picture
     FROM auth_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > now()`,
    [token]
  );
  return rows[0] || null;
}

async function pruneExpiredAuthSessions() {
  if (!AUTH_ENABLED) return;
  await pool.query(`DELETE FROM auth_sessions WHERE expires_at < now()`).catch((e) => {
    console.error("[auth] prune error", e);
  });
}

function cookieOptions(isProd) {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    maxAge: SESSION_TTL_MS,
    path: "/",
  };
}

// Non-blocking: attaches req.user when a valid session cookie is present, otherwise
// just continues — chat endpoints work both signed-in and anonymous.
function attachUser() {
  return async (req, res, next) => {
    if (!AUTH_ENABLED) return next();
    try {
      const token = req.cookies?.[COOKIE_NAME];
      const user = await getUserFromToken(token);
      if (user) req.user = user;
    } catch (e) {
      console.error("[auth] attachUser error", e);
    }
    next();
  };
}

function requireAuth(req, res, next) {
  if (!AUTH_ENABLED) {
    return res.status(503).json({ error: "Sign-in is not configured on this deployment." });
  }
  if (!req.user) {
    return res.status(401).json({ error: "Sign-in required." });
  }
  next();
}

module.exports = {
  AUTH_ENABLED,
  GOOGLE_CLIENT_ID,
  COOKIE_NAME,
  verifyGoogleIdToken,
  upsertUser,
  createAuthSession,
  deleteAuthSession,
  getUserFromToken,
  pruneExpiredAuthSessions,
  cookieOptions,
  attachUser,
  requireAuth,
};
