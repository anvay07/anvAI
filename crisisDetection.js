// crisisDetection.js - Detects crisis indicators and provides immediate support

const crisisResources = {
  GLOBAL: {
    description: "International Crisis Resources",
    crisis_text_line: "Text HOME to 741741 (US)",
    international_hotline: "Find your local hotline at findahelpline.com",
  },
  US: {
    national_suicide_prevention_lifeline:
      "988 (call or text, available 24/7)",
    crisis_text_line: "Text HOME to 741741",
    SAMHSA_National_Helpline: "1-800-662-4357 (substance abuse)",
  },
  INDIA: {
    aasra: "+91-22-2754 6669",
    iCall: "+91-96 5033 6262",
    Vandrevala_Foundation: "+91-9999 666 555",
    AMIABLE: "+91 9076 389 389",
  },
  UK: {
    samaritans: "116 123",
    mind: "0300 123 3393",
  },
};

const crisisIndicators = {
  EXTREME: {
    keywords: [
      "kill myself",
      "end my life",
      "suicide plan",
      "already decided",
      "no reason to live",
      "everyone would be better",
      "final goodbye",
      "I'm going to hurt myself",
    ],
    severity: "EXTREME",
  },
  SEVERE: {
    keywords: [
      "suicidal",
      "want to die",
      "can't take it anymore",
      "pain is unbearable",
      "harm myself",
      "hurting myself",
      "hurt myself",
      "thinking about hurting myself",
      "self harm",
      "cut myself",
      "want to disappear",
      "nothing matters",
    ],
    severity: "SEVERE",
  },
  HIGH: {
    keywords: [
      "thinking about suicide",
      "should be dead",
      "burden to everyone",
      "nobody would care",
      "tired of living",
      "constant pain",
      "hopeless",
      "pointless",
      "don't see the point",
      "no point anymore",
      "don't see a point",
    ],
    severity: "HIGH",
  },
};

// Analyze message for crisis indicators
async function analyze(userMessage, conversationHistory = [], llmClient = null) {
  const lowerMessage = userMessage.toLowerCase();

  // Check for extreme crisis indicators
  for (const indicator of crisisIndicators.EXTREME.keywords) {
    if (lowerMessage.includes(indicator)) {
      return {
        isCrisis: true,
        severity: "EXTREME",
        response: generateCrisisResponse("EXTREME"),
        resources: crisisResources,
      };
    }
  }

  // Check for severe crisis indicators
  for (const indicator of crisisIndicators.SEVERE.keywords) {
    if (lowerMessage.includes(indicator)) {
      return {
        isCrisis: true,
        severity: "SEVERE",
        response: generateCrisisResponse("SEVERE"),
        resources: crisisResources,
      };
    }
  }

  // Check for high-risk indicators
  for (const indicator of crisisIndicators.HIGH.keywords) {
    if (lowerMessage.includes(indicator)) {
      // Check conversation history for escalation pattern
      if (isEscalating(conversationHistory, lowerMessage)) {
        return {
          isCrisis: true,
          severity: "HIGH",
          response: generateCrisisResponse("HIGH"),
          resources: crisisResources,
        };
      }
    }
  }

  // Check for self-harm indicators
  if (
    /cutting|self.harm|blood|wound|knife|razor/i.test(userMessage) &&
    /active|now|tonight|today/i.test(userMessage)
  ) {
    return {
      isCrisis: true,
      severity: "HIGH",
      response: generateCrisisResponse("SELF_HARM"),
      resources: crisisResources,
    };
  }

  // Check for harm to others
  if (/want to hurt|going to hurt|kill|harm|attack/i.test(userMessage)) {
    const hasTarget = /someone|them|my partner|my friend|my family/i.test(
      userMessage
    );
    if (hasTarget && /plan|tonight|soon|going to/i.test(userMessage)) {
      return {
        isCrisis: true,
        severity: "EXTREME",
        response: generateCrisisResponse("HARM_TO_OTHERS"),
        resources: crisisResources,
      };
    }
  }

  // ============================================
  // SEMANTIC FALLBACK: keyword lists miss paraphrased,
  // sarcastic, or indirect expressions of crisis intent.
  // If a client is provided, ask the model itself to judge.
  // Only spend an extra API call on messages with some risk-adjacent
  // signal — running this on every single message (e.g. "hi", "thanks")
  // wastes quota for near-zero added safety coverage.
  // ============================================
  const riskAdjacentPattern =
    /die|death|dying|hurt|harm|pain|hopeless|empty|numb|alone|worthless|burden|tired of|can'?t (take|do|go on)|give up|no point|end (it|things|this)|disappear|goodbye|won'?t be (here|around)|better off|sorry for everything/i;

  if (llmClient && riskAdjacentPattern.test(userMessage)) {
    const semanticResult = await semanticCrisisCheck(
      llmClient,
      userMessage,
      conversationHistory
    );
    if (semanticResult.isCrisis) {
      return {
        isCrisis: true,
        severity: semanticResult.severity,
        response: generateCrisisResponse(semanticResult.severity),
        resources: crisisResources,
        detectionMethod: "semantic",
        reasoning: semanticResult.reasoning,
      };
    }
  }

  // No crisis detected
  return {
    isCrisis: false,
    severity: "NONE",
  };
}

