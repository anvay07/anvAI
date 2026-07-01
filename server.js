"use strict";

const crypto     = require("crypto");
const Anthropic  = require("@anthropic-ai/sdk");
const express    = require("express");
const cors       = require("cors");
const helmet     = require("helmet");
const rateLimit  = require("express-rate-limit");
const dotenv     = require("dotenv");

const crisisDetector   = require("./crisisDetection");
const emotionalAnalyzer = require("./emotionalAnalyzer");
const eq               = require("./anvai-eq-improvements");

dotenv.config();

// ============================================
// VALIDATION — fail fast if config is missing
// ============================================
const REQUIRED_ENV = ["AINATIVE_API_KEY", "AINATIVE_BASE_URL"];
REQUIRED_ENV.forEach((key) => {
  if (!process.env[key]) {
    console.error(`[startup] FATAL: missing env var ${key}`);
    process.exit(1);
  }
});

const IS_PROD = process.env.NODE_ENV === "production";

// ============================================
// AI CLIENT
// ============================================
const anthropic = new Anthropic({
  apiKey:  process.env.AINATIVE_API_KEY,
  baseURL: process.env.AINATIVE_BASE_URL,
});

const client = {
  anthropic,
  mainModel:       "llama-4-maverick-17b-128e",
  classifierModel: "claude-3-5-haiku",
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
        scriptSrc:      ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
        styleSrc:       ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc:        ["'self'", "https://fonts.gstatic.com"],
        imgSrc:         ["'self'", "data:", "blob:"],
        connectSrc:     ["'self'"],
        frameSrc:       ["'none'"],
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
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
    credentials: false,
  })
);

// ─── Body parser — cap payload at 16 KB ───────────────────────────────────────
app.use(express.json({ limit: "16kb" }));

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

app.use(globalLimiter);
app.use(express.static("public"));

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

app.post("/api/session/new", sessionCreateLimiter, (req, res) => {
  const { sessionId, session } = createSession();
  // suppress session from conversation store just created above
  void session;
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
      const result = await withTimeout(
        anthropic.messages.create({
          model:      client.mainModel,
          max_tokens: 800,
          temperature: 0.9,
          system:     sys,
          messages:   msgs,
        }),
        15000
      );
      return result.content.filter((b) => b.type === "text").map((b) => b.text).join("");
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
  server.close(() => {
    console.log("Server closed.");
    process.exit(0);
  });
  // Force exit if not done in 10s
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

// Catch unhandled rejections so the process doesn't silently die
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
  process.exit(1);
});

// ============================================
// START SERVER
// ============================================
const PORT   = parseInt(process.env.PORT, 10) || 3000;
const server = app.listen(PORT, () => {
  console.log(`anvAI running — port ${PORT} — ${process.env.NODE_ENV}`);
});
