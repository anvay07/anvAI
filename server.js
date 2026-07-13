"use strict";

const crypto       = require("crypto");
const Anthropic    = require("@anthropic-ai/sdk");
const express      = require("express");
const cors         = require("cors");
const helmet       = require("helmet");
const rateLimit    = require("express-rate-limit");
const dotenv       = require("dotenv");
const cookieParser = require("cookie-parser");

const crisisDetector   = require("./crisisDetection");
const emotionalAnalyzer = require("./emotionalAnalyzer");
const eq               = require("./anvai-eq-improvements");
const db                = require("./db");
const auth              = require("./auth");
const chatStore         = require("./chatStore");

dotenv.config();

// ============================================
// VALIDATION — check environment configuration
// ============================================
const REQUIRED_ENV = ["TENSORX_API_KEY"];
const missingEnv  = REQUIRED_ENV.filter((key) => !process.env[key]);
const HAS_CONFIG_ERROR = missingEnv.length > 0;

if (HAS_CONFIG_ERROR) {
  console.error(`[startup] WARNING: missing env var(s): ${missingEnv.join(", ")}`);
  console.error(`[startup] The server will run in degraded configuration-warning mode.`);
}

const IS_PROD = process.env.NODE_ENV === "production";

// ============================================
// AI CLIENT
// ============================================
const anthropic = process.env.AINATIVE_API_KEY
  ? new Anthropic({
      apiKey:  process.env.AINATIVE_API_KEY,
      baseURL: process.env.AINATIVE_BASE_URL,
    })
  : null;

const TENSORX_BASE_URL = process.env.TENSORX_BASE_URL || "https://api.tensorx.ai/v1";