// Uses the LLM as a semantic safety net for indirect/paraphrased crisis language
// that keyword matching cannot catch (e.g. "I won't be around much longer",
// "I've made my peace with how this ends", sarcasm masking real intent).
async function semanticCrisisCheck(llmClient, userMessage, conversationHistory, attempt = 1) {
  try {
    const recentContext = conversationHistory
      .slice(-6)
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    const classifierSystemPrompt = `You are a clinical risk classifier. Given a message (and optional recent context), decide if it indicates active risk of suicide, self-harm, or harm to others — including indirect, euphemistic, or paraphrased expressions that don't use obvious keywords.

Respond ONLY with strict JSON, no other text:
{"isCrisis": boolean, "severity": "EXTREME"|"SEVERE"|"HIGH"|"NONE", "reasoning": "one short clause"}

EXTREME = explicit plan/intent/means for suicide or imminent harm to others.
SEVERE = clear suicidal ideation or active self-harm urge without a stated plan.
HIGH = persistent hopelessness/burdensomeness language suggesting elevated risk.
NONE = no meaningful risk indicators.

Be sensitive to indirect language ("I won't need this anymore", "tell them I'm sorry", "it'll all be over soon") but do not over-flag ordinary sadness, frustration, or metaphorical speech ("this is killing me" about a deadline).`;

    const prompt = recentContext
      ? `Recent context:\n${recentContext}\n\nLatest message: "${userMessage}"`
      : `Message: "${userMessage}"`;

    const result = await llmClient.anthropic.messages.create({
      model: llmClient.classifierModel,
      max_tokens: 150,
      system: classifierSystemPrompt,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = result.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { isCrisis: false };

    return {
      isCrisis: !!parsed.isCrisis && parsed.severity !== "NONE",
      severity: parsed.severity || "NONE",
      reasoning: parsed.reasoning || "",
    };
  } catch (error) {
    // Daily quota errors won't resolve on retry — don't burn extra calls.
    const isQuotaError = error.status === 429;
    if (!isQuotaError && attempt < 2) {
      console.error(
        `[crisisDetection] semantic check failed (attempt ${attempt}):`,
        error.message
      );
      await new Promise((r) => setTimeout(r, 500));
      return semanticCrisisCheck(llmClient, userMessage, conversationHistory, attempt + 1);
    }
    console.error(
      "[crisisDetection] semantic check unavailable — relying on keyword layer only for this message."
    );
    return { isCrisis: false, severity: "NONE" };
  }
}

function generateCrisisResponse(type) {
  const responses = {
    EXTREME: `I hear that you're in intense pain right now, and I'm genuinely concerned about your safety. What you're feeling is real, and it matters.

I need to be direct: This moment is bigger than what I can help with alone. Please reach out to someone who can provide immediate support:

🚨 **IMMEDIATE HELP:**
• **Call 988** (US Suicide & Crisis Lifeline) - available 24/7
• **Text HOME to 741741** (Crisis Text Line)
• **Go to your nearest Emergency Room**
• **Call 911** if you're in immediate danger

🌍 **If you're outside the US:**
• Find your local crisis line: findahelpline.com

The pain you're in right now is real, but it can change. People who felt exactly like this have found their way through. You deserve that chance.

Please reach out to one of these resources right now. You don't have to do this alone.

I'll be here when you're safe. 💙`,

    SEVERE: `I hear the depth of pain in what you're sharing, and I want you to know that it matters. What you're experiencing is serious, and you deserve real support right now.

Please reach out to a crisis counselor who can be with you through this:

📞 **CRISIS SUPPORT (Available Now):**
• **Call 988** (Suicide & Crisis Lifeline) - Talk to a trained counselor
• **Text HOME to 741741** (Crisis Text Line)
• **Go to your nearest Emergency Room if you feel unsafe**

The intensity of what you're feeling right now can change. Many people who've felt exactly like this have found their way to safety and meaning again.

You deserve that. Please reach out to one of these resources.

What you're experiencing matters. You matter. 💙`,

    HIGH: `I'm hearing real pain and hopelessness in what you're saying, and I want to take that seriously. What you're experiencing deserves more than I can offer alone.

Please consider reaching out to someone trained in crisis support:

📞 **TALK TO SOMEONE WHO CAN HELP:**
• **Call 988** (Suicide & Crisis Lifeline)
• **Text HOME to 741741** (Crisis Text Line)
• **Talk to a trusted person in your life**

These feelings—as real as they are right now—can shift. And talking to someone trained to help during these moments can make a genuine difference.

You're not alone in this, even though it feels that way. 💙`,

    SELF_HARM: `I hear that you're struggling intensely right now. Self-harm often comes when the emotional pain feels unbearable. That matters, and you don't have to face it alone.

Please reach out to immediate support:

📞 **CRISIS SUPPORT:**
• **Call 988** (Suicide & Crisis Lifeline)
• **Text HOME to 741741** (Crisis Text Line)
• **Go to your nearest Emergency Room**

There are other ways to work with these feelings that can actually help. A counselor or therapist trained in this can teach you skills that work.

Please reach out. You deserve support that actually helps. 💙`,

    HARM_TO_OTHERS: `I'm taking what you're saying seriously. If you're having thoughts of harming someone, this requires immediate professional intervention—not because you're bad, but because you need real support right now.

**Please reach out immediately:**
• **Call 911** (if anyone is in immediate danger)
• **Call the Crisis Text Line: Text HOME to 741741**
• **Go to your nearest Emergency Room**
• **Call 988** to speak with a counselor about these thoughts

These thoughts, as frightening as they are, can be addressed with proper help. Many people have had them and gotten better. You're not alone.

Please reach out to emergency services or a mental health professional right now. 🆘`,
  };

  return responses[type] || responses.SEVERE;
}

function isEscalating(history, currentMessage) {
  if (history.length < 4) return false;

  const recentMessages = history.slice(-4);
  let escalationScore = 0;

  // Check if distress language is increasing
  const distressKeywords = [
    "hopeless",
    "pain",
    "die",
    "end",
    "unbearable",
    "pointless",
  ];

  recentMessages.forEach((msg) => {
    if (msg.role === "user") {
      distressKeywords.forEach((keyword) => {
        if (msg.content.toLowerCase().includes(keyword)) {
          escalationScore++;
        }
      });
    }
  });

  return escalationScore >= 2;
}

function detectSentiment(text) {
  const lowerText = text.toLowerCase();

  const emotionalWords = {
    desperate: [
      "desperate",
      "hopeless",
      "pointless",
      "unbearable",
      "suffocating",
    ],
    severe_pain: ["intense", "overwhelming", "excruciating", "agony", "torture"],
    suicidal: [
      "suicidal",
      "want to die",
      "kill myself",
      "end it",
      "final",
      "goodbye",
    ],
    depressed: [
      "depressed",
      "empty",
      "numb",
      "dark",
      "black",
      "void",
      "nothing matters",
    ],
    anxious: [
      "anxious",
      "scared",
      "terrified",
      "panic",
      "afraid",
      "nervous",
      "overwhelmed",
    ],
    angry: ["angry", "furious", "rage", "furious", "livid", "bitter"],
    sad: ["sad", "grief", "heartbroken", "devastated", "miserable", "unhappy"],
    hopeful: [
      "better",
      "improving",
      "helping",
      "grateful",
      "trying",
      "hope",
      "healing",
    ],
  };

  for (const [emotion, keywords] of Object.entries(emotionalWords)) {
    if (keywords.some((word) => lowerText.includes(word))) {
      return emotion;
    }
  }

  return "neutral";
}

module.exports = {
  analyze,
  generateCrisisResponse,
  isEscalating,
  detectSentiment,
  crisisResources,
};
