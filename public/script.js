// script.js - Frontend logic for anvAI

const AVATAR_SVG = `<svg width="34" height="34" viewBox="-2 -2 44 44" xmlns="http://www.w3.org/2000/svg">
  <circle cx="20" cy="20" r="20" fill="#F5E6DC"/>
  <polyline points="3,20 8,20 11,11 15,29 18.5,20 21,15.5 23,20 37,20" fill="none" stroke="#D97756" stroke-opacity="0.18" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  <polyline points="3,20 8,20 11,11 15,29 18.5,20 21,15.5 23,20 37,20" fill="none" stroke="#D97756" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" pathLength="100" stroke-dasharray="100">
    <animate attributeName="stroke-dashoffset" from="100" to="-100" dur="1.6s" repeatCount="indefinite"/>
  </polyline>
  <circle cx="21" cy="15.5" r="1.5" fill="#6B3A54"/>
</svg>`;

class anvAIClient {
  constructor() {
    this.sessionId = null;
    this.conversationHistory = [];
    this.isWaitingForResponse = false;
    this.apiUrl = "/api";

    this.elements = {
      messagesContainer: document.getElementById("messages"),
      userInput: document.getElementById("userInput"),
      sendBtn: document.getElementById("sendBtn"),
      chatContainer: document.getElementById("messages").parentElement,
      emotionalState: document.getElementById("emotionalState"),
      emotionsList: document.getElementById("emotionsList"),
      intensityFill: document.getElementById("intensityFill"),
      intensityValue: document.getElementById("intensityValue"),
      crisisAlert: document.getElementById("crisisAlert"),
      crisisMessage: document.getElementById("crisisMessage"),
      sessionId: document.getElementById("sessionId"),
      newSessionBtn: document.getElementById("newSessionBtn"),
      downloadBtn: document.getElementById("downloadBtn"),
    };

    this.init();
  }

  // Initialize the agent
  async init() {
    console.log("🧠 anvAI Initializing...");

    // Start new session
    await this.startNewSession();

    // Setup event listeners
    this.setupEventListeners();
  }

  // Setup all event listeners
  setupEventListeners() {
    this.elements.sendBtn.addEventListener("click", () => this.sendMessage());
    this.elements.userInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    this.elements.newSessionBtn.addEventListener("click", () =>
      this.startNewSession()
    );
    this.elements.downloadBtn.addEventListener("click", () =>
      this.downloadTranscript()
    );
  }

  // Start a new conversation session
  async startNewSession() {
    try {
      const response = await fetch(`${this.apiUrl}/session/new`, {
        method: "POST",
      });

      const data = await response.json();
      this.sessionId = data.sessionId;

      // Update UI
      this.elements.sessionId.textContent = `Session: ${this.sessionId.slice(-6)}`;
      this.conversationHistory = [];
      this.clearMessages();
      this.hideEmotionalState();
      this.hideCrisisAlert();

      console.log(`✅ New session started: ${this.sessionId}`);

      // Show welcome message
      this.addMessage(
        data.message,
        "assistant",
        null
      );
    } catch (error) {
      console.error("Error starting session:", error);
      this.showError("Failed to start new session. Please refresh the page.");
    }
  }

