import {
  authJson,
  clearSession,
  consolePathForRole,
  escapeHtml,
  formatCurrency,
  formatDate,
  formatNumber,
  getCurrentUser,
  getStoredToken,
  relativeTime,
  requestJson,
  saveSession,
  setLoadingState,
  wireNavigation
} from "./console-core.js";

const authView = document.getElementById("auth-view");
const shell = document.getElementById("partner-shell");
const loginStatus = document.getElementById("login-status");
const applyStatus = document.getElementById("apply-status");
const loadStatus = document.getElementById("partner-load-status");
const statusBanner = document.getElementById("partner-status-banner");
const loginForm = document.getElementById("login-form");
const applyForm = document.getElementById("apply-form");
const refreshButton = document.getElementById("partner-refresh");
const logoutButton = document.getElementById("partner-logout");
const tabButtons = [...document.querySelectorAll(".tab-button")];
const tabPanels = [...document.querySelectorAll(".tab-panel")];
const authTabs = [...document.querySelectorAll(".auth-tab")];
const authPanels = [...document.querySelectorAll(".auth-panel")];
const contextActions = document.getElementById("partner-context-actions");
const contextTitle = document.getElementById("partner-context-title");
const contextCopy = document.getElementById("partner-context-copy");
const overviewCards = {
  summary: document.getElementById("partner-summary-card"),
  integrations: document.getElementById("partner-integrations-card"),
  transactions: document.getElementById("partner-transactions-card")
};

let sessionToken = null;
let currentPage = "overview";
const state = {
  dashboard: null,
  transactions: [],
  apiUsage: null,
  agents: null
};

function setStatus(node, message, isError = false) {
  if (!node) return;
  node.textContent = message;
  node.style.color = isError ? "#ffb4ad" : "#93a2b8";
}

function routeIfWrongRole(user) {
  if (user.role !== "partner_admin") {
    window.location.assign(consolePathForRole(user.role));
    return true;
  }
  return false;
}

function showAuth() {
  authView.classList.remove("hidden");
  shell.classList.add("hidden");
}

function showShell() {
  authView.classList.add("hidden");
  shell.classList.remove("hidden");
}

function setAuthTab(mode) {
  authTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.authTab === mode));
  authPanels.forEach((panel) => panel.classList.toggle("active", panel.dataset.authPanel === mode));
}

function activatePage(page) {
  currentPage = page;
  tabButtons.forEach((button) => button.classList.toggle("active", button.dataset.page === page));
  tabPanels.forEach((panel) => panel.classList.toggle("active", panel.dataset.page === page));
}

function statusTone(value) {
  const normalized = String(value || "").toLowerCase();
  if (["active", "completed", "connected"].includes(normalized)) return "status-active";
  if (["pending", "review", "processing"].includes(normalized)) return "status-pending";
  return "status-danger";
}

function sortOverviewCards(network, apiUsage, transactions) {
  const priorities = new Map([
    ["summary", network.totalAgents === 0 ? 1 : 3],
    ["integrations", apiUsage.activeKeys > 0 ? 3 : 1],
    ["transactions", transactions.length > 0 ? 1 : 4]
  ]);

  Object.entries(overviewCards).forEach(([key, node]) => {
    if (node) node.style.order = String(priorities.get(key) || 10);
  });
}

function renderDetailList(elementId, rows) {
  const node = document.getElementById(elementId);
  node.innerHTML = rows.map(([label, value]) => `
    <div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>
  `).join("");
}