// TensorX is an OpenAI-compatible chat completions router, not Anthropic's
// Messages format, so it needs its own request/response shape rather than the Anthropic SDK.
async function callTensorX({ model, system, messages, maxTokens, temperature }) {
  const res = await fetch(`${TENSORX_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:  `Bearer ${process.env.TENSORX_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      max_tokens:  maxTokens,
      temperature,
      messages: [{ role: "system", content: system }, ...messages],
    }),
  });
  if (!res.ok) {
    throw new Error(`TensorX API error ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

const client = {
  anthropic,
  mainModel:       "deepseek/deepseek-v4-flash",
  classifierModel: "deepseek/deepseek-v4-flash",
  // Generic completion used by crisisDetection's semantic classifier.
  complete: ({ system, userPrompt, maxTokens = 150 }) =>
    callTensorX({
      model:       client.classifierModel,
      system,
      messages:    [{ role: "user", content: userPrompt }],
      maxTokens,
      temperature: 0.2,
    }),
};

// ============================================
// SESSION STORE — with TTL + size cap
// ============================================
const MAX_SESSIONS   = 2000;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const conversations  = new Map(); // sessionId → { history, ventMode, lastUsed }

function pruneExpiredSessions() {
  const now = Date.now();
  for (const [id, session] of conversations) {
    if (now - session.lastUsed > SESSION_TTL_MS) {
      conversations.delete(id);
    }
  }
  // Safety valve: if still over cap, evict oldest
  if (conversations.size > MAX_SESSIONS) {
    const sorted = [...conversations.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    sorted.slice(0, conversations.size - MAX_SESSIONS).forEach(([id]) => conversations.delete(id));
  }
}
// Prune every 30 minutes
setInterval(pruneExpiredSessions, 30 * 60 * 1000).unref();

function getSession(sessionId) {
  const session = conversations.get(sessionId);
  if (!session) return null;
  session.lastUsed = Date.now();
  return session;
}

function createSession() {
  pruneExpiredSessions(); // enforce cap before adding
  const sessionId = crypto.randomBytes(24).toString("hex"); // 48-char unpredictable ID
  const session   = { history: [], ventMode: false, lastUsed: Date.now() };
  conversations.set(sessionId, session);
  return { sessionId, session };
}

// ============================================
// EXPRESS APP
// ============================================
const app = express();

// ─── Security headers (helmet) ────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc:     ["'self'"],
        scriptSrc:      ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com", "https://accounts.google.com"],
        styleSrc:       ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc:        ["'self'", "https://fonts.gstatic.com"],
        imgSrc:         ["'self'", "data:", "blob:", "https://lh3.googleusercontent.com"],
        connectSrc:     ["'self'", "https://accounts.google.com"],
        frameSrc:       ["https://accounts.google.com"],
        objectSrc:      ["'none'"],
        upgradeInsecureRequests: IS_PROD ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false, // Three.js WebGL needs this off
    hsts: IS_PROD ? { maxAge: 31536000, includeSubDomains: true } : false,
  })
);

// ─── CORS ─────────────────────────────────────────────────────────────────────
const rawOrigins  = (process.env.ALLOWED_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean);
const allowedOrigins = IS_PROD && rawOrigins.length
  ? rawOrigins
  : true; // dev: allow all

app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "DELETE"],
    allowedHeaders: ["Content-Type"],
    credentials: false,
  })
);

// ─── Body parser — cap payload at 16 KB ───────────────────────────────────────
app.use(express.json({ limit: "16kb" }));
app.use(cookieParser());

// ─── Rate limiters ────────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a moment." },
});

const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 20,             // 20 messages per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Sending too fast. Please slow down." },
});

const sessionCreateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: "Too many sessions created. Please wait." },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { error: "Too many sign-in attempts. Please wait." },
});

app.use(globalLimiter);
// ============================================
// CONFIGURATION ERROR INTERCEPTOR
// ============================================
if (HAS_CONFIG_ERROR) {
  app.use((req, res, next) => {
    // Keep health check passing for Railway container probes so it doesn't loop-restart
    if (req.path === "/api/health") {
      return res.json({ status: "degraded", error: `Missing env vars: ${missingEnv.join(", ")}` });
    }
    
    // For API calls, return JSON error detailing the issue
    if (req.path.startsWith("/api/")) {
      return res.status(500).json({
        error: "Configuration Error",
        message: `Missing required environment variable(s): ${missingEnv.join(", ")}. Please configure them in your deployment environment (e.g. Railway dashboard).`
      });
    }
    
    // For normal pages, return a helpful themed instructions page (uses 200 status to pass Railway health checks)
    res.status(200).send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>anvAI - Configuration Required</title>
  <link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600&family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,400&display=swap" rel="stylesheet">
  <style>
    body {
      background-color: #0b0f19;
      color: #f3f4f6;
      font-family: 'Sora', sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 20px;
      box-sizing: border-box;
    }
    .card {
      background: rgba(255, 255, 255, 0.02);
      backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 24px;
      padding: 48px;
      max-width: 540px;
      width: 100%;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
      text-align: center;
    }
    .logo {
      font-family: 'Fraunces', serif;
      font-size: 2.5rem;
      font-weight: 600;
      color: #f3f4f6;
      margin-bottom: 24px;
      background: linear-gradient(135deg, #fff, #9ca3af);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    h1 {
      font-family: 'Fraunces', serif;
      font-size: 1.75rem;
      margin-top: 0;
      color: #f87171;
      font-weight: 500;
    }
    p {
      line-height: 1.6;
      color: #9ca3af;
      font-size: 0.95rem;
    }
    .missing-list {
      background: rgba(248, 113, 113, 0.05);
      border: 1px solid rgba(248, 113, 113, 0.15);
      border-radius: 12px;
      padding: 16px 24px;
      margin: 28px 0;
      text-align: left;
    }
    .missing-list strong {
      color: #f87171;
      display: block;
      margin-bottom: 8px;
      font-size: 0.9rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .missing-list ul {
      margin: 0;
      padding-left: 20px;
      color: #e5e7eb;
      font-family: 'IBM Plex Mono', monospace;
      font-size: 0.9rem;
    }
    .missing-list li {
      margin: 6px 0;
    }
    .instructions {
      text-align: left;
      font-size: 0.9rem;
      color: #9ca3af;
      margin-top: 24px;
    }
    .instructions ol {
      padding-left: 20px;
      margin: 8px 0;
    }
    .instructions li {
      margin: 8px 0;
    }
    .note {
      font-size: 0.8rem;
      color: #4b5563;
      margin-top: 36px;
      border-top: 1px solid rgba(255, 255, 255, 0.05);
      padding-top: 20px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">anvAI</div>
    <h1>Configuration Required</h1>
    <p>The application has deployed successfully, but required API credentials are missing from the environment variables.</p>
    
    <div class="missing-list">
      <strong>Missing Variables:</strong>
      <ul>
        ${missingEnv.map(env => `<li>${env}</li>`).join("")}
      </ul>
    </div>
    
    <div class="instructions">
      <p><strong>How to resolve:</strong></p>
      <ol>
        <li>Go to your <strong>Railway Project Dashboard</strong>.</li>
        <li>Select this service and navigate to the <strong>Variables</strong> tab.</li>
        <li>Add the missing variables listed above with their respective values.</li>
        <li>Railway will automatically redeploy the service with the new settings.</li>
      </ol>
    </div>
    
    <div class="note">
      For security reasons, do not commit your API keys directly to your git repository.
    </div>
  </div>
</body>
</html>
    `);
  });
}

