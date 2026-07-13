// script.js - Frontend logic for anvAI

const AVATAR_SVG = `<svg width="34" height="34" viewBox="-2 -2 44 44" xmlns="http://www.w3.org/2000/svg">
  <circle cx="20" cy="20" r="20" fill="#F5E6DC"/>
  <polyline points="3,20 8,20 11,11 15,29 18.5,20 21,15.5 23,20 37,20" fill="none" stroke="#D97756" stroke-opacity="0.18" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  <polyline points="3,20 8,20 11,11 15,29 18.5,20 21,15.5 23,20 37,20" fill="none" stroke="#D97756" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" pathLength="100" stroke-dasharray="100">
    <animate attributeName="stroke-dashoffset" from="100" to="-100" dur="1.6s" repeatCount="indefinite"/>
  </polyline>
  <circle cx="21" cy="15.5" r="1.5" fill="#6B3A54"/>
</svg>`;

// ============================================
// Local session store — per-session message cache + recent-chats index.
// anvAI has no accounts, so "recent chats" live in this browser's
// localStorage rather than a server-side database.
// ============================================
const STORAGE_PREFIX = "anvai:";
const INDEX_KEY = STORAGE_PREFIX + "index";
const ACTIVE_KEY = STORAGE_PREFIX + "active";
const MAX_STORED_SESSIONS = 30;
const MAX_CACHED_MESSAGES = 100;

function msgsKey(id) {
  return STORAGE_PREFIX + "msgs:" + id;
}

// The GIS script tag is async/defer, so it may not be attached to `window`
// yet when our own script runs — poll briefly instead of assuming it's ready.
function waitForGoogleIdentity(timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function check() {
      if (window.google?.accounts?.id) return resolve(window.google);
      if (Date.now() - start > timeoutMs) {
        return reject(new Error("Google Identity Services failed to load."));
      }
      setTimeout(check, 100);
    })();
  });
}

const storage = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      // localStorage unavailable (private browsing / quota) — degrade silently
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      // ignore
    }
  },
};

class anvAIClient {
  constructor() {
    this.sessionId = null;
    this.conversationHistory = [];
    this.isWaitingForResponse = false;
    this.apiUrl = "/api";

    // Auth state — anvAI works fully anonymously; these stay null/false/[]
    // when sign-in isn't configured or the user hasn't signed in.
    this.authEnabled = false;
    this.user = null;
    this.serverChats = [];

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
      sidebar: document.getElementById("sidebar"),
      sidebarBackdrop: document.getElementById("sidebarBackdrop"),
      sidebarToggleBtn: document.getElementById("sidebarToggleBtn"),
      sidebarNewSessionBtn: document.getElementById("sidebarNewSessionBtn"),
      searchChatsInput: document.getElementById("searchChatsInput"),
      recentSessionsList: document.getElementById("recentSessionsList"),
      accountArea: document.getElementById("accountArea"),
      signedOutView: document.getElementById("signedOutView"),
      signedInView: document.getElementById("signedInView"),
      googleSignInBtn: document.getElementById("googleSignInBtn"),
      accountAvatar: document.getElementById("accountAvatar"),
      accountEmail: document.getElementById("accountEmail"),
      signOutBtn: document.getElementById("signOutBtn"),
    };

