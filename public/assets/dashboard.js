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
const runtimeLabel = document.getElementById("dashboard-runtime-status");
const runtimeTime = document.getElementById("dashboard-runtime-time");
const overviewRefreshButton = document.getElementById("dashboard-rail-refresh");
const overviewCards = {
  command: document.getElementById("dashboard-command-card"),
  profile: document.getElementById("profile-card"),
  account: document.getElementById("account-card"),
  notifications: document.getElementById("notifications-preview-card"),
  transactions: document.getElementById("transactions-card")
};

let sessionToken = null;
let currentPage = "overview";
let clockTimer = null;

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
  if (clockTimer) {
    window.clearInterval(clockTimer);
    clockTimer = null;
  }
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

function alertTone(value) {
  const normalized = String(value || "").toLowerCase();
  if (["success", "active"].includes(normalized)) return "alert-active";
  if (["warning", "pending"].includes(normalized)) return "alert-warning";
  return "alert-danger";
}

function isProfileComplete(profile) {
  return Boolean(profile.displayName && profile.phoneNumber && profile.country);
}

function profileFieldCount(profile) {
  return [
    profile.displayName,
    profile.email,
    profile.phoneNumber,
    profile.country
  ].filter(Boolean).length;
}

function lastActivityTimestamp(account, transactions, notifications) {
  return [
    account.lastLoginAt,
    transactions[0]?.createdAt,
    notifications[0]?.createdAt
  ].filter(Boolean).sort((left, right) => String(right).localeCompare(String(left)))[0] || null;
}

function nodeTone(status) {
  const normalized = String(status || "").toLowerCase();
  if (["active", "completed", "connected", "read", "recorded", "verified"].includes(normalized)) return "active";
  if (["pending", "review", "processing", "none"].includes(normalized)) return "warning";
  return "danger";
}

function ensureStageCanvas(container) {
  if (!container) return null;
  let canvas = container.querySelector(".ops-stage-canvas");
  if (!canvas) {
    canvas = document.createElement("div");
    canvas.className = "ops-stage-canvas";
    container.appendChild(canvas);
  }
  return canvas;
}

function renderOpsStream(containerId, items, emptyCopy = "No activity stream available yet.") {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!items.length) {
    container.innerHTML = `<div class="empty-state">${escapeHtml(emptyCopy)}</div>`;
    return;
  }

  container.innerHTML = items.map((item) => `
    <article class="ops-stream-item">
      <div class="ops-stream-main">
        <div class="ops-stream-pulse ${alertTone(item.type)}"></div>
        <div class="ops-stream-copy">
          <div class="ops-stream-head">
            <strong class="ops-stream-tag">${escapeHtml(item.tag)}</strong>
            <span class="ops-stream-meta">${escapeHtml(item.meta)}</span>
          </div>
          <p>${escapeHtml(item.detail)}</p>
        </div>
      </div>
      <time class="ops-stream-time">${escapeHtml(item.time)}</time>
    </article>
  `).join("");
}

function buildDashboardStream(profile, account, transactions, notifications, settings, featureFlags) {
  const unreadCount = notifications.filter((item) => item.status !== "read").length;
  const stream = [];

  if (unreadCount > 0) {
    stream.push({
      type: "warning",
      tag: "NOTICE",
      detail: `${formatNumber(unreadCount)} unread notification${unreadCount === 1 ? "" : "s"} need review.`,
      meta: "Account inbox",
      time: notifications[0]?.createdAt ? relativeTime(notifications[0].createdAt) : "Now"
    });
  }

  transactions.slice(0, 4).forEach((item) => {
    stream.push({
      type: String(item.status || "").toLowerCase() === "completed" || String(item.status || "").toLowerCase() === "recorded" ? "active" : "warning",
      tag: String(item.type || item.source || "activity").toUpperCase(),
      detail: item.description || `${item.source || "account"} activity`,
      meta: item.currency ? formatCurrency(item.amount || 0, item.currency) : `${formatNumber(item.amount || 0)} units`,
      time: relativeTime(item.createdAt)
    });
  });

  if (String(account.kycStatus || "").toLowerCase() !== "verified") {
    stream.push({
      type: "warning",
      tag: "KYC",
      detail: `Current KYC status is ${String(account.kycStatus || "none").toLowerCase()}.`,
      meta: `Tier ${account.kycTier ?? 0}`,
      time: account.createdAt ? relativeTime(account.createdAt) : "Live"
    });
  }

  if (featureFlags["dashboard.services"] === false) {
    stream.push({
      type: "warning",
      tag: "FLAG",
      detail: "Services are disabled by current platform feature flags.",
      meta: "Integration required",
      time: "Live"
    });
  }

  if (!stream.length && account.lastLoginAt) {
    stream.push({
      type: "active",
      tag: "LOGIN",
      detail: `${profile.displayName || profile.email} last accessed this workspace successfully.`,
      meta: String(account.status || "active"),
      time: relativeTime(account.lastLoginAt)
    });
  }

  if (!stream.length && settings.notificationEnabled === false) {
    stream.push({
      type: "warning",
      tag: "SETTINGS",
      detail: "Notifications are muted in account preferences.",
      meta: settings.timezone || "UTC",
      time: "Live"
    });
  }

  return stream.slice(0, 6);
}

