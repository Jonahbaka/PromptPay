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
const shell = document.getElementById("dashboard-shell");
const authStatus = document.getElementById("auth-status");
const loadStatus = document.getElementById("dashboard-load-status");
const loginForm = document.getElementById("login-form");
const refreshButton = document.getElementById("dashboard-refresh");
const logoutButton = document.getElementById("dashboard-logout");
const profileForm = document.getElementById("profile-form");
const settingsForm = document.getElementById("settings-form");
const profileStatus = document.getElementById("profile-status");
const settingsStatus = document.getElementById("settings-status");
const tabButtons = [...document.querySelectorAll(".tab-button")];
const tabPanels = [...document.querySelectorAll(".tab-panel")];
const contextActions = document.getElementById("context-actions");
const contextTitle = document.getElementById("dashboard-context-title");
const contextCopy = document.getElementById("dashboard-context-copy");
const overviewCards = {
  profile: document.getElementById("profile-card"),
  account: document.getElementById("account-card"),
  notifications: document.getElementById("notifications-preview-card"),
  transactions: document.getElementById("transactions-card")
};

let sessionToken = null;
let currentPage = "overview";

function setStatus(node, message, isError = false) {
  if (!node) return;
  node.textContent = message;
  node.style.color = isError ? "#ffb4ad" : "#93a2b8";
}

function routeIfWrongRole(user) {
  if (user.role !== "user") {
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

function activatePage(page) {
  currentPage = page;
  tabButtons.forEach((button) => button.classList.toggle("active", button.dataset.page === page));
  tabPanels.forEach((panel) => panel.classList.toggle("active", panel.dataset.page === page));
}

function statusTone(value) {
  const normalized = String(value || "").toLowerCase();
  if (["active", "completed", "connected", "read", "recorded", "verified"].includes(normalized)) return "status-active";
  if (["pending", "review", "processing", "none"].includes(normalized)) return "status-pending";
  return "status-danger";
}

function applyBadge(id, label, outlined = false) {
  const node = document.getElementById(id);
  if (!node) return;
  node.textContent = label;
  node.className = outlined
    ? `badge badge-outline ${statusTone(label)}`
    : `badge ${statusTone(label)}`;
}

function isProfileComplete(profile) {
  return Boolean(profile.displayName && profile.phoneNumber && profile.country);
}

function sortOverviewCards(profile, account, transactions, notifications) {
  const unreadCount = notifications.filter((item) => item.status !== "read").length;
  const priorities = new Map([
    ["profile", isProfileComplete(profile) ? 3 : 1],
    ["account", String(account.status || "").toLowerCase() === "active" ? 4 : 2],
    ["notifications", unreadCount > 0 ? 2 : 5],
    ["transactions", transactions.length > 0 ? 1 : 4]
  ]);

  Object.entries(overviewCards).forEach(([key, node]) => {
    if (node) node.style.order = String(priorities.get(key) || 10);
  });
}

function renderProfile(profile) {
  document.getElementById("user-name").textContent = profile.displayName || profile.email;
  document.getElementById("user-email").textContent = profile.email;
  document.getElementById("profile-completeness").textContent = isProfileComplete(profile) ? "Complete" : "Needs update";
  document.getElementById("profile-summary").innerHTML = `
    <div><dt>Name</dt><dd>${escapeHtml(profile.displayName || "-")}</dd></div>
    <div><dt>Email</dt><dd>${escapeHtml(profile.email || "-")}</dd></div>
    <div><dt>Phone</dt><dd>${escapeHtml(profile.phoneNumber || "Not provided")}</dd></div>
    <div><dt>Country</dt><dd>${escapeHtml(profile.country || "Not provided")}</dd></div>
  `;
  document.getElementById("profile-name").value = profile.displayName || "";
  document.getElementById("profile-email").value = profile.email || "";
  document.getElementById("profile-phone").value = profile.phoneNumber || "";
  document.getElementById("profile-country").value = profile.country || "";
}

function renderAccount(account, transactions, notifications) {
  applyBadge("account-status", String(account.status || "unknown"));
  applyBadge("account-kyc", `KYC ${account.kycStatus || "none"}`, true);
  document.getElementById("metric-account-status").textContent = String(account.status || "-");
  document.getElementById("metric-transaction-count").textContent = formatNumber(transactions.length);
  document.getElementById("metric-notification-count").textContent = formatNumber(
    notifications.filter((item) => item.status !== "read").length
  );
  document.getElementById("metric-last-login").textContent = account.lastLoginAt ? relativeTime(account.lastLoginAt) : "Never";
  document.getElementById("account-summary").innerHTML = `
    <div><dt>Status</dt><dd>${escapeHtml(account.status || "-")}</dd></div>
    <div><dt>KYC status</dt><dd>${escapeHtml(account.kycStatus || "none")}</dd></div>
    <div><dt>KYC tier</dt><dd>${escapeHtml(account.kycTier ?? 0)}</dd></div>
    <div><dt>Created</dt><dd>${escapeHtml(formatDate(account.createdAt))}</dd></div>
  `;
}

function renderTransactions(transactions) {
  const tbody = document.getElementById("transaction-list");
  if (!transactions.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state">
          No transaction history exists for this account yet.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = transactions
    .map((item) => `
      <tr>
        <td>${escapeHtml(formatDate(item.createdAt))}</td>
        <td>${escapeHtml(item.source)}</td>
        <td>${escapeHtml(item.type)}</td>
        <td>${escapeHtml(item.description || "-")}</td>
        <td><span class="status-chip ${statusTone(item.status)}">${escapeHtml(item.status)}</span></td>
        <td>${item.currency ? escapeHtml(formatCurrency(item.amount, item.currency)) : escapeHtml(formatNumber(item.amount || 0))}</td>
      </tr>
    `)
    .join("");
}

function renderNotificationCards(notifications) {
  const preview = document.getElementById("notification-preview-list");
  const container = document.getElementById("notification-list");

  if (!notifications.length) {
    const emptyMarkup = `<div class="empty-state">No notifications yet.</div>`;
    preview.innerHTML = emptyMarkup;
    container.innerHTML = emptyMarkup;
    return;
  }

  preview.innerHTML = notifications
    .slice(0, 2)
    .map((item) => `
      <article class="stack-item compact-item">
        <header>
          <div>
            <strong>${escapeHtml(item.title)}</strong>
            <p>${escapeHtml(item.body)}</p>
          </div>
          <span class="status-chip ${statusTone(item.status)}">${escapeHtml(item.status)}</span>
        </header>
      </article>
    `)
    .join("");

  container.innerHTML = notifications
    .map((item) => `
      <article class="stack-item">
        <header>
          <div>
            <strong>${escapeHtml(item.title)}</strong>
            <p>${escapeHtml(item.body)}</p>
          </div>
          <span class="status-chip ${statusTone(item.status)}">${escapeHtml(item.status)}</span>
        </header>
        <div class="stack-item-actions">
          <span>${escapeHtml(formatDate(item.createdAt))}</span>
          ${item.status === "read" ? "" : `<button class="button button-secondary button-small" type="button" data-read-id="${escapeHtml(item.id)}">Mark read</button>`}
        </div>
      </article>
    `)
    .join("");

  container.querySelectorAll("[data-read-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await authJson(`/api/dashboard/notifications/${button.getAttribute("data-read-id")}/read`, sessionToken, {
          method: "POST"
        });
        await loadDashboard();
      } catch (error) {
        setStatus(loadStatus, error.message || "Unable to update notification.", true);
      }
    });
  });
}