    this.init();
  }

  // Initialize the agent
  async init() {
    console.log("🧠 anvAI Initializing...");

    // Setup event listeners
    this.setupEventListeners();

    // Sign-in is optional — this resolves this.authEnabled / this.user and
    // renders the Google button if applicable.
    await this.initAuth();

    if (this.user) {
      await this.fetchServerChats();
      if (this.serverChats.length) {
        const mostRecent = [...this.serverChats].sort((a, b) => b.updatedAt - a.updatedAt)[0];
        await this.resumeSession(mostRecent.id);
      } else {
        await this.startNewSession();
      }
      return;
    }

    // Anonymous flow — resume the last active local session if one exists,
    // otherwise fall back to the most recently used one, otherwise start fresh.
    const activeId = storage.get(ACTIVE_KEY, null);
    const index = this.loadIndex();

    if (activeId && index.some((s) => s.id === activeId)) {
      this.resumeSession(activeId);
    } else if (index.length) {
      const mostRecent = [...index].sort((a, b) => b.updatedAt - a.updatedAt)[0];
      this.resumeSession(mostRecent.id);
    } else {
      await this.startNewSession();
    }
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

    this.elements.sidebarNewSessionBtn.addEventListener("click", () =>
      this.startNewSession()
    );
    this.elements.searchChatsInput.addEventListener("input", () =>
      this.renderSessionList()
    );
    this.elements.sidebarToggleBtn.addEventListener("click", () =>
      this.toggleSidebar()
    );
    this.elements.sidebarBackdrop.addEventListener("click", () =>
      this.closeSidebarMobile()
    );
    this.elements.signOutBtn.addEventListener("click", () => this.signOut());
  }

  // ============================================
  // Auth — Google sign-in (optional)
  // ============================================

  async initAuth() {
    try {
      const configRes = await fetch(`${this.apiUrl}/auth/config`);
      const config = await configRes.json();
      this.authEnabled = Boolean(config.enabled);

      if (!this.authEnabled) {
        this.elements.accountArea.classList.add("hidden");
        return;
      }

      this.initGoogleSignIn(config.googleClientId);

      const meRes = await fetch(`${this.apiUrl}/auth/me`, { credentials: "same-origin" });
      if (meRes.ok) {
        this.user = await meRes.json();
        this.showSignedIn();
      } else {
        this.showSignedOut();
      }
    } catch (error) {
      console.error("Auth init error:", error);
      this.authEnabled = false;
      this.elements.accountArea.classList.add("hidden");
    }
  }

  async initGoogleSignIn(clientId) {
    if (!clientId) return;
    try {
      const google = await waitForGoogleIdentity();
      google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => this.handleGoogleCredential(response),
        auto_select: false,
      });
      google.accounts.id.renderButton(this.elements.googleSignInBtn, {
        theme: "filled_black",
        size: "medium",
        shape: "pill",
        text: "signin",
        width: 220,
      });
    } catch (error) {
      console.error("Google Identity Services failed to load:", error);
    }
  }

  async handleGoogleCredential(response) {
    try {
      const res = await fetch(`${this.apiUrl}/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ idToken: response.credential }),
      });
      if (!res.ok) throw new Error("Sign-in request failed");

      this.user = await res.json();
      this.showSignedIn();
      await this.fetchServerChats();
      // Start a fresh, account-owned session rather than trying to adopt
      // whatever anonymous session was active before signing in.
      await this.startNewSession();
    } catch (error) {
      console.error("Google sign-in error:", error);
      this.showError("Sign-in failed. Please try again.");
    }
  }

  async signOut() {
    try {
      await fetch(`${this.apiUrl}/auth/logout`, { method: "POST", credentials: "same-origin" });
    } catch (error) {
      console.error("Sign-out error:", error);
    }
    try {
      window.google?.accounts?.id.disableAutoSelect();
    } catch (error) {
      // GIS not loaded — nothing to disable
    }

    this.user = null;
    this.serverChats = [];
    this.showSignedOut();
    await this.startNewSession();
  }

  showSignedIn() {
    this.elements.signedOutView.classList.add("hidden");
    this.elements.signedInView.classList.remove("hidden");
    this.elements.accountEmail.textContent = this.user.email;
    this.elements.accountEmail.title = this.user.email;
    this.elements.accountAvatar.src = this.user.picture || "";
  }

  showSignedOut() {
    this.elements.signedOutView.classList.remove("hidden");
    this.elements.signedInView.classList.add("hidden");
  }

  async fetchServerChats() {
    try {
      const res = await fetch(`${this.apiUrl}/chats`, { credentials: "same-origin" });
      if (!res.ok) {
        this.serverChats = [];
        return;
      }
      const data = await res.json();
      this.serverChats = (data.chats || []).map((c) => ({
        id: c.id,
        title: c.title,
        preview: c.preview,
        createdAt: new Date(c.created_at).getTime(),
        updatedAt: new Date(c.updated_at).getTime(),
      }));
    } catch (error) {
      console.error("fetchServerChats error:", error);
      this.serverChats = [];
    }
  }

  // ============================================
  // Session store — recent-chats index (localStorage)
  // ============================================

  loadIndex() {
    return storage.get(INDEX_KEY, []);
  }

  saveIndex(index) {
    storage.set(INDEX_KEY, index);
  }

  getCache(id) {
    return storage.get(msgsKey(id), []);
  }

  saveCache(id, messages) {
    const trimmed =
      messages.length > MAX_CACHED_MESSAGES
        ? messages.slice(-MAX_CACHED_MESSAGES)
        : messages;
    storage.set(msgsKey(id), trimmed);
  }

  addIndexEntry(entry) {
    const index = this.loadIndex();
    index.unshift(entry);
    if (index.length > MAX_STORED_SESSIONS) {
      const overflow = index.splice(MAX_STORED_SESSIONS);
      overflow.forEach((s) => storage.remove(msgsKey(s.id)));
    }
    this.saveIndex(index);
  }

  updateIndexEntry(id, patch) {
    const index = this.loadIndex();
    const i = index.findIndex((s) => s.id === id);
    if (i === -1) return;
    index[i] = { ...index[i], ...patch };
    this.saveIndex(index);
  }

  setActiveSession(id) {
    storage.set(ACTIVE_KEY, id);
  }

  // Cache a real conversation turn and refresh its session's sidebar entry.
  // Signed-in users are persisted server-side (inside /api/chat) — this just
  // re-syncs the local view of the list once that write has landed.
  async cachePush(role, content, metadata) {
    if (!this.sessionId) return;

    if (this.user) {
      if (role === "assistant") {
        await this.fetchServerChats();
        this.renderSessionList();
      }
      return;
    }

    const cache = this.getCache(this.sessionId);
    cache.push({ role, content, metadata: metadata || null, ts: Date.now() });
    this.saveCache(this.sessionId, cache);

    const index = this.loadIndex();
    const entry = index.find((s) => s.id === this.sessionId);
    if (entry) {
      const patch = { updatedAt: Date.now(), preview: this.deriveTitle(content) };
      if (role === "user" && (!entry.title || entry.title === "New chat")) {
        patch.title = this.deriveTitle(content);
      }
      this.updateIndexEntry(this.sessionId, patch);
    }
    this.renderSessionList();
  }

  deriveTitle(text) {
    const clean = text.replace(/\s+/g, " ").trim();
    if (clean.length <= 42) return clean || "New chat";
    const truncated = clean.slice(0, 42);
    const lastSpace = truncated.lastIndexOf(" ");
    return (lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated) + "…";
  }

  formatRelativeTime(ts) {
    const diffMs = Date.now() - ts;
    const min = Math.floor(diffMs / 60000);
    if (min < 1) return "just now";
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 7) return `${day}d ago`;
    return new Date(ts).toLocaleDateString();
  }

  // Render the recent-sessions list, applying the search box filter.
  // Source is the server list when signed in, the local index otherwise.
  renderSessionList() {
    const query = (this.elements.searchChatsInput.value || "").trim().toLowerCase();
    const source = this.user ? this.serverChats : this.loadIndex();
    let index = [...source].sort((a, b) => b.updatedAt - a.updatedAt);

    if (query) {
      index = index.filter(
        (s) =>
          (s.title || "").toLowerCase().includes(query) ||
          (s.preview || "").toLowerCase().includes(query)
      );
    }

    const list = this.elements.recentSessionsList;
    list.innerHTML = "";

    if (!index.length) {
      const li = document.createElement("li");
      li.className = "session-empty";
      li.textContent = query ? "No matching chats." : "No sessions yet.";
      list.appendChild(li);
      return;
    }

    index.forEach((s) => {
      const li = document.createElement("li");
      li.className = "session-item" + (s.id === this.sessionId ? " active" : "");
      li.setAttribute("role", "button");
      li.tabIndex = 0;

      const main = document.createElement("div");
      main.className = "session-item-main";

      const title = document.createElement("div");
      title.className = "session-item-title";
      title.textContent = s.title || "New chat";

      const time = document.createElement("div");
      time.className = "session-item-time";
      time.textContent = this.formatRelativeTime(s.updatedAt);

      main.appendChild(title);
      main.appendChild(time);

      const del = document.createElement("button");
      del.className = "session-item-delete";
      del.setAttribute("aria-label", "Delete session");
      del.title = "Delete";
      del.innerHTML =
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        this.deleteSession(s.id);
      });

      li.appendChild(main);
      li.appendChild(del);

      li.addEventListener("click", () => this.resumeSession(s.id));
      li.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          this.resumeSession(s.id);
        }
      });

      list.appendChild(li);
    });
  }

  // Switch the active session and repopulate the transcript from its cache
  // (local for anonymous users, server-fetched — with an ownership check
  // enforced server-side — for signed-in users).
  async resumeSession(id) {
    if (!id) return;

    this.sessionId = id;
    this.elements.sessionId.textContent = `Session: ${id.slice(-6)}`;
    this.clearMessages();
    this.hideEmotionalState();
    this.hideCrisisAlert();

    let cached = [];
    if (this.user) {
      try {
        const res = await fetch(`${this.apiUrl}/chats/${id}/messages`, { credentials: "same-origin" });
        if (res.ok) {
          const data = await res.json();
          cached = (data.messages || []).map((m) => ({
            role: m.role,
            content: m.content,
            metadata: m.metadata,
          }));
        }
      } catch (error) {
        console.error("Error loading chat history:", error);
      }
    } else {
      cached = this.getCache(id);
    }

    if (cached.length) {
      cached.forEach((m) => this.addMessage(m.content, m.role, m.metadata));
    } else {
      this.addMessage("Hey. I'm here — what's on your mind?", "assistant", null);
    }

    if (!this.user) this.setActiveSession(id);
    this.closeSidebarMobile();
    this.renderSessionList();
    this.elements.userInput.focus();
  }

  async deleteSession(id) {
    if (this.user) {
      try {
        await fetch(`${this.apiUrl}/chats/${id}`, { method: "DELETE", credentials: "same-origin" });
      } catch (error) {
        console.error("Error deleting chat:", error);
      }
      await this.fetchServerChats();
      if (id === this.sessionId) {
        if (this.serverChats.length) {
          const mostRecent = [...this.serverChats].sort((a, b) => b.updatedAt - a.updatedAt)[0];
          await this.resumeSession(mostRecent.id);
        } else {
          await this.startNewSession();
        }
      } else {
        this.renderSessionList();
      }
      return;
    }

    const index = this.loadIndex().filter((s) => s.id !== id);
    this.saveIndex(index);
    storage.remove(msgsKey(id));

    if (id === this.sessionId) {
      if (index.length) {
        const mostRecent = [...index].sort((a, b) => b.updatedAt - a.updatedAt)[0];
        this.resumeSession(mostRecent.id);
      } else {
        this.startNewSession();
      }
    } else {
      this.renderSessionList();
    }
  }

  toggleSidebar() {
    this.elements.sidebar.classList.toggle("open");
    this.elements.sidebarBackdrop.classList.toggle("open");
  }

  closeSidebarMobile() {
    this.elements.sidebar.classList.remove("open");
    this.elements.sidebarBackdrop.classList.remove("open");
  }

  // Start a new conversation session
  async startNewSession() {
    try {
      const response = await fetch(`${this.apiUrl}/session/new`, {
        method: "POST",
        credentials: "same-origin",
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

      const now = Date.now();
      if (this.user) {
        // Server already created the owned chat_sessions row for this ID —
        // just reflect it in our local view of the list.
        this.serverChats.unshift({ id: this.sessionId, title: "New chat", preview: "", createdAt: now, updatedAt: now });
      } else {
        this.addIndexEntry({ id: this.sessionId, title: "New chat", preview: "", createdAt: now, updatedAt: now });
        this.setActiveSession(this.sessionId);
      }

      // Show welcome message (client-side only — nothing to persist yet)
      this.addMessage(
        data.message,
        "assistant",
        null
      );
      if (!this.user) this.cachePush("assistant", data.message, null);

      this.closeSidebarMobile();
      this.renderSessionList();
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
    this.cachePush("user", userMessage, null);

    // Show typing indicator
    const typingId = this.addTypingIndicator();
    this.announce("anvAI is thinking…");

    try {
      const response = await fetch(`${this.apiUrl}/chat`, {
        method: "POST",
        credentials: "same-origin",
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
        const crisisMeta = { isCrisis: true, severity: data.severity };
        this.addMessage(data.response, "assistant", crisisMeta);
        this.cachePush("assistant", data.response, crisisMeta);
      } else {
        // Add agent response
        const meta = { emotionalState: data.emotionalState };
        this.addMessage(data.response, "assistant", meta);
        this.cachePush("assistant", data.response, meta);

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