app.use(express.static("public"));

// Non-blocking: attaches req.user when a valid session cookie is present.
// Chat routes work identically whether this resolves a user or not.
app.use(auth.attachUser());

// ============================================
// INPUT VALIDATION HELPERS
// ============================================
const SESSION_ID_RE = /^[0-9a-f]{48}$/;
const MAX_MSG_LEN   = 2000;

function validateSessionId(id) {
  return typeof id === "string" && SESSION_ID_RE.test(id);
}

function validateMessage(msg) {
  return typeof msg === "string" && msg.trim().length > 0 && msg.length <= MAX_MSG_LEN;
}

// ============================================
// ROUTES
// ============================================

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" }); // don't leak server details
});

// ============================================
// AUTH — Google sign-in (optional; anonymous chat works without it)
// ============================================

app.get("/api/auth/config", (req, res) => {
  res.json({
    enabled:        auth.AUTH_ENABLED,
    googleClientId: auth.AUTH_ENABLED ? auth.GOOGLE_CLIENT_ID : null,
  });
});

app.post("/api/auth/google", authLimiter, async (req, res) => {
  if (!auth.AUTH_ENABLED) {
    return res.status(503).json({ error: "Sign-in is not configured on this deployment." });
  }
  try {
    const { idToken } = req.body;
    if (typeof idToken !== "string" || !idToken) {
      return res.status(400).json({ error: "Missing Google credential." });
    }
    const profile = await auth.verifyGoogleIdToken(idToken);
    const user    = await auth.upsertUser(profile);
    const { token } = await auth.createAuthSession(user.id);
    res.cookie(auth.COOKIE_NAME, token, auth.cookieOptions(IS_PROD));
    res.json({ email: user.email, name: user.name, picture: user.picture });
  } catch (error) {
    console.error("[/api/auth/google error]", error);
    res.status(401).json({ error: "Google sign-in failed. Please try again." });
  }
});

app.post("/api/auth/logout", async (req, res) => {
  try {
    const token = req.cookies?.[auth.COOKIE_NAME];
    if (token) await auth.deleteAuthSession(token);
  } catch (error) {
    console.error("[/api/auth/logout error]", error);
  }
  res.clearCookie(auth.COOKIE_NAME, { path: "/" });
  res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "Not signed in." });
  }
  res.json({ email: req.user.email, name: req.user.name, picture: req.user.picture });
});

// ============================================
// PERSISTED CHATS — only for signed-in users
// ============================================

