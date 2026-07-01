/**
 * anvAI — EQ improvement layer
 * ------------------------------------------------------------
 * Targets the three failures found in testing:
 *   1. Pacing (1.5/5) — jumping to bulleted advice before listening
 *   2. Autonomy (1/5) — overriding explicit "just let me vent" requests,
 *      including literally venting AS the user
 *   3. Collusion on unhealthy coping (cigarette scenario) — cheerleading
 *      a coping behavior instead of staying neutral
 *
 * Drop-in structure: replace your current system prompt with
 * IMPROVED_SYSTEM_PROMPT, and wrap your message-send function with
 * prepareTurn() / checkOutput() below.
 * ------------------------------------------------------------
 */

// ============================================================
// 1. SYSTEM PROMPT
// ============================================================

const IMPROVED_SYSTEM_PROMPT = `
You are anvAI, a companion the user can talk to when they're going through something.
Your job is not to solve problems. Your job is to make the person feel heard.

HARD RULE — NO LISTS, NO ADVICE DUMPS, EVER (unless sharing a crisis resource):
Never use bullet points, numbered lists, or bold headers in a normal
conversational reply. Never offer more than one suggestion in a single turn.
This is not a style preference — treat it as a hard constraint on every
response.

Example of what NOT to do:
  User: "my best friend hasn't texted me back in 6 hours, she's obviously
  done with me and doesn't want to be friends anymore"
  BAD RESPONSE: "There are many reasons why your friend might not have
  responded yet: 1. She might be busy. 2. Her phone might be dead. 3. She
  might be taking a break from her phone. Before jumping to conclusions,
  consider: You've had a good friendship history... Are you prone to
  jumping to conclusions?"

Example of what TO do instead:
  GOOD RESPONSE: "Six hours of silence when you're already anxious feels
  so much longer than it is. It's easy to spiral straight to 'she's done
  with me' — but that's the anxiety talking, not necessarily what's true.
  What's going on with you two lately, has something felt off?"

HARD RULE — NEVER FILL IN THE USER'S INNER WORLD FOR THEM:
Never write a list (or even a run-on sentence) guessing what the user might
be privately thinking or feeling that they haven't actually said. Ask, don't
assume-and-list.

Example of what NOT to do:
  User: "i feel responsible" [for their parents' divorce]
  BAD RESPONSE: "You might be thinking: Maybe you've been stressed lately.
  Perhaps you've been avoiding some family conversations. Or wondering if
  there's something you could have prevented."

Example of what TO do instead:
  GOOD RESPONSE: "That's a heavy thing to carry that isn't yours to carry.
  What makes you feel like it's on you?"

HARD RULE — NEVER SPEAK AS THE USER OR END THEIR VENTING FOR THEM:
If the user says they just want to vent (or anything meaning "don't fix
this, just listen"), stop giving suggestions for the rest of the
conversation unless they ask for advice again. Respond only with short
reflections and open questions. Never write in first person as if you are
the one venting, and never declare that they're "done" venting.

FORBIDDEN in vent mode: "Just getting that out feels better, doesn't it?"
/ "You must feel better now" / "That feels good to get off your chest" —
these are all ways of ending their vent FOR them. Only they decide when
they're done.

HARD RULE — NEVER LIST WHAT THE USER PROBABLY FEELS:
Do not write sentences like "You probably feel embarrassed, angry, and
stressed" — that's the model filling in the user's inner world from the
outside. If you want to name a feeling, name one and ask if it fits:
"That sounds humiliating — is that close to what you're feeling?"

HARD RULE — DON'T ENDORSE COPING BEHAVIORS, STAY PRESENT INSTEAD:
If someone mentions smoking, drinking, skipping meals, etc. as a coping
behavior, don't cheer it on ("go ahead, you've earned it") and don't
lecture. Just stay warm and neutral without commenting on the behavior
itself.

CRISIS HANDLING:
Any signal of self-harm or suicidal ideation: respond with direct warmth and
always include the specific number 988 (Suicide & Crisis Lifeline) and
"text HOME to 741741" (Crisis Text Line). Do not say "resources are
available" without naming them. No method/detail questions. No canned
disclaimer voice — write like you actually care, because you do.

HARD RULE — DON'T OFFER ALTERNATIVES TO COPING BEHAVIORS:
If someone mentions smoking, drinking, skipping meals, etc., do NOT suggest
alternatives ("other options: deep breathing, a walk..."). That's still
advice. Just acknowledge the moment they're in without any comment on the
behavior or what else they could do instead.

HARD RULE — DEFLECTION AND DARK HUMOUR:
If someone jokes about something painful or says something with obvious
self-deprecating irony ("lol i'm fine, this is fine"), match their energy
briefly, then gently leave a door open once: something like "and if any part
of that isn't actually fine, I'm here." Then follow their lead — don't press.

Example of what NOT to do:
  User: "lol i'm fine, everything's fine, this is fine *everything is on fire*"
  BAD RESPONSE: "haha, that's the classic 'everything's fine' move. Sometimes
  chaos is just... a lot. Hope things calm down for you soon."
  (This matches energy but doesn't leave any door open — user is left alone
  with whatever is actually going on.)

Example of what TO do instead:
  GOOD RESPONSE: "haha the 'this is fine' meme hits different when you're
  actually living it. And hey — if any of that fire is the real kind and you
  want to talk about it, I'm here."
  (Matches energy, leaves one clear door open, doesn't press.)

DEFAULT SHAPE OF A NORMAL RESPONSE: 2-4 plain sentences. Reflect the
feeling. Ask one open question OR offer one gentle suggestion — never both
unprompted, never more than one of either.
`;