function startRuntimeClock() {
  const update = () => {
    runtimeTime.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };
  update();
  if (clockTimer) window.clearInterval(clockTimer);
  clockTimer = window.setInterval(update, 30000);
}

function sortOverviewCards(profile, account, transactions, notifications) {
  const unreadCount = notifications.filter((item) => item.status !== "read").length;
  const priorities = new Map([
    ["command", !isProfileComplete(profile) || unreadCount > 0 ? 1 : 3],
    ["profile", isProfileComplete(profile) ? 4 : 2],
    ["account", String(account.status || "").toLowerCase() === "active" ? 5 : 2],
    ["notifications", unreadCount > 0 ? 2 : 4],
    ["transactions", transactions.length > 0 ? 1 : 5]
  ]);

  Object.entries(overviewCards).forEach(([key, node]) => {
    if (node) node.style.order = String(priorities.get(key) || 10);
  });
}

function buildAlerts(profile, account, transactions, notifications, settings, featureFlags) {
  const alerts = [];
  const unreadCount = notifications.filter((item) => item.status !== "read").length;

  if (!isProfileComplete(profile)) {
    alerts.push({ tone: "warning", title: "Profile needs completion", copy: "Add phone number and country so your account context is fully usable." });
  }
  if (String(account.kycStatus || "").toLowerCase() !== "verified") {
    alerts.push({ tone: "warning", title: "KYC is not fully verified", copy: "Your current KYC status is limiting future product access." });
  }
  if (unreadCount > 0) {
    alerts.push({ tone: "warning", title: `${formatNumber(unreadCount)} unread notification${unreadCount === 1 ? "" : "s"}`, copy: "New account notices are available for review." });
  }
  if (!transactions.length) {
    alerts.push({ tone: "pending", title: "No transaction history yet", copy: "This workspace stays explicit until real wallet or POS records exist." });
  }
  if (featureFlags["dashboard.services"] === false) {
    alerts.push({ tone: "warning", title: "Service surfaces are restricted", copy: "The services section is currently disabled by platform feature flags." });
  }
  if (settings.notificationEnabled === false) {
    alerts.push({ tone: "warning", title: "Notifications are muted", copy: "PromptPay is not sending in-app notices while notifications are disabled." });
  }
  if (!alerts.length) {
    alerts.push({ tone: "success", title: "Account state is healthy", copy: "Profile, readiness, and recent account signals do not show blockers right now." });
  }
  return alerts.slice(0, 4);
}

function renderAlertFeed(alerts) {
  const feed = document.getElementById("dashboard-alert-feed");
  feed.innerHTML = alerts.map((alert) => `
    <article class="alert-card ${alertTone(alert.tone)}">
      <div class="alert-stripe"></div>
      <div>
        <strong>${escapeHtml(alert.title)}</strong>
        <p>${escapeHtml(alert.copy)}</p>
      </div>
    </article>
  `).join("");
}