app.get("/api/chats", auth.requireAuth, async (req, res) => {
  try {
    const chats = await chatStore.listChatSessions(req.user.id);
    res.json({ chats });
  } catch (error) {
    console.error("[/api/chats error]", error);
    res.status(500).json({ error: "Something went wrong." });
  }
});

app.get("/api/chats/:id/messages", auth.requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!validateSessionId(id)) {
    return res.status(400).json({ error: "Invalid session ID." });
  }
  try {
    const messages = await chatStore.getChatMessages(id, req.user.id);
    if (messages === null) {
      // Same response whether the chat doesn't exist or belongs to someone else —
      // never let a client distinguish "not found" from "not yours".
      return res.status(404).json({ error: "Chat not found." });
    }
    res.json({ messages });
  } catch (error) {
    console.error("[/api/chats/:id/messages error]", error);
    res.status(500).json({ error: "Something went wrong." });
  }
});

app.delete("/api/chats/:id", auth.requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!validateSessionId(id)) {
    return res.status(400).json({ error: "Invalid session ID." });
  }
  try {
    const deleted = await chatStore.deleteChatSession(id, req.user.id);
    if (!deleted) {
      return res.status(404).json({ error: "Chat not found." });
    }
    res.json({ ok: true });
  } catch (error) {
    console.error("[DELETE /api/chats/:id error]", error);
    res.status(500).json({ error: "Something went wrong." });
  }
});

app.post("/api/session/new", sessionCreateLimiter, async (req, res) => {
  const { sessionId, session } = createSession();
  // suppress session from conversation store just created above
  void session;

  if (req.user) {
    try {
      await chatStore.createChatSession(sessionId, req.user.id);
    } catch (error) {
      console.error("[chatStore] createChatSession error", error);
      // Anonymous in-memory chat still works even if persistence failed.
    }
  }

  res.json({
    sessionId,
    message: "Hey. I'm here — what's on your mind?",
  });
});

