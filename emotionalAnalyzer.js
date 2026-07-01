// emotionalAnalyzer.js - Analyzes emotional state and patterns

const emotionalVocabulary = {
  abandonment: {
    keywords: [
      "alone",
      "abandoned",
      "left",
      "lonely",
      "isolated",
      "forgotten",
      "unwanted",
      "rejected",
      "nobody",
      "excluded",
    ],
    description: "Abandonment & Isolation",
  },
  shame: {
    keywords: [
      "ashamed",
      "worthless",
      "embarrassed",
      "stupid",
      "failure",
      "defective",
      "broken",
      "shameful",
      "unlovable",
      "disgusting",
    ],
    description: "Shame & Unworthiness",
  },
  trauma: {
    keywords: [
      "scared",
      "terrified",
      "traumatized",
      "triggered",
      "flashback",
      "nightmare",
      "terror",
      "violated",
      "unsafe",
      "threatened",
    ],
    description: "Trauma & Fear",
  },
  depression: {
    keywords: [
      "hopeless",
      "pointless",
      "empty",
      "numb",
      "dark",
      "depressed",
      "void",
      "meaningless",
      "lifeless",
    ],
    description: "Depression & Hopelessness",
  },
  anxiety: {
    keywords: [
      "anxious",
      "worried",
      "nervous",
      "panic",
      "overwhelmed",
      "stressed",
      "tense",
      "restless",
      "fearful",
      "uneasy",
    ],
    description: "Anxiety & Worry",
  },
  grief: {
    keywords: [
      "grief",
      "loss",
      "miss",
      "mourn",
      "bereaved",
      "gone",
      "died",
      "death",
      "heartbreak",
      "devastated",
    ],
    description: "Grief & Loss",
  },
  anger: {
    keywords: [
      "angry",
      "furious",
      "rage",
      "livid",
      "bitter",
      "resentful",
      "hateful",
      "hostile",
      "aggressive",
    ],
    description: "Anger & Resentment",
  },
  guilt: {
    keywords: [
      "guilty",
      "blame",
      "responsible",
      "fault",
      "wrong",
      "regret",
      "remorse",
      "conscience",
    ],
    description: "Guilt & Responsibility",
  },
  hopeful: {
    keywords: [
      "hope",
      "better",
      "improving",
      "grateful",
      "grateful",
      "positive",
      "healing",
      "trying",
      "strength",
      "stronger",
    ],
    description: "Hope & Resilience",
  },
  confusion: {
    keywords: [
      "confused",
      "lost",
      "uncertain",
      "unclear",
      "mixed",
      "don't understand",
      "stuck",
      "trapped",
    ],
    description: "Confusion & Uncertainty",
  },
};

// Analyze emotional state from message
async function analyze(userMessage, conversationHistory = []) {
  const lowerMessage = userMessage.toLowerCase();
  const detectedEmotions = [];
  const emotionalIntensity = calculateIntensity(userMessage);

  // Detect primary emotions
  for (const [emotionType, data] of Object.entries(emotionalVocabulary)) {
    const matchCount = data.keywords.filter((keyword) =>
      lowerMessage.includes(keyword)
    ).length;

    if (matchCount > 0) {
      detectedEmotions.push({
        emotion: emotionType,
        description: data.description,
        confidence: Math.min(100, matchCount * 15),
      });
    }
  }

  // Sort by confidence
  detectedEmotions.sort((a, b) => b.confidence - a.confidence);

  // Analyze conversation trajectory
  const emotionalTrajectory = analyzeTrajectory(conversationHistory);

  // Detect defense mechanisms
  const defenseMechanisms = detectDefenses(userMessage);

  // Assess dissociation/numbness
  const dissociationLevel = assessDissociation(userMessage);

  return {
    primaryEmotions: detectedEmotions.slice(0, 3), // Top 3 emotions
    emotionalIntensity,
    defenseMechanisms,
    dissociationLevel,
    emotionalTrajectory,
    timestamp: new Date(),
    isNumbered: dissociationLevel > 6,
    isPressedDown: emotionalIntensity > 7,
  };
}