  // Send message to the agent
  async sendMessage() {
    const userMessage = this.elements.userInput.value.trim();

    if (!userMessage) {
      this.elements.userInput.focus();
      return;
    }

    if (this.isWaitingForResponse) {
      return;
    }

    // Clear input and disable send
    this.elements.userInput.value = "";
    this.elements.sendBtn.classList.add("loading");
    this.elements.sendBtn.disabled = true;
    this.isWaitingForResponse = true;

    // Add user message to display
    this.addMessage(userMessage, "user", null);

    // Show typing indicator
    const typingId = this.addTypingIndicator();
    this.announce("anvAI is thinking…");

    try {
      const response = await fetch(`${this.apiUrl}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId: this.sessionId,
          userMessage: userMessage,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      // Remove typing indicator
      this.removeMessage(typingId);
      this.announce("anvAI responded");

      // Check for crisis
      if (data.isCrisis) {
        this.showCrisisAlert(data);
        this.addMessage(data.response, "assistant", {
          isCrisis: true,
          severity: data.severity,
        });
      } else {
        // Add agent response
        this.addMessage(data.response, "assistant", {
          emotionalState: data.emotionalState,
        });

        // Update emotional state display
        if (data.emotionalState) {
          this.updateEmotionalState(data.emotionalState);
        }
      }

      // Scroll to bottom
      this.scrollToBottom();
    } catch (error) {
      console.error("Error:", error);
      this.removeMessage(typingId);
      this.showError(
        "Unable to connect. Please check your connection and try again."
      );
    } finally {
      this.elements.sendBtn.classList.remove("loading");
      this.elements.sendBtn.disabled = false;
      this.isWaitingForResponse = false;
      this.elements.userInput.focus();
    }
  }

  // Add message to chat
  addMessage(content, role, metadata = null) {
    const messageGroup = document.createElement("div");
    messageGroup.className = `message-group ${role}`;

    const message = document.createElement("div");
    message.className = `message ${role}`;

    // Avatar
    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    if (role === "user") {
      avatar.textContent = "💙";
    } else {
      avatar.innerHTML = AVATAR_SVG;
    }

    // Content
    const contentDiv = document.createElement("div");
    contentDiv.className = "message-content";

    // Add crisis styling if needed
    if (metadata?.isCrisis) {
      message.classList.add("crisis-message");
    }

    // Parse content (handle line breaks)
    const paragraphs = content.split("\n\n");
    paragraphs.forEach((para) => {
      const p = document.createElement("p");
      p.textContent = para;
      contentDiv.appendChild(p);
    });

    message.appendChild(avatar);
    message.appendChild(contentDiv);
    messageGroup.appendChild(message);

    // Generate unique ID
    const id = `msg-${Date.now()}-${Math.random()}`;
    messageGroup.id = id;

    this.elements.messagesContainer.appendChild(messageGroup);
    this.scrollToBottom();

    return id;
  }

  // Add typing indicator
  addTypingIndicator() {
    const messageGroup = document.createElement("div");
    messageGroup.className = "message-group assistant";

    const message = document.createElement("div");
    message.className = "message assistant loading";

    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.innerHTML = AVATAR_SVG;

    const contentDiv = document.createElement("div");
    contentDiv.className = "message-content";

    const typingDiv = document.createElement("div");
    typingDiv.className = "typing-indicator";

    for (let i = 0; i < 3; i++) {
      const dot = document.createElement("div");
      dot.className = "typing-dot";
      typingDiv.appendChild(dot);
    }

    contentDiv.appendChild(typingDiv);
    message.appendChild(avatar);
    message.appendChild(contentDiv);
    messageGroup.appendChild(message);

    const id = `typing-${Date.now()}`;
    messageGroup.id = id;

    this.elements.messagesContainer.appendChild(messageGroup);
    this.scrollToBottom();

    return id;
  }

  // Remove message by ID
  removeMessage(id) {
    const element = document.getElementById(id);
    if (element) {
      element.remove();
    }
  }

  // Update emotional state display
  updateEmotionalState(emotionalState) {
    if (!emotionalState || !emotionalState.primaryEmotions) {
      this.hideEmotionalState();
      return;
    }

    // Update emotions list
    this.elements.emotionsList.innerHTML = "";
    emotionalState.primaryEmotions.forEach((emotion) => {
      const tag = document.createElement("span");
      tag.className = "emotion-tag";
      tag.textContent = `${emotion.description} (${emotion.confidence}%)`;
      this.elements.emotionsList.appendChild(tag);
    });

    // Update intensity bar (elements may not exist on all pages)
    const intensity = emotionalState.emotionalIntensity || 0;
    const percentage = (intensity / 10) * 100;
    if (this.elements.intensityFill) this.elements.intensityFill.style.width = `${percentage}%`;
    if (this.elements.intensityValue) this.elements.intensityValue.textContent = intensity;

    // Show emotional state section
    if (this.elements.emotionalState) this.elements.emotionalState.classList.remove("hidden");
  }

  // Hide emotional state display
  hideEmotionalState() {
    this.elements.emotionalState.classList.add("hidden");
  }

  // Show crisis alert
  showCrisisAlert(data) {
    if (data.resources && data.resources.US) {
      const lines = [];
      lines.push(`🚨 Severity: ${data.severity}`);
      lines.push(data.resources.US.national_suicide_prevention_lifeline);
      lines.push(data.resources.US.crisis_text_line);

      this.elements.crisisMessage.innerHTML = lines.join("<br>");
    }

    this.elements.crisisAlert.classList.remove("hidden");

    // Auto-scroll to crisis alert
    setTimeout(() => {
      this.elements.crisisAlert.scrollIntoView({ behavior: "smooth" });
    }, 100);
  }

  // Hide crisis alert
  hideCrisisAlert() {
    this.elements.crisisAlert.classList.add("hidden");
  }

  // Scroll to bottom of chat
  scrollToBottom() {
    this.elements.chatContainer.scrollTop =
      this.elements.chatContainer.scrollHeight;
  }

  // Clear all messages
  clearMessages() {
    this.elements.messagesContainer.innerHTML = "";
  }

  // Show error message
  showError(message) {
    const errorDiv = document.createElement("div");
    errorDiv.className = "message-group error-message";

    const p = document.createElement("p");
    p.textContent = `⚠️ ${message}`;

    errorDiv.appendChild(p);
    this.elements.messagesContainer.appendChild(errorDiv);
    this.scrollToBottom();
  }

  // Announce to screen readers via aria-live region
  announce(text) {
    const el = document.getElementById("srStatus");
    if (!el) return;
    el.textContent = "";
    requestAnimationFrame(() => { el.textContent = text; });
  }

  // Download conversation transcript
  downloadTranscript() {
    // Get messages from DOM
    const messages = document.querySelectorAll(".message-group");
    let transcript = "anvAI - Emotional Support Conversation Transcript\n";
    transcript += `Session: ${this.sessionId}\n`;
    transcript += `Date: ${new Date().toLocaleString()}\n`;
    transcript += "=".repeat(60) + "\n\n";

    messages.forEach((group) => {
      const isUser = group.classList.contains("user");
      const role = isUser ? "You" : "anvAI";
      const content = group.querySelector(".message-content").textContent;

      transcript += `${role}:\n${content}\n\n`;
    });

    // Create download link
    const element = document.createElement("a");
    element.setAttribute(
      "href",
      "data:text/plain;charset=utf-8," + encodeURIComponent(transcript)
    );
    element.setAttribute(
      "download",
      `anvai-transcript-${this.sessionId}.txt`
    );
    element.style.display = "none";

    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  }
}

// Initialize on page load
document.addEventListener("DOMContentLoaded", () => {
  new anvAIClient();
});