function renderSettings(settings) {
  document.getElementById("settings-language").value = settings.language || "en";
  document.getElementById("settings-timezone").value = settings.timezone || "UTC";
  document.getElementById("settings-notifications").checked = Boolean(settings.notificationEnabled);
}

function renderContext(profile, account, transactions, notifications, featureFlags) {
  const unreadCount = notifications.filter((item) => item.status !== "read").length;
  const completeProfile = isProfileComplete(profile);
  const pageEnabled = {
    overview: true,
    services: featureFlags["dashboard.services"] !== false,
    notifications: featureFlags["dashboard.notifications"] !== false,
    settings: featureFlags["dashboard.settings"] !== false
  };
  const actions = [];

  if (!completeProfile) {
    actions.push({
      title: "Complete profile",
      description: "Add phone number and country so PromptPay has the minimum account context it needs.",
      page: pageEnabled.settings ? "settings" : "overview"
    });
  }

  if (unreadCount > 0 && pageEnabled.notifications) {
    actions.push({
      title: `Review ${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`,
      description: "Clear new account notices and status updates.",
      page: "notifications"
    });
  }

  if (!transactions.length) {
    actions.push({
      title: "Start first action",
      description: "No transaction history exists yet. Review readiness and the services roadmap.",
      page: completeProfile && pageEnabled.services ? "services" : (pageEnabled.settings ? "settings" : "overview")
    });
  } else {
    actions.push({
      title: "View recent activity",
      description: "Open the latest recorded transactions for this account.",
      page: "overview",
      target: "transactions-card"
    });
  }

  if (String(account.status || "").toLowerCase() !== "active" || String(account.kycStatus || "").toLowerCase() !== "verified") {
    actions.push({
      title: "Review account readiness",
      description: "Check the current status and KYC fields before using future services.",
      page: "overview",
      target: "account-card"
    });
  }

  const primaryState = actions[0] || {
    title: "Account activity is live",
    description: "Recent transactions and notifications will surface here automatically as real data arrives."
  };

  contextTitle.textContent = primaryState.title;
  contextCopy.textContent = primaryState.description;
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
      if (target) {
        requestAnimationFrame(() => {
          document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
      }
    });
  });
}