function renderContext(partner, network, transactions, apiUsage) {
  const actions = [];

  if (String(partner.status || "").toLowerCase() !== "active") {
    actions.push({
      title: "Review onboarding status",
      description: "This partner is not active yet. PromptPay will keep operational views empty until activation is complete.",
      page: "overview"
    });
  }

  if ((network.totalAgents || 0) === 0) {
    actions.push({
      title: "No agents yet",
      description: "Your network has no registered agents. Review onboarding and activation requirements first.",
      page: "agents"
    });
  }

  if ((apiUsage.activeKeys || 0) === 0) {
    actions.push({
      title: "Connect provider access",
      description: "No developer keys or API traffic are connected for this partner yet.",
      page: "integrations"
    });
  }

  if ((transactions.completedTransactions || 0) === 0) {
    actions.push({
      title: "No live volume yet",
      description: "Transaction and commission panels will populate automatically when real partner activity is recorded.",
      page: "overview"
    });
  } else {
    actions.push({
      title: "Review recent transaction activity",
      description: "Live partner transaction records are available for inspection now.",
      page: "overview",
      target: "partner-transactions-card"
    });
  }

  const primary = actions[0] || {
    title: "Partner activity is live",
    description: "PromptPay is surfacing the next operational view based on real agent, transaction, and API data."
  };

  contextTitle.textContent = primary.title;
  contextCopy.textContent = primary.description;
  contextActions.innerHTML = actions.slice(0, 3).map((action) => `
    <article class="action-card">
      <strong>${escapeHtml(action.title)}</strong>
      <p>${escapeHtml(action.description)}</p>
      <button
        class="button button-secondary button-small"
        type="button"
        data-action-page="${escapeHtml(action.page)}"
        ${action.target ? `data-action-target="${escapeHtml(action.target)}"` : ""}
      >
        Open
      </button>
    </article>
  `).join("");

  contextActions.querySelectorAll("[data-action-page]").forEach((button) => {
    button.addEventListener("click", () => {
      const page = button.getAttribute("data-action-page");
      const target = button.getAttribute("data-action-target");
      activatePage(page);
      if (page === "agents") {
        void loadAgents();
      }
      if (target) {
        requestAnimationFrame(() => {
          document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
      }
    });
  });
}

function renderOverview() {
  const dashboard = state.dashboard;
  const transactions = state.transactions;
  const apiUsage = state.apiUsage;
  const partner = dashboard.partner;
  const network = dashboard.network;
  const txSummary = dashboard.transactions;
  const commission = dashboard.commissionSummary;

  document.getElementById("partner-name").textContent = partner.displayName || partner.name;
  document.getElementById("partner-meta").textContent = `${partner.contactEmail || "No contact email"} / ${partner.tier || "standard"}`;
  document.getElementById("partner-status-badge").className = `badge ${statusTone(partner.status)}`;
  document.getElementById("partner-status-badge").textContent = partner.status;
  document.getElementById("partner-tier-badge").textContent = String(partner.tier || "standard");

  document.getElementById("metric-status").textContent = String(partner.status || "-");
  document.getElementById("metric-agents").textContent = formatNumber(network.totalAgents || 0);
  document.getElementById("metric-volume").textContent = formatCurrency(txSummary.completedVolume || 0, "NGN");
  document.getElementById("metric-commission").textContent = formatCurrency(commission.promptPayShare || 0, "NGN");

  renderDetailList("partner-summary", [
    ["Name", partner.displayName || partner.name || "-"],
    ["Contact", `${partner.contactEmail || "-"}${partner.contactPhone ? ` / ${partner.contactPhone}` : ""}`],
    ["Created", formatDate(partner.createdAt)],
    ["Activated", partner.activatedAt ? formatDate(partner.activatedAt) : "Pending activation"]
  ]);

  if (partner.status !== "active") {
    statusBanner.textContent = "This partner is not active yet. Metrics remain empty until the account and network are activated.";
    statusBanner.classList.remove("hidden");
  } else {
    statusBanner.textContent = "";
    statusBanner.classList.add("hidden");
  }

  const txContainer = document.getElementById("partner-transactions");
  if (!transactions.length) {
    txContainer.innerHTML = `<div class="empty-state">No transaction records found for this partner.</div>`;
  } else {
    txContainer.innerHTML = transactions.map((item) => `
      <article class="stack-item">
        <header>
          <div>
            <strong>${escapeHtml(item.agent_name || item.agent_email || "Agent")} / ${escapeHtml(item.product_type || "transaction")}</strong>
            <p>${escapeHtml(item.customer_phone || "-")}${item.carrier ? ` / ${escapeHtml(item.carrier)}` : ""}</p>
          </div>
          <span class="status-chip ${statusTone(item.status)}">${escapeHtml(item.status)}</span>
        </header>
        <div class="stack-item-actions">
          <span>${escapeHtml(formatDate(item.created_at))}</span>
          <span>${escapeHtml(formatCurrency(item.face_value || 0, "NGN"))}</span>
        </div>
      </article>
    `).join("");
  }

  const integrationRows = [
    ["Status", apiUsage.status || "Not Connected"],
    ["Active keys", formatNumber(apiUsage.activeKeys || 0)],
    ["Total calls", formatNumber(apiUsage.totalCalls || 0)],
    ["Last request", dashboard.apiIntegration?.lastRequestAt ? relativeTime(dashboard.apiIntegration.lastRequestAt) : "Not Connected"]
  ];
  renderDetailList("integration-summary", integrationRows);
  renderDetailList("integration-summary-panel", integrationRows);

  const keysContainer = document.getElementById("integration-keys");
  if (!apiUsage.keys?.length) {
    keysContainer.innerHTML = `<div class="empty-state">No developer keys found.</div>`;
  } else {
    keysContainer.innerHTML = apiUsage.keys.map((key) => `
      <article class="stack-item compact-item">
        <header>
          <div>
            <strong>${escapeHtml(key.name || "Key")}</strong>
            <p>${escapeHtml(key.api_key_prefix || "")} / ${escapeHtml(key.status || "inactive")}</p>
          </div>
          <span>${escapeHtml(formatNumber(key.requests_today || 0))} requests today</span>
        </header>
      </article>
    `).join("");
  }

  renderContext(partner, network, txSummary, apiUsage);
  sortOverviewCards(network, apiUsage, transactions);
}

function renderAgents() {
  const tbody = document.getElementById("agent-table");
  const agents = state.agents || [];
  if (!agents.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No agents found for this partner.</td></tr>`;
    return;
  }

  tbody.innerHTML = agents.map((agent) => `
    <tr>
      <td>${escapeHtml(agent.display_name || "-")}<br><span class="muted">${escapeHtml(agent.email || "-")}</span></td>
      <td>${escapeHtml(agent.agent_code || "-")}</td>
      <td><span class="status-chip ${statusTone(agent.status)}">${escapeHtml(agent.status || "unknown")}</span></td>
      <td>${escapeHtml(agent.tier || "-")}</td>
      <td>${escapeHtml(formatNumber(agent.total_transactions || 0))}</td>
      <td>${escapeHtml(formatCurrency(agent.total_volume || 0, "NGN"))}</td>
    </tr>
  `).join("");
}

function renderBrandingPreview(file) {
  const container = document.getElementById("branding-preview");
  if (!file) {
    container.textContent = "No file selected.";
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const image = document.createElement("img");
    image.src = String(reader.result);
    image.alt = "Selected logo preview";
    container.innerHTML = "";
    container.appendChild(image);
  };
  reader.readAsDataURL(file);
}

async function loadOverview(force = false) {
  if (!force && state.dashboard && state.apiUsage) {
    renderOverview();
    return;
  }

  setStatus(loadStatus, "Loading partner portal...");
  const [dashboard, transactionsPayload, apiUsage] = await Promise.all([
    authJson("/api/partners/me/dashboard", sessionToken),
    authJson("/api/partners/me/transactions?limit=8", sessionToken),
    authJson("/api/partners/me/api-usage", sessionToken)
  ]);

  state.dashboard = dashboard;
  state.transactions = transactionsPayload.transactions || [];
  state.apiUsage = apiUsage;
  renderOverview();
  setStatus(loadStatus, "");
}

async function loadAgents(force = false) {
  if (!force && state.agents) {
    renderAgents();
    return;
  }

  setStatus(loadStatus, "Loading agents...");
  const agentsPayload = await authJson("/api/partners/me/agents", sessionToken);
  state.agents = agentsPayload.agents || [];
  renderAgents();
  setStatus(loadStatus, "");
}

async function handleLoginRequest(requestPromise) {
  const payload = await requestPromise;
  saveSession(payload.user, payload.token);
  if (routeIfWrongRole(payload.user)) return;
  sessionToken = payload.token;
  showShell();
  await loadOverview(true);
}

async function hydrate() {
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  window.scrollTo(0, 0);

  const token = getStoredToken();
  if (!token) {
    showAuth();
    return;
  }

  try {
    const user = await getCurrentUser(token);
    if (routeIfWrongRole(user)) return;
    sessionToken = token;
    showShell();
    await loadOverview(true);
  } catch {
    clearSession();
    showAuth();
  }
}

authTabs.forEach((tab) => {
  tab.addEventListener("click", () => setAuthTab(tab.dataset.authTab));
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  if (!email || !password) {
    setStatus(loginStatus, "Enter email and password.", true);
    return;
  }

  const reset = setLoadingState(document.getElementById("login-submit"), "Sign In", "Signing In...");
  setStatus(loginStatus, "Signing in...");
  try {
    await handleLoginRequest(requestJson("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    }));
  } catch (error) {
    setStatus(loginStatus, error.message || "Unable to sign in.", true);
  } finally {
    reset();
  }
});

applyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    name: document.getElementById("apply-name").value.trim(),
    displayName: document.getElementById("apply-display-name").value.trim(),
    contactEmail: document.getElementById("apply-email").value.trim(),
    contactPhone: document.getElementById("apply-phone").value.trim(),
    website: document.getElementById("apply-website").value.trim(),
    tier: document.getElementById("apply-tier").value,
    description: document.getElementById("apply-description").value.trim()
  };

  if (!payload.name || !payload.contactEmail) {
    setStatus(applyStatus, "Organization name and contact email are required.", true);
    return;
  }

  const reset = setLoadingState(document.getElementById("apply-submit"), "Submit application", "Submitting...");
  setStatus(applyStatus, "Submitting application...");
  try {
    const response = await requestJson("/api/partners/apply", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    applyForm.reset();
    setStatus(applyStatus, `Application submitted. Tenant ID: ${response.tenantId}`);
  } catch (error) {
    setStatus(applyStatus, error.message || "Unable to submit application.", true);
  } finally {
    reset();
  }
});

refreshButton.addEventListener("click", async () => {
  try {
    state.dashboard = null;
    state.apiUsage = null;
    state.transactions = [];
    if (currentPage === "agents") {
      state.agents = null;
    }
    await loadOverview(true);
    if (currentPage === "agents") {
      await loadAgents(true);
    }
  } catch (error) {
    setStatus(loadStatus, error.message || "Unable to refresh portal.", true);
  }
});

logoutButton.addEventListener("click", () => {
  clearSession();
  sessionToken = null;
  state.dashboard = null;
  state.transactions = [];
  state.apiUsage = null;
  state.agents = null;
  showAuth();
  window.location.assign("/partner");
});

document.getElementById("branding-file").addEventListener("change", (event) => {
  renderBrandingPreview(event.target.files?.[0]);
});

document.querySelectorAll("[data-switch-page]").forEach((button) => {
  button.addEventListener("click", async () => {
    const page = button.getAttribute("data-switch-page");
    activatePage(page);
    if (page === "agents") {
      await loadAgents();
    }
  });
});

wireNavigation(tabButtons, tabPanels, async (page) => {
  currentPage = page;
  if (page === "agents") {
    try {
      await loadAgents();
    } catch (error) {
      setStatus(loadStatus, error.message || "Unable to load agents.", true);
    }
  }
});

hydrate();
