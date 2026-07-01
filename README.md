# AnVAI - Advanced Emotional Intelligence AI Agent

A production-ready emotional support AI companion that provides therapeutic conversation with crisis detection and safety protocols.

## 🧠 What is AnVAI?

AnVAI is a deeply trained emotional intelligence companion designed to:

- **Listen without judgment** to people experiencing emotional pain
- **Provide psychological safety** through therapeutic conversation
- **Detect and respond to crises** with immediate safety resources
- **Understand emotional complexity** (trauma, grief, anxiety, depression, etc.)
- **Bridge the gap** for people afraid to seek professional help initially

### Important Disclaimer

AnVAI is **NOT a replacement for licensed mental health professionals**. It is designed as:
- A companion for emotional support and exploration
- A bridge to professional care
- A safe space when therapy access is limited

If someone is in crisis, AnVAI will detect it and immediately provide emergency resources.

---

## 🚀 Quick Start

### Prerequisites

- Node.js 16+ (download from https://nodejs.org/)
- npm (comes with Node.js)
- Anthropic API Key (get from https://console.anthropic.com/)

### Installation

1. **Navigate to the anvai folder:**

```bash
cd anvai
```

2. **Install dependencies:**

```bash
npm install
```

3. **Create .env file:**

```bash
cp .env.example .env
```

4. **Add your Anthropic API key to .env:**

```
ANTHROPIC_API_KEY=your_api_key_here
PORT=3000
NODE_ENV=development
CRISIS_REGION=US
```

### Run the Agent

**Development mode (with auto-reload):**

```bash
npm run dev
```

**Production mode:**

```bash
npm start
```

Open http://localhost:3000 in your browser.

---

## 📁 Project Structure

```
anvai/
├── server.js                    # Main Express server & API
├── systemPrompt.js              # Therapeutic system prompt
├── crisisDetection.js           # Crisis detection & safety
├── emotionalAnalyzer.js         # Emotional state analysis
├── package.json                 # Dependencies
├── .env.example                 # Environment template
├── README.md                    # This file
└── public/
    ├── index.html               # Chat interface
    ├── styles.css               # UI styling
    └── script.js                # Frontend logic
```

---

## 🔑 Core Features

### 1. Crisis Detection

The agent monitors conversations for crisis indicators:

- **EXTREME**: Explicit suicidal ideation with plan/intent
- **SEVERE**: Strong suicidal thoughts, self-harm urges
- **HIGH**: Persistent hopelessness, escalating distress
- **SELF-HARM**: Active self-injury behavior
- **HARM-TO-OTHERS**: Thoughts of harming someone

When crisis is detected:
- Immediate validation of pain
- Clear, compassionate response
- Emergency resources (988, Crisis Text Line, etc.)
- Encouragement to contact emergency services

### 2. Emotional Analysis

The system analyzes every message for:
- **Primary emotions**: Abandonment, shame, trauma, depression, anxiety, grief, anger, guilt, hope, confusion
- **Emotional intensity**: 1-10 scale
- **Defense mechanisms**: Rationalization, intellectualization, minimization, etc.
- **Dissociation level**: Numbness/disconnection detection
- **Emotional trajectory**: Escalating vs. improving

### 3. Therapeutic Conversation

The agent draws from multiple therapeutic modalities:

- **Psychodynamic**: Exploring root causes and patterns
- **CBT**: Identifying and examining thought patterns
- **Somatic**: Body-based awareness and regulation
- **ACT**: Values alignment and committed action
- **Narrative**: Helping reframe their story

### 4. Safety Layer

Automatic safety measures:
- Multi-level crisis detection
- Real-time resource provision
- Session-level conversation history (in-memory)
- Clear limitations stated upfront
- Regular transparency about being an AI

---

## 📡 API Endpoints

### POST `/api/session/new`

Start a new conversation session.

**Response:**
```json
{
  "sessionId": "1719792000000",
  "message": "Hi there. I'm AnVAI..."
}
```

### POST `/api/chat`

Send a message and receive a therapeutic response.

**Request:**
```json
{
  "sessionId": "1719792000000",
  "userMessage": "I've been feeling hopeless lately..."
}
```

**Response:**
```json
{
  "sessionId": "1719792000000",
  "response": "That sounds deeply painful...",
  "emotionalState": {
    "primaryEmotions": [
      {
        "emotion": "depression",
        "description": "Depression & Hopelessness",
        "confidence": 85
      }
    ],
    "emotionalIntensity": 7,
    "defenseMechanisms": [],
    "dissociationLevel": 2,
    "emotionalTrajectory": "stable"
  },
  "isCrisis": false
}
```

### GET `/api/session/:sessionId/summary`

Get session summary and themes.

**Response:**
```json
{
  "sessionId": "1719792000000",
  "messageCount": 12,
  "themes": ["abandonment", "shame", "grief"],
  "emotionalTrajectory": [...],
  "startTime": "2024-06-30T12:00:00Z"
}
```

---

## 🎯 Customization

### Change Crisis Resources

Edit `crisisDetection.js`, update the `crisisResources` object:

```javascript
const crisisResources = {
  YOUR_REGION: {
    phone: "+1-XXX-XXX-XXXX",
    text: "Text to this number",
    website: "https://...",
  },
};
```

Then update `.env`:
```
CRISIS_REGION=YOUR_REGION
```

### Modify Therapeutic Approach

Edit `systemPrompt.js`:
- Change therapeutic frameworks
- Adjust communication style
- Customize prompts for specific populations

### Add New Emotion Keywords

Edit `emotionalAnalyzer.js`, add to `emotionalVocabulary`:

```javascript
custom_emotion: {
  keywords: ["word1", "word2", "word3"],
  description: "Custom Emotion Description",
}
```

---

## 🔒 Privacy & Security

### Current Implementation

- Conversations stored **in-memory only** (cleared on server restart)
- No data persistence to database
- No user tracking or logging
- API key stored locally in `.env` (not in code)

### Production Recommendations

1. **Add Database**: Use PostgreSQL + Supabase for conversation history
2. **Encryption**: Encrypt messages at rest and in transit
3. **HIPAA Compliance**: If handling healthcare data
4. **Rate Limiting**: Prevent abuse with request limits
5. **Authentication**: Add user auth (OAuth, JWT)
6. **Monitoring**: Log crisis incidents for follow-up
7. **Backups**: Regular backups of conversation data

Example database schema:
```sql
CREATE TABLE conversations (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  session_id TEXT,
  user_message TEXT,
  agent_response TEXT,
  emotional_state JSONB,
  is_crisis BOOLEAN,
  created_at TIMESTAMP
);
```

---

## 📊 Monitoring & Logging

Add crisis monitoring (production):

```javascript
// In server.js
if (crisisAnalysis.isCrisis) {
  // Log to monitoring service
  console.log(`[CRISIS] Severity: ${crisisAnalysis.severity}`);
  
  // Send alert to admin
  await notifyAdmins({
    severity: crisisAnalysis.severity,
    timestamp: new Date(),
    sessionId: sessionId
  });
  
  // Store for follow-up
  await saveCrisisEvent({
    sessionId,
    severity: crisisAnalysis.severity,
    message: userMessage
  });
}
```

---

## 🧪 Testing

### Test Crisis Detection

Send messages like:
- "I'm thinking about killing myself"
- "I want to cut myself tonight"
- "I'm going to hurt myself"

Verify that:
- Crisis alert appears
- Resources display correctly
- Agent provides compassionate response

### Test Emotional Analysis

Send various messages and check:
- Correct emotions detected
- Intensity level accurate
- Emotional state updates in UI

### Manual Testing Checklist

- [ ] New session starts correctly
- [ ] Messages send and receive responses
- [ ] Emotional state displays
- [ ] Crisis detection triggers appropriately
- [ ] Download transcript works
- [ ] UI responsive on mobile
- [ ] Long conversations work smoothly

---

## 🚨 Crisis Protocols

### Your Responsibilities

As the deployer of this agent, you have ethical obligations:

1. **Clear Disclaimers**: Always state this is an AI, not a therapist
2. **Resource Provision**: Maintain updated crisis resources
3. **Monitoring**: Review crisis events regularly
4. **Follow-up**: Consider implementing follow-up protocols
5. **Legal Compliance**: Understand liability in your jurisdiction
6. **Accessibility**: Ensure resources are accessible to all
7. **Updates**: Keep crisis resources current

### Crisis Response Best Practices

- Never minimize: "That must be incredibly painful"
- Validate emotion: "Your feelings make sense given..."
- Don't promise solutions: Avoid "Everything will be okay"
- Encourage professional help: "A therapist could really help with this"
- Provide immediate resources: Clear, actionable crisis contacts
- Document everything: For follow-up and improvement

---

## 🔧 Troubleshooting

### "Cannot find module '@anthropic-ai/sdk'"

```bash
npm install @anthropic-ai/sdk
```

### "ANTHROPIC_API_KEY is not set"

Check your `.env` file:
```bash
cat .env
```

Should contain:
```
ANTHROPIC_API_KEY=sk-ant-...
```

### Server won't start on port 3000

The port is in use. Change in `.env`:
```
PORT=3001
```

### Frontend doesn't connect to backend

Check:
1. Backend is running on correct port
2. No CORS errors in console
3. API endpoints match (check `apiUrl` in `script.js`)

### Crisis detection not working

Check `crisisDetection.js`:
1. Keywords are lowercase
2. Regex patterns are correct
3. Severity levels assigned properly

---

## 📈 Scaling Considerations

### For Small Scale (1-10 concurrent users)

Current architecture is fine. Just ensure:
- Monitoring for crashes
- Regular backups if you add database
- Crisis alerts working

### For Medium Scale (10-100 users)

Add:
- PostgreSQL database
- Redis for session management
- Load balancer (nginx)
- Monitoring (Sentry, LogRocket)

### For Large Scale (100+ users)

Use:
- Kubernetes deployment
- Database replication
- CDN for static files
- API rate limiting
- Professional monitoring
- 24/7 crisis response team

---

## 📚 Resources for Developers

### Understanding Emotional Trauma

- "The Body Keeps the Score" - Van der Kolk
- "What Happened to You?" - Bruce Perry
- "Emotional Intelligence" - Daniel Goleman

### Therapeutic Techniques

- CBT: Beck & Clark
- ACT: Hayes, Strosahl, Wilson
- Somatic: Levine, van der Kolk
- Psychodynamic: Kernberg, Vaillant

### Crisis Intervention

- "Crisis Intervention Team (CIT) Training"
- "Mental Health First Aid"
- SAMHSA Crisis Resources

---

## 🤝 Contributing

### How to Improve AnVAI

1. Test the agent thoroughly
2. Document issues/improvements
3. Enhance emotional vocabulary
4. Improve crisis detection accuracy
5. Add therapeutic techniques
6. Better UI/UX for vulnerable users
7. Multi-language support

### Areas for Development

- [ ] Persistent conversation history
- [ ] User authentication
- [ ] Follow-up protocols
- [ ] Therapist referral system
- [ ] Progress tracking
- [ ] Coping strategy library
- [ ] Community features (peer support)
- [ ] Mobile app
- [ ] Multi-language support

---

## 📞 Emergency Resources

### Immediate Help

**United States:**
- 988 Suicide & Crisis Lifeline (call/text)
- Crisis Text Line: Text HOME to 741741
- Emergency: 911

**India:**
- aAsra: +91-22-2754 6669
- iCall: +91-96 5033 6262
- Vandrevala Foundation: +91-9999 666 555

**United Kingdom:**
- Samaritans: 116 123
- Mind: 0300 123 3393

**Find Your Country:**
- findahelpline.com

---

## 📄 License

This project is provided as-is for educational and support purposes.

---

## ⚠️ Final Note

This agent is a **bridge to care, not a replacement for professional help**. Always encourage users to seek licensed mental health support. Your responsibility as a deployer includes:

- Maintaining accuracy of crisis resources
- Monitoring for system failures
- Ethical use of emotional data
- Compliance with local regulations
- Transparency about limitations

Build with compassion. Deploy responsibly.

💙

---

**Questions? Issues? Improvements?**

This is a living project. Test it, improve it, and help it save lives.