app.post("/api/chat", chatLimiter, async (req, res) => {
  try {
    const { sessionId, userMessage } = req.body;

    // ─── Input validation ──────────────────────────────────────────────────────
    if (!validateSessionId(sessionId)) {
      return res.status(400).json({ error: "Invalid session ID." });
    }
    if (!validateMessage(userMessage)) {
      return res.status(400).json({
        error: userMessage && userMessage.length > MAX_MSG_LEN
          ? `Message too long. Maximum ${MAX_MSG_LEN} characters.`
          : "Message is required.",
      });
    }

    const trimmedMessage = userMessage.trim();

    let session = getSession(sessionId);
    if (!session) {
      // Auto-create rather than 404 — graceful for page-refreshes
      ({ session } = createSession());
    }

    // ============================================
    // CRISIS DETECTION (Priority 1)
    // ============================================
    const crisisAnalysis = await withTimeout(
      crisisDetector.analyze(trimmedMessage, session.history, client),
      8000
    );

    if (crisisAnalysis.isCrisis) {
      persistTurn(sessionId, req.user, trimmedMessage, crisisAnalysis.response, {
        isCrisis: true,
        severity: crisisAnalysis.severity,
      });
      return res.json({
        role:      "assistant",
        content:   crisisAnalysis.response,
        isCrisis:  true,
        severity:  crisisAnalysis.severity,
        resources: crisisAnalysis.resources,
      });
    }

    // ============================================
    // EQ LAYER — vent mode tracking
    // ============================================
    session = eq.prepareTurn(session, trimmedMessage);

    // ============================================
    // EMOTIONAL ANALYSIS
    // ============================================
    const emotionalState = await withTimeout(
      emotionalAnalyzer.analyze(trimmedMessage, session.history),
      6000
    );

    // ============================================
    // BUILD CONTEXT SUFFIX
    // ============================================
    const themes = extractThemes(session.history.slice(-10));
    const depth  = Math.floor(session.history.length / 2);
    const contextSuffix =
      (themes.length
        ? `\n\n[Context: turn ${depth}, themes detected: ${themes.join(", ")}]`
        : `\n\n[Context: turn ${depth}]`) +
      `\n\nFORMAT HARD RULE — THIS OVERRIDES EVERYTHING ELSE:
Never use bullet points (- or *), numbered lists, or bold/italic markdown in your reply.
Write in plain prose only. 2-4 sentences max unless the user is clearly asking you to go deeper.`;

    // ============================================
    // BUILD MESSAGES
    // ============================================
    const claudeHistory = session.history.slice(-10).map((msg) => ({
      role:    msg.role === "assistant" ? "assistant" : "user",
      content: msg.content,
    }));

    const systemWithContext = eq.IMPROVED_SYSTEM_PROMPT + contextSuffix;

    const allMessages = eq.buildMessages({
      session,
      systemPrompt: systemWithContext,
      history:      claudeHistory,
      userMessage:  trimmedMessage,
    });
    const system   = allMessages[0].content;
    const messages = allMessages.slice(1);

    // ============================================
    // GENERATE RESPONSE (with one guardrail retry)
    // ============================================
    async function callModel(sys, msgs) {
      return withTimeout(
        callTensorX({
          model:       client.mainModel,
          system:      sys,
          messages:    msgs,
          maxTokens:   800,
          temperature: 0.9,
        }),
        15000
      );
    }

    function stripMarkdown(raw) {
      return raw
        .replace(/```[\s\S]*?```/g, "")
        .replace(/^[\-\*•]\s+/gm, "")
        .replace(/^\d+\.\s+/gm, "")
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/\*(.*?)\*/g, "$1")
        .replace(/[\u{1F300}-\u{1FFFF}]/gu, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }

    let rawDraft = await callModel(system, messages);
    const check  = eq.checkOutput(rawDraft, session, trimmedMessage);
    if (!check.passed) {
      rawDraft = await callModel(
        system + `\n\nYour previous response broke the rules. Rewrite in exactly 2-3 plain sentences.
Rules: no bullet points, no numbered lists, no bold text. Do NOT guess what the user might privately be feeling or thinking. Just reflect the one feeling they expressed, ask one open question. Nothing else.`,
        messages
      );
    }

    // Truncate if short input still got long response after retry
    const userWordCount = trimmedMessage.split(/\s+/).length;
    if (userWordCount <= 12) {
      const sentences = rawDraft.match(/[^.!?]*[.!?]+/g) || [];
      if (sentences.length > 5) {
        rawDraft = sentences.slice(0, 4).join("").trim();
      }
    }

    // Strip meta-commentary that sometimes leaks in regeneration
    const cleanedDraft = rawDraft
      .replace(/^(rule violation|rewritten response|your previous (draft|reply) violated)[^\n]*\n*/im, "")
      .replace(/^(here'?s? (is )?(a )?rewritten?|revised response|corrected response)[^\n]*\n*/im, "")
      .trim();

    const draft = stripMarkdown(cleanedDraft);

    // ============================================
    // RELEASE VENT MODE IF USER ASKS FOR ADVICE
    // ============================================
    session = eq.checkVentModeRelease(session, trimmedMessage);

    // ============================================
    // UPDATE HISTORY — cap at 100 turns per session
    // ============================================
    session.history.push({ role: "user",      content: trimmedMessage });
    session.history.push({ role: "assistant", content: draft });
    if (session.history.length > 100) {
      session.history = session.history.slice(-100);
    }
    session.lastUsed = Date.now();
    conversations.set(sessionId, session);

    persistTurn(sessionId, req.user, trimmedMessage, draft, { emotionalState });

    res.json({
      response:       draft,
      emotionalState,
      isCrisis:       false,
    });
  } catch (error) {
    // Log full error server-side only — never expose internals to client
    console.error("[/api/chat error]", error);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

app.get("/api/session/:sessionId/summary", (req, res) => {
  const { sessionId } = req.params;

  if (!validateSessionId(sessionId)) {
    return res.status(400).json({ error: "Invalid session ID." });
  }

  const session = getSession(sessionId);
  if (!session || session.history.length === 0) {
    return res.status(404).json({ error: "Session not found." });
  }

  res.json({
    messageCount: session.history.length,
    themes:       extractThemes(session.history),
  });
});

// ============================================
// CATCH-ALL 404
// ============================================
app.use((req, res) => {
  res.status(404).json({ error: "Not found." });
});

// ============================================
// CENTRALISED ERROR HANDLER
// ============================================
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("[unhandled error]", err);
  res.status(500).json({ error: "Something went wrong." });
});

// ============================================
// HELPER FUNCTIONS
// ============================================

// Fire-and-forget: persist a turn for signed-in users without adding DB
// latency to the response. Silently no-ops for anonymous users or if the
// session wasn't created while signed in (never writes to a session it
// doesn't already own).
async function persistTurn(sessionId, user, userMessage, assistantMessage, assistantMeta) {
  if (!user) return;
  try {
    const owned = await chatStore.isOwnedSession(sessionId, user.id);
    if (!owned) return;
    await chatStore.appendMessage(sessionId, "user", userMessage, null);
    await chatStore.appendMessage(sessionId, "assistant", assistantMessage, assistantMeta || null);
  } catch (error) {
    console.error("[chatStore] persistTurn error", error);
  }
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms)
    ),
  ]);
}