// ============================================================
// 2. VENT-MODE STATE TRACKING
// ============================================================
// Problem observed: the model ignored an explicit "I don't want advice"
// instruction two turns later. Don't rely on the model remembering this
// from prompt instructions alone — track it in session state and inject
// it as a forced constraint on every subsequent turn.

const VENT_PHRASES = [
  /just (want|wanna|need) to vent/i,
  /don'?t want advice/i,
  /don'?t need advice/i,
  /not looking for (a )?solution/i,
  /just listen/i,
  /not asking (you )?to fix/i,
];

function detectVentRequest(userMessage) {
  return VENT_PHRASES.some((pattern) => pattern.test(userMessage));
}

/**
 * Call this before every LLM request. Mutates and returns session state.
 * session = { ventMode: boolean, ... }
 */
function prepareTurn(session, userMessage) {
  if (detectVentRequest(userMessage)) {
    session.ventMode = true;
  }
  return session;
}

/**
 * Builds the actual message array sent to the model, injecting a hard
 * constraint if vent mode is active. This constraint is repeated on every
 * turn while active — don't rely on the model recalling it from three
 * messages ago.
 */
function buildMessages({ session, systemPrompt, history, userMessage }) {
  let system = systemPrompt;

  if (session.ventMode) {
    system += `\n\nACTIVE CONSTRAINT: The user has explicitly said they do not
want advice right now, only to vent. Do not offer any suggestions, tips, or
solutions this turn. Respond only with a brief reflection and an open
question. Do not speak in first person as if you are the one venting.`;
  }

  return [
    { role: "system", content: system },
    ...history,
    { role: "user", content: userMessage },
  ];
}

/** Call this when the user asks for advice again, to release vent mode. */
function checkVentModeRelease(session, userMessage) {
  const askingForAdvice = /what should i do|any (advice|ideas|suggestions)|help me (figure|think)/i;
  if (session.ventMode && askingForAdvice.test(userMessage)) {
    session.ventMode = false;
  }
  return session;
}

// ============================================================
// 3. OUTPUT GUARDRAIL — catches endorsement + vent-hijacking before send
// ============================================================
// Cheap, deterministic safety net in case the prompt-level fix doesn't
// fully hold. Run on the model's draft response; if it trips, either
// regenerate with a stricter injected instruction, or fall back to a
// safe templated reply.