function applyFeatureFlags(flags) {
  [
    ["dashboard.services", "services"],
    ["dashboard.notifications", "notifications"],
    ["dashboard.settings", "settings"]
  ].forEach(([flagKey, page]) => {
    const enabled = flags[flagKey] !== false;
    document.querySelector(`.tab-button[data-page="${page}"]`)?.classList.toggle("hidden", !enabled);
    document.querySelector(`.tab-panel[data-page="${page}"]`)?.classList.toggle("hidden", !enabled);
    if (!enabled && currentPage === page) {
      activatePage("overview");
    }
  });
}

async function loadDashboard() {
  setStatus(loadStatus, "Loading dashboard...");
  const data = await authJson("/api/dashboard/summary", sessionToken);
  renderProfile(data.profile);
  renderAccount(data.account, data.transactions, data.notifications);
  renderTransactions(data.transactions);
  renderNotificationCards(data.notifications);
  renderSettings(data.settings);
  applyFeatureFlags(data.featureFlags || {});
  renderContext(data.profile, data.account, data.transactions, data.notifications, data.featureFlags || {});
  sortOverviewCards(data.profile, data.account, data.transactions, data.notifications);
  setStatus(loadStatus, "");
}

async function handleLoginRequest(requestPromise) {
  const payload = await requestPromise;
  saveSession(payload.user, payload.token);
  if (routeIfWrongRole(payload.user)) return;
  sessionToken = payload.token;
  showShell();
  await loadDashboard();
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
    await loadDashboard();
  } catch {
    clearSession();
    showAuth();
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  if (!email || !password) {
    setStatus(authStatus, "Enter email and password.", true);
    return;
  }

  const reset = setLoadingState(document.getElementById("login-submit"), "Sign In", "Signing In...");
  setStatus(authStatus, "Signing in...");
  try {
    await handleLoginRequest(requestJson("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    }));
  } catch (error) {
    setStatus(authStatus, error.message || "Unable to sign in.", true);
  } finally {
    reset();
  }
});

refreshButton.addEventListener("click", async () => {
  try {
    await loadDashboard();
  } catch (error) {
    setStatus(loadStatus, error.message || "Unable to refresh dashboard.", true);
  }
});

logoutButton.addEventListener("click", () => {
  clearSession();
  sessionToken = null;
  showAuth();
  window.location.assign("/dashboard");
});

profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    displayName: document.getElementById("profile-name").value.trim(),
    phoneNumber: document.getElementById("profile-phone").value.trim(),
    country: document.getElementById("profile-country").value.trim()
  };
  const reset = setLoadingState(document.getElementById("profile-save"), "Save profile", "Saving...");
  setStatus(profileStatus, "Saving profile...");
  try {
    await authJson("/api/dashboard/profile", sessionToken, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
    await loadDashboard();
    setStatus(profileStatus, "Profile updated.");
  } catch (error) {
    setStatus(profileStatus, error.message || "Unable to save profile.", true);
  } finally {
    reset();
  }
});

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    language: document.getElementById("settings-language").value.trim() || "en",
    timezone: document.getElementById("settings-timezone").value.trim() || "UTC",
    notificationEnabled: document.getElementById("settings-notifications").checked
  };
  const reset = setLoadingState(document.getElementById("settings-save"), "Save settings", "Saving...");
  setStatus(settingsStatus, "Saving settings...");
  try {
    await authJson("/api/user/settings", sessionToken, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
    await loadDashboard();
    setStatus(settingsStatus, "Settings updated.");
  } catch (error) {
    setStatus(settingsStatus, error.message || "Unable to save settings.", true);
  } finally {
    reset();
  }
});

document.querySelectorAll("[data-switch-page]").forEach((button) => {
  button.addEventListener("click", () => activatePage(button.getAttribute("data-switch-page")));
});

wireNavigation(tabButtons, tabPanels, (page) => {
  currentPage = page;
});
hydrate();