function renderHero(profile, account, transactions, notifications) {
  const unreadCount = notifications.filter((item) => item.status !== "read").length;
  const recentActivity = lastActivityTimestamp(account, transactions, notifications);
  const profileReady = isProfileComplete(profile);
  const status = String(account.status || "-");
  const kyc = String(account.kycStatus || "none");

  document.getElementById("user-name").textContent = profile.displayName || profile.email;
  document.getElementById("user-email").textContent = profile.email;
  document.getElementById("user-live-state").textContent = `Account: ${status}`;
  document.getElementById("user-live-notices").textContent = `Unread: ${formatNumber(unreadCount)}`;
  document.getElementById("user-live-activity").textContent = `Transactions: ${formatNumber(transactions.length)}`;
  document.getElementById("dashboard-signal-status").textContent = status;
  document.getElementById("dashboard-signal-kyc").textContent = `Tier ${account.kycTier ?? 0} / ${kyc}`;
  document.getElementById("dashboard-signal-activity").textContent = recentActivity ? relativeTime(recentActivity) : "No recent activity";
  document.getElementById("dashboard-signal-status-copy").textContent = String(account.status || "").toLowerCase() === "active"
    ? "This account is active in the users table."
    : "This account needs attention before live services can expand.";
  document.getElementById("dashboard-signal-kyc-copy").textContent = String(account.kycStatus || "").toLowerCase() === "verified"
    ? "KYC fields show the account is verified."
    : "KYC still needs review before future service unlocks.";
  document.getElementById("dashboard-signal-activity-copy").textContent = recentActivity
    ? "Pulled from the latest login, transaction, or notification timestamp."
    : "No account activity has been recorded yet.";
  runtimeLabel.textContent = profileReady
    ? (String(account.status || "").toLowerCase() === "active" ? "Account ready for activity" : "Account needs review")
    : "Profile details still incomplete";
}

function renderHealthGrid(profile, account, transactions, notifications, settings, featureFlags) {
  const unreadCount = notifications.filter((item) => item.status !== "read").length;
  const enabledTabs = [
    featureFlags["dashboard.services"] !== false,
    featureFlags["dashboard.notifications"] !== false,
    featureFlags["dashboard.settings"] !== false
  ].filter(Boolean).length;
  const recentActivity = lastActivityTimestamp(account, transactions, notifications);
  const items = [
    {
      label: "Profile fields",
      value: `${formatNumber(profileFieldCount(profile))} / 4`,
      copy: "Name, email, phone, and country."
    },
    {
      label: "Unread notices",
      value: formatNumber(unreadCount),
      copy: unreadCount > 0 ? "Review unread account notices." : "No unread notices right now."
    },
    {
      label: "Notifications",
      value: settings.notificationEnabled === false ? "Muted" : "Live",
      copy: settings.notificationEnabled === false ? "In-app notices are disabled in preferences." : `Timezone ${settings.timezone || "UTC"}.`
    },
    {
      label: "Portal modules",
      value: `${formatNumber(enabledTabs)} / 3`,
      copy: recentActivity ? `Latest activity ${relativeTime(recentActivity)}.` : "No recent records yet."
    }
  ];
  document.getElementById("dashboard-health-grid").innerHTML = items.map((item) => `
    <article class="mini-stat-card">
      <span>${escapeHtml(item.label)}</span>
      <strong>${escapeHtml(item.value)}</strong>
      <small>${escapeHtml(item.copy)}</small>
    </article>
  `).join("");
}

function renderOverviewStage(profile, account, transactions, notifications, featureFlags) {
  const stage = document.getElementById("dashboard-stage");
  const badge = document.getElementById("dashboard-stage-badge");
  const profileNode = document.getElementById("dashboard-stage-profile");
  const modulesNode = document.getElementById("dashboard-stage-modules");
  const lastNode = document.getElementById("dashboard-stage-last");
  if (!stage || !badge || !profileNode || !modulesNode || !lastNode) return;

  const unreadCount = notifications.filter((item) => item.status !== "read").length;
  const profileFields = profileFieldCount(profile);
  const enabledModules = [
    featureFlags["dashboard.services"] !== false,
    featureFlags["dashboard.notifications"] !== false,
    featureFlags["dashboard.settings"] !== false
  ].filter(Boolean).length;
  const lastActivity = lastActivityTimestamp(account, transactions, notifications);
  const completeProfile = isProfileComplete(profile);

  badge.textContent = completeProfile && String(account.status || "").toLowerCase() === "active" ? "Ready" : "Review";
  profileNode.textContent = `${formatNumber(profileFields)} / 4`;
  modulesNode.textContent = `${formatNumber(enabledModules)} / 3`;
  lastNode.textContent = lastActivity ? relativeTime(lastActivity) : "No activity";

  const canvas = ensureStageCanvas(stage);
  if (!canvas) return;
  const positions = [
    { x: 24, y: 28, tone: completeProfile ? "active" : "warning", note: `PROFILE / ${profileFields} OF 4` },
    { x: 74, y: 28, tone: nodeTone(account.status), note: `ACCOUNT / ${String(account.status || "unknown").toUpperCase()}` },
    { x: 72, y: 74, tone: unreadCount > 0 ? "warning" : "active", note: `NOTICES / ${formatNumber(unreadCount)} UNREAD` },
    { x: 24, y: 74, tone: enabledModules > 0 ? "active" : "danger", note: `MODULES / ${enabledModules} LIVE` }
  ];
  const links = [
    [positions[0], positions[1]],
    [positions[1], positions[2]],
    [positions[2], positions[3]],
    [positions[3], positions[0]]
  ].map(([from, to]) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    return `<span class="ops-stage-link" style="left:${from.x}%;top:${from.y}%;width:${distance}%;transform:rotate(${angle}deg);"></span>`;
  }).join("");

  canvas.innerHTML = `${links}${positions.map((item) => `
    <div class="ops-stage-node ${item.tone}" style="left:${item.x}%;top:${item.y}%;">
      <span class="ops-stage-node-glow"></span>
      <span class="ops-stage-node-dot"></span>
      <span class="ops-stage-node-note">${escapeHtml(item.note)}</span>
    </div>
  `).join("")}`;
}