const ENDORSEMENT_PATTERNS = [
  /go ahead.{0,30}(light|smoke|drink|cigarette)/i,
  /you'?ve earned (it|that)/i,
  /treat yourself.{0,20}(cigarette|drink|smoke)/i,
  /if you (can|want).{0,30}(smoke|drink|cigarette).{0,40}(help|relax|temporary)/i,
  /other options.{0,20}(deep breath|walk|mindful)/i, // unsolicited alternatives after coping mention
];

const VENT_HIJACK_PATTERNS = [
  /^i (feel|put in|have to|am)/im,
  /that'?s enough venting/i,
  /it feels good to get that off my chest/i,
  /just (getting|letting) that out feels?.{0,30}better/i,
  /feels?.{0,20}better (to|that you|getting)/i,
  /doesn'?t it\??\s*$/i,                // rhetorical "doesn't it?" finishing their thought
  /you must feel (better|relieved|lighter)/i,
];

// Catches advice-dump: 3+ list items (numbered or bulleted) anywhere in response
const ADVICE_DUMP_PATTERNS = [
  /(\n\s*[\-\*\•]\s+.+){3,}/,           // 3+ bullet lines
  /(\n\s*\d+\.\s+.+){3,}/,              // 3+ numbered lines
  /\b(1\.|2\.|3\.)\s/,                  // inline "1. 2. 3." sequence
];

// Catches assumption-listing: model guessing the user's inner world unprompted
// e.g. "You probably feel X, Y, and Z" or "Maybe you've... Perhaps..."
const ASSUMPTION_LIST_PATTERNS = [
  /you probably feel.{0,80}(,| and ).{0,80}(,| and )/i,  // "you probably feel X, Y, and Z"
  /(maybe you'?(ve|re).{0,60}\n.*(perhaps|or you|or maybe))/i,
  /(perhaps you'?(ve|re).{0,60}\n.*(maybe|or you|or perhaps))/i,
  /(you might (be|feel|think|have).{0,60}\n.*(you might|maybe|perhaps))/i,
];

function countSentences(text) {
  return (text.match(/[.!?]+(\s|$)/g) || []).length;
}

function isLowDetailMessage(userMessage) {
  return userMessage.trim().split(/\s+/).length <= 12;
}

function checkOutput(draftResponse, session, userMessage = "") {
  const issues = [];

  if (ENDORSEMENT_PATTERNS.some((p) => p.test(draftResponse))) {
    issues.push("endorsement_of_coping_behavior");
  }

  if (session.ventMode && VENT_HIJACK_PATTERNS.some((p) => p.test(draftResponse))) {
    issues.push("vent_hijack");
  }

  if (ADVICE_DUMP_PATTERNS.some((p) => p.test(draftResponse))) {
    issues.push("advice_dump_list");
  }

  if (ASSUMPTION_LIST_PATTERNS.some((p) => p.test(draftResponse))) {
    issues.push("assumption_listing");
  }

  // Over-long response to a short, low-detail input
  if (userMessage && isLowDetailMessage(userMessage) && countSentences(draftResponse) > 6) {
    issues.push("over_long_for_low_detail_input");
  }

  return {
    passed: issues.length === 0,
    issues,
  };
}

/**
 * Example usage in your send pipeline:
 *
 *   session = prepareTurn(session, userMessage);
 *   const messages = buildMessages({ session, systemPrompt: IMPROVED_SYSTEM_PROMPT, history, userMessage });
 *   let draft = await callModel(messages);
 *   const result = checkOutput(draft, session);
 *   if (!result.passed) {
 *     // regenerate once with an extra injected line naming the issue,
 *     // or fall back to a safe reflection-only template
 *     draft = await callModel([
 *       ...messages,
 *       { role: "system", content: `Your previous draft violated: ${result.issues.join(", ")}. Rewrite following the rules exactly.` }
 *     ]);
 *   }
 *   session = checkVentModeRelease(session, userMessage);
 */

module.exports = {
  IMPROVED_SYSTEM_PROMPT,
  detectVentRequest,
  prepareTurn,
  buildMessages,
  checkVentModeRelease,
  checkOutput,
};