function extractThemes(history) {
  const themes   = new Set();
  const keywords = {
    abandonment: ["alone", "abandoned", "left", "nobody", "isolated", "forgotten"],
    shame:       ["worthless", "ashamed", "embarrassed", "stupid", "failure"],
    trauma:      ["scared", "afraid", "triggered", "flashback", "terror"],
    depression:  ["hopeless", "pointless", "empty", "numb", "dark"],
    anxiety:     ["worried", "anxious", "nervous", "panic", "overwhelmed"],
    anger:       ["furious", "rage", "angry", "bitter", "resentful"],
    grief:       ["lost", "miss", "grief", "died", "death", "gone"],
  };

  history.forEach((msg) => {
    const text = msg.content.toLowerCase();
    Object.entries(keywords).forEach(([theme, words]) => {
      if (words.some((word) => text.includes(word))) themes.add(theme);
    });
  });

  return Array.from(themes);
}

// ============================================
// GRACEFUL SHUTDOWN
// ============================================
function shutdown(signal) {
  console.log(`[${signal}] Shutting down gracefully…`);
  if (server) {
    server.close(() => {
      console.log("Server closed.");
      process.exit(0);
    });
    // Force exit if not done in 10s
    setTimeout(() => process.exit(1), 10000).unref();
  } else {
    process.exit(0);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

// Catch unhandled rejections so the process doesn't silently die
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
  // See the startup env-check above — same async-stderr-flush risk applies here,
  // and this is the one place we can least afford to lose the crash reason.
  process.exitCode = 1;
  process.stderr.write("", () => process.exit());
});

// ============================================
// START SERVER
// ============================================
const PORT = parseInt(process.env.PORT, 10) || 3000;
let server;

async function start() {
  if (db.DB_ENABLED) {
    try {
      await db.initSchema();
      console.log("[startup] Database schema ready.");
    } catch (error) {
      console.error(
        "[startup] Database schema init failed — sign-in and persisted chats will error until this is fixed:",
        error
      );
    }
  } else {
    console.log("[startup] DATABASE_URL not set — running anonymous-only (no accounts, no persisted history).");
  }

  if (!auth.AUTH_ENABLED) {
    console.log("[startup] GOOGLE_CLIENT_ID not set — Google sign-in is disabled.");
  }

  // Prune expired auth sessions hourly (no-ops when auth isn't configured)
  setInterval(() => auth.pruneExpiredAuthSessions(), 60 * 60 * 1000).unref();

  server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`anvAI running — port ${PORT} — ${process.env.NODE_ENV}`);
  });
}

start();