function renderOverviewStats(account, transactions, notifications) {
  const unreadCount = notifications.filter((item) => item.status !== "read").length;
  const primaryBadge = document.getElementById("dashboard-primary-badge");
  const primaryValue = document.getElementById("dashboard-primary-value");
  const primaryCopy = document.getElementById("dashboard-primary-copy");
  const secondaryValue = document.getElementById("dashboard-secondary-value");
  const secondaryCopy = document.getElementById("dashboard-secondary-copy");
  if (!primaryBadge || !primaryValue || !primaryCopy || !secondaryValue || !secondaryCopy) return;

  primaryBadge.textContent = unreadCount > 0 ? `${formatNumber(unreadCount)} New` : "Clear";
  primaryValue.textContent = formatNumber(unreadCount);
  primaryCopy.textContent = unreadCount > 0
    ? "Unread notices are pulled directly from your user_notifications records."
    : "No unread notification records are waiting in this account.";

  secondaryValue.textContent = transactions.length > 0 ? `${formatNumber(transactions.length)} records` : "No data";
  secondaryCopy.textContent = transactions.length > 0
    ? `Latest recorded activity ${relativeTime(transactions[0].createdAt)}. Account status is ${String(account.status || "unknown").toLowerCase()}.`
    : "Transactions and services stay explicit until live data exists.";
}

function renderProfile(profile) {
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
        <td data-label="Time">${escapeHtml(formatDate(item.createdAt))}</td>
        <td data-label="Source">${escapeHtml(item.source)}</td>
        <td data-label="Type">${escapeHtml(item.type)}</td>
        <td data-label="Description">${escapeHtml(item.description || "-")}</td>
        <td data-label="Status"><span class="status-chip ${statusTone(item.status)}">${escapeHtml(item.status)}</span></td>
        <td data-label="Amount">${item.currency ? escapeHtml(formatCurrency(item.amount, item.currency)) : escapeHtml(formatNumber(item.amount || 0))}</td>
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
    document.querySelectorAll(`.tab-button[data-page="${page}"]`).forEach((node) => node.classList.toggle("hidden", !enabled));
    document.querySelectorAll(`.tab-panel[data-page="${page}"]`).forEach((node) => node.classList.toggle("hidden", !enabled));
    document.querySelectorAll(`[data-switch-page="${page}"]`).forEach((node) => node.classList.toggle("hidden", !enabled));
    if (!enabled && currentPage === page) {
      activatePage("overview");
    }
  });
}

async function loadDashboard() {
  setStatus(loadStatus, "Loading dashboard...");
  const data = await authJson("/api/dashboard/summary", sessionToken);
  renderProfile(data.profile);
  renderHero(data.profile, data.account, data.transactions, data.notifications);
  renderAlertFeed(buildAlerts(data.profile, data.account, data.transactions, data.notifications, data.settings, data.featureFlags || {}));
  renderOverviewStage(data.profile, data.account, data.transactions, data.notifications, data.featureFlags || {});
  renderOverviewStats(data.account, data.transactions, data.notifications);
  renderOpsStream(
    "dashboard-stream",
    buildDashboardStream(data.profile, data.account, data.transactions, data.notifications, data.settings, data.featureFlags || {}),
    "No account activity has been recorded yet."
  );
  renderHealthGrid(data.profile, data.account, data.transactions, data.notifications, data.settings, data.featureFlags || {});
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
  startRuntimeClock();
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
    startRuntimeClock();
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

overviewRefreshButton?.addEventListener("click", async () => {
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