function calculateIntensity(message) {
  let intensity = 3; // baseline

  // Intensity indicators
  const intensityKeywords = {
    9: [
      "unbearable",
      "excruciating",
      "agony",
      "dying",
      "suffocating",
      "torture",
      "hell",
    ], // Extreme
    8: [
      "intense",
      "overwhelming",
      "devastating",
      "crushing",
      "breaking",
      "destroyed",
    ], // Very high
    7: [
      "terrible",
      "awful",
      "horrible",
      "severe",
      "extreme",
      "sharp pain",
    ], // High
    6: [
      "very painful",
      "really hard",
      "deeply sad",
      "really anxious",
      "so scared",
    ], // Moderate-high
    5: ["painful", "difficult", "sad", "anxious", "worried"], // Moderate
  };

  for (const [level, keywords] of Object.entries(intensityKeywords)) {
    if (keywords.some((kw) => message.toLowerCase().includes(kw))) {
      intensity = Math.max(intensity, parseInt(level));
    }
  }

  // Check for repetition/emphasis (repeated words = higher intensity)
  const exclamations = (message.match(/!/g) || []).length;
  const allCaps = (message.match(/[A-Z]{3,}/g) || []).length;

  intensity += Math.min(2, exclamations / 2);
  intensity += Math.min(2, allCaps / 2);

  return Math.min(10, Math.round(intensity));
}

function analyzeTrajectory(history) {
  if (history.length < 2) return "beginning";

  const lastThreeUserMessages = history
    .filter((msg) => msg.role === "user")
    .slice(-3)
    .map((msg) => msg.content.toLowerCase());

  if (lastThreeUserMessages.length < 2) return "beginning";

  // Simple trend analysis
  const intensities = lastThreeUserMessages.map((msg) =>
    calculateIntensity(msg)
  );

  const trend = intensities[intensities.length - 1] - intensities[0];

  if (trend > 2) return "escalating";
  if (trend < -2) return "improving";
  return "stable";
}

function detectDefenses(message) {
  const defenses = [];
  const lowerMessage = message.toLowerCase();

  const defensePatterns = {
    rationalization: [
      "but logically",
      "it makes sense that",
      "i should be over this",
      "it's not that bad",
    ],
    intellectualization: [
      "i understand why",
      "the thing is",
      "it's just",
      "technically",
    ],
    minimization: ["it's fine", "not a big deal", "could be worse", "i'm okay"],
    projection: [
      "they're the ones",
      "they make me",
      "it's their fault",
      "they should",
    ],
    dissociation: [
      "i don't feel anything",
      "i'm numb",
      "it doesn't matter",
      "none of it feels real",
    ],
  };

  for (const [defense, keywords] of Object.entries(defensePatterns)) {
    if (keywords.some((kw) => lowerMessage.includes(kw))) {
      defenses.push(defense);
    }
  }

  return defenses;
}

function assessDissociation(message) {
  let dissociationScore = 0;

  const dissociativeLanguage = [
    "numb",
    "empty",
    "disconnected",
    "doesn't feel real",
    "floating",
    "outside myself",
    "watching myself",
    "detached",
    "can't feel",
    "nothing matters",
  ];

  dissociativeLanguage.forEach((word) => {
    if (message.toLowerCase().includes(word)) {
      dissociationScore += 2;
    }
  });

  // Check for lack of emotional language in general
  const hasEmotionalWords = /feel|felt|feeling|sad|happy|angry|scared|love|hate/i.test(
    message
  );
  if (!hasEmotionalWords && message.length > 50) {
    dissociationScore += 1;
  }

  return Math.min(10, dissociationScore);
}

function detectSentiment(text) {
  const lowerText = text.toLowerCase();

  const sentiments = {
    desperate:
      "desperate|hopeless|pointless|unbearable|suffocating|can't go on",
    severe_pain: "intense|overwhelming|excruciating|agony|torture",
    suicidal:
      "suicidal|want to die|kill myself|end it|final|goodbye|not here",
    depressed:
      "depressed|empty|numb|dark|black|void|nothing matters|lifeless",
    anxious:
      "anxious|scared|terrified|panic|afraid|nervous|overwhelmed|worried",
    angry: "angry|furious|rage|livid|bitter|resentful|hateful",
    sad:
      "sad|grief|heartbroken|devastated|miserable|unhappy|mourning|loss",
    hopeful:
      "better|improving|helping|grateful|trying|hope|healing|strength|stronger",
  };

  for (const [sentiment, regex] of Object.entries(sentiments)) {
    if (new RegExp(regex).test(lowerText)) {
      return sentiment;
    }
  }

  return "neutral";
}

module.exports = {
  analyze,
  calculateIntensity,
  analyzeTrajectory,
  detectDefenses,
  assessDissociation,
  detectSentiment,
};
