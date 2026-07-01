# anvAI — Emotional Intelligence Companion

> A production-ready AI companion that listens without judgment, detects crises, and bridges the gap to professional mental health care.

---

## What is anvAI?

anvAI is a conversational emotional support companion built on a therapeutic EQ pipeline. It listens, reflects, and gently guides — without diagnosing, advising, or replacing a licensed therapist.

**It is not a replacement for professional mental health care.** It is a safe, accessible first step for people who aren't ready to reach out yet.

---

## Features

- **Emotionally intelligent responses** — EQ guardrail pipeline ensures every reply is warm, concise, and non-prescriptive
- **Vent mode** — detects when a user just wants to be heard, suppresses advice
- **Crisis detection** — multi-level severity analysis; immediately surfaces helpline numbers for at-risk users
- **Emotional state tracker** — identifies primary emotions, intensity, and trajectory in real time
- **Dark, calming UI** — Three.js breathing orb, Fraunces serif, full mobile support
- **Accessible** — WCAG 2.1 AA compliant, screen reader support, keyboard navigation, iOS safe-area aware

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML/CSS/JS, Three.js r128 (WebGL orb) |
| Fonts | Fraunces, Sora, IBM Plex Mono (Google Fonts) |
| Backend | Node.js, Express |
| AI | AI Native proxy (Anthropic-compatible), llama-4-maverick-17b-128e |
| Crisis classifier | claude-3-5-haiku |
| Process manager | PM2 |
| Security | helmet, express-rate-limit, crypto session IDs |

---

## Project Structure

```
anvai/
├── server.js                 # Express server — hardened, rate-limited, production-ready
├── systemPrompt.js           # Core therapeutic system prompt
├── anvai-eq-improvements.js  # EQ guardrail pipeline + vent mode
├── crisisDetection.js        # Multi-level crisis detection & resource routing
├── emotionalAnalyzer.js      # Real-time emotional state analysis
├── ecosystem.config.js       # PM2 process manager config
├── test-scenarios.js         # EQ test suite (9 scenarios)
├── .env.example              # Environment variable template
├── package.json
└── public/
    ├── index.html            # Landing page (Three.js orb, helplines, nav)
    ├── chat.html             # Chat interface
    ├── script.js             # Frontend chat logic
    ├── styles.css            # Dark theme design system
    ├── privacy.html          # Privacy policy
    ├── favicon.svg           # SVG favicon
    ├── og-image.svg          # Social share card
    ├── robots.txt
    └── sitemap.xml
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- An [AI Native](https://ainative.studio) API key (Anthropic-compatible proxy)

### Installation

```bash
# 1. Clone the repo
git clone https://github.com/anvay07/anvAI.git
cd anvAI

# 2. Install dependencies
npm install

# 3. Set up environment
cp .env.example .env
# Edit .env and add your API key
```

### Environment Variables

```env
AINATIVE_API_KEY=sk_your_key_here
AINATIVE_BASE_URL=https://api.ainative.studio
PORT=3000
NODE_ENV=production
ALLOWED_ORIGINS=https://yourdomain.com
CRISIS_REGION=US
```

### Run

```bash
# Development
npm run dev

# Production (via PM2)
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # run in admin terminal for reboot persistence
```

Open `http://localhost:3000`

---

## API Reference

### `POST /api/session/new`
Creates a new conversation session.

```json
// Response
{
  "sessionId": "a3f8c2...",   // 48-char cryptographically random hex
  "message": "Hey. I'm here — what's on your mind?"
}
```

### `POST /api/chat`
Send a message, get a therapeutic response.

```json
// Request
{
  "sessionId": "a3f8c2...",
  "userMessage": "I've been feeling really lost lately."
}

// Response
{
  "response": "That kind of lostness can feel like being adrift without a map...",
  "emotionalState": {
    "primaryEmotions": [{ "emotion": "confusion", "confidence": 78 }],
    "emotionalIntensity": 6,
    "emotionalTrajectory": "stable"
  },
  "isCrisis": false
}
```

### `GET /api/session/:sessionId/summary`
Returns message count and detected themes for a session.

### `GET /api/health`
Returns `{ "status": "ok" }`.

---

## Security

| Measure | Implementation |
|---|---|
| Security headers | `helmet` — CSP, HSTS, X-Frame-Options, X-Content-Type-Options |
| CORS | Origin allowlist via `ALLOWED_ORIGINS` env var |
| Rate limiting | 200 req/15 min global · 20 msg/min chat · 5 sessions/min |
| Session IDs | `crypto.randomBytes(24)` — 192-bit entropy |
| Session TTL | 2-hour expiry + 2,000 session cap with auto-prune |
| Input validation | Message length capped at 2,000 chars, session ID format enforced |
| Request timeouts | All AI calls wrapped with `withTimeout()` |
| Error handling | Internal errors logged server-side only — never exposed to client |
| Payload cap | `express.json({ limit: "16kb" })` |
| Graceful shutdown | SIGTERM/SIGINT handlers drain connections cleanly |

---

## Crisis Detection

Severity levels detected:

| Level | Description |
|---|---|
| `EXTREME` | Explicit suicidal ideation with plan/intent |
| `SEVERE` | Strong suicidal thoughts or self-harm urges |
| `HIGH` | Persistent hopelessness, escalating distress |
| `SELF-HARM` | Active self-injury behavior |
| `HARM-TO-OTHERS` | Thoughts of harming someone else |

When a crisis is detected, anvAI immediately surfaces relevant helplines based on `CRISIS_REGION`.

**Supported regions:** US · INDIA · UK · GLOBAL

---

## EQ Test Suite

Run the 9-scenario emotional intelligence test:

```bash
node test-scenarios.js
```

Tests cover: grief, ambiguous contradiction, anxiety spirals, guilt, vent mode, coping behavior, explicit crisis, figurative language, and deflection/dark humor.

---

## Crisis Resources

**United States:** 988 Suicide & Crisis Lifeline · Crisis Text Line: text HOME to 741741

**India:** iCall +91-9152987821 · Vandrevala Foundation +91-9999-666-555 · AASRA +91-22-27546669

**United Kingdom:** Samaritans 116 123 · CALM 0800 585858

**International:** findahelpline.com

---

## Disclaimer

anvAI is an AI companion, not a licensed therapist. It does not provide diagnosis, treatment, or medical advice. Always encourage users to seek professional mental health support.

**Build with compassion. Deploy responsibly.**

---

## License

MIT
