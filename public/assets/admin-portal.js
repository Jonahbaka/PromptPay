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
  requestJson,
  saveSession,
  setLoadingState,
  wireNavigation,
  wireMobileDrawer
} from "./console-core.js";

const authView = document.getElementById("auth-view");
const shell = document.getElementById("admin-shell");
const authStatus = document.getElementById("auth-status");
const loadStatus = document.getElementById("admin-load-status");
const loginForm = document.getElementById("login-form");
const refreshButton = document.getElementById("admin-refresh");
const logoutButton = document.getElementById("admin-logout");
const userSearchForm = document.getElementById("user-search-form");
const tabButtons = [...document.querySelectorAll(".tab-button")];
const tabPanels = [...document.querySelectorAll(".tab-panel")];
const contextActions = document.getElementById("admin-context-actions");
const contextTitle = document.getElementById("admin-context-title");
const contextCopy = document.getElementById("admin-context-copy");
const runtimeLabel = document.getElementById("admin-runtime-status");
const runtimeTime = document.getElementById("admin-runtime-time");
const overviewRefreshButton = document.getElementById("admin-rail-refresh");

let sessionToken = null;
let currentUserSearch = "";
let currentPage = "overview";
let clockTimer = null;
const state = {
  summary: null,
  activity: null,
  users: null,
  partners: null,
  flags: null
};

function setStatus(node, message, isError = false) {
  if (!node) return;
  node.textContent = message;
  node.style.color = isError ? "#ffb4ad" : "#93a2b8";
}

function routeIfWrongRole(user) {
  if (user.role !== "owner") {
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
  wireMobileDrawer();
}

function activatePage(page) {
  currentPage = page;
  tabButtons.forEach((button) => button.classList.toggle("active", button.dataset.page === page));
  tabPanels.forEach((panel) => panel.classList.toggle("active", panel.dataset.page === page));
}

function statusTone(value) {
  const normalized = String(value || "").toLowerCase();
  if (["active", "completed", "enabled"].includes(normalized)) return "status-active";
  if (["pending", "processing"].includes(normalized)) return "status-pending";
  return "status-danger";
}

function alertTone(value) {
  const normalized = String(value || "").toLowerCase();
  if (["success", "active"].includes(normalized)) return "alert-active";
  if (["warning", "pending"].includes(normalized)) return "alert-warning";
  return "alert-danger";
}

function nodeTone(value) {
  const normalized = String(value || "").toLowerCase();
  if (["active", "completed", "enabled"].includes(normalized)) return "active";
  if (["pending", "processing", "warning"].includes(normalized)) return "warning";
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

function renderOpsStream(containerId, items, emptyCopy = "No platform activity stream yet.") {
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

function buildAdminStream(metrics, activity, flags) {
  const items = [];
  const queueCount = Number(metrics.partners.pending || 0) + Number(metrics.partners.suspended || 0) + Number(metrics.users.suspended || 0) + Number(metrics.users.deactivated || 0);
  const disabledFlags = flags.filter((flag) => Number(flag.enabled || 0) !== 1);

  if (queueCount > 0) {
    items.push({
      type: "warning",
      tag: "QUEUE",
      detail: `${formatNumber(queueCount)} platform control item${queueCount === 1 ? "" : "s"} need owner review.`,
      meta: "Users / partners",
      time: "Now"
    });
  }

  activity.slice(-4).reverse().forEach((entry) => {
    items.push({
      type: "active",
      tag: String(entry.action || "audit").replaceAll("_", " ").toUpperCase(),
      detail: `${entry.actor || "system"} / ${entry.target || "platform"}`,
      meta: entry.details?.status ? `Status ${entry.details.status}` : "Audit trail",
      time: entry.timestamp ? formatDate(entry.timestamp) : "Live"
    });
  });

  if (disabledFlags.length > 0) {
    items.push({
      type: "warning",
      tag: "FLAGS",
      detail: `${formatNumber(disabledFlags.length)} stored feature flag${disabledFlags.length === 1 ? "" : "s"} are disabled.`,
      meta: "Feature state",
      time: "Live"
    });
  }

  if (Number(metrics.api.activeKeys || 0) === 0) {
    items.push({
      type: "danger",
      tag: "API",
      detail: "No active developer keys are connected to the platform.",
      meta: "Integration required",
      time: "Live"
    });
  }

  return items.slice(0, 6);
}

function startRuntimeClock() {
  const update = () => {
    runtimeTime.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };
  update();
  if (clockTimer) window.clearInterval(clockTimer);
  clockTimer = window.setInterval(update, 30000);
}

function renderMetrics(metrics) {
  document.getElementById("metric-users").textContent = formatNumber(metrics.users.total || 0);
  document.getElementById("metric-partners").textContent = formatNumber(metrics.partners.total || 0);
  document.getElementById("metric-volume").textContent = formatCurrency(metrics.transactions.volume || 0, "NGN");
  document.getElementById("metric-audit").textContent = formatNumber(metrics.audit.totalEntries || 0);
}

function buildAlerts(metrics, activity, flags) {
  const alerts = [];
  const pendingQueue = Number(metrics.partners.pending || 0);
  const restrictedUsers = Number(metrics.users.suspended || 0) + Number(metrics.users.deactivated || 0);
  const suspendedPartners = Number(metrics.partners.suspended || 0);
  const disabledFlags = flags.filter((flag) => Number(flag.enabled || 0) !== 1);

  if (pendingQueue > 0) {
    alerts.push({ tone: "warning", title: `${formatNumber(pendingQueue)} pending partner request${pendingQueue === 1 ? "" : "s"}`, copy: "Approved onboarding is waiting for owner review." });
  }
  if (restrictedUsers > 0) {
    alerts.push({ tone: "danger", title: "Restricted user accounts need review", copy: `${formatNumber(restrictedUsers)} user account${restrictedUsers === 1 ? "" : "s are"} suspended or deactivated.` });
  }
  if (suspendedPartners > 0) {
    alerts.push({ tone: "warning", title: "Suspended partner tenants detected", copy: `${formatNumber(suspendedPartners)} partner tenant${suspendedPartners === 1 ? "" : "s are"} currently suspended.` });
  }
  if (Number(metrics.api.activeKeys || 0) === 0) {
    alerts.push({ tone: "warning", title: "No active developer keys", copy: "Platform integrations are not connected through any active key right now." });
  }
  if (disabledFlags.length > 0) {
    alerts.push({ tone: "warning", title: `${formatNumber(disabledFlags.length)} feature flag${disabledFlags.length === 1 ? " is" : "s are"} disabled`, copy: "Live platform capability is being shaped by current flag state." });
  }
  if (!alerts.length && activity.length > 0) {
    alerts.push({ tone: "success", title: "Platform control state is stable", copy: "The current queue, flags, and audit stream do not show immediate blockers." });
  }
  if (!alerts.length) {
    alerts.push({ tone: "pending", title: "No platform activity yet", copy: "Real queue and audit signals will appear here as the platform is used." });
  }
  return alerts.slice(0, 4);
}

function renderAlertFeed(alerts) {
  const feed = document.getElementById("admin-alert-feed");
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

function renderHero(metrics, activity, flags) {
  const queueCount = Number(metrics.partners.pending || 0) + Number(metrics.partners.suspended || 0) + Number(metrics.users.suspended || 0) + Number(metrics.users.deactivated || 0);
  const enabledFlags = flags.filter((flag) => Number(flag.enabled || 0) === 1);
  const lastAudit = activity[activity.length - 1];

  document.getElementById("admin-live-users").textContent = `Users: ${formatNumber(metrics.users.total || 0)}`;
  document.getElementById("admin-live-partners").textContent = `Partners: ${formatNumber(metrics.partners.total || 0)}`;
  document.getElementById("admin-live-volume").textContent = `Volume: ${formatCurrency(metrics.transactions.volume || 0, "NGN")}`;
  document.getElementById("admin-signal-queue").textContent = `${formatNumber(queueCount)} item${queueCount === 1 ? "" : "s"}`;
  document.getElementById("admin-signal-audit").textContent = lastAudit?.timestamp ? formatDate(lastAudit.timestamp) : "No recent audit activity";
  document.getElementById("admin-signal-flags").textContent = `${formatNumber(enabledFlags.length)} enabled`;
  document.getElementById("admin-signal-queue-copy").textContent = queueCount > 0
    ? "Pending partner and restricted account states need owner attention."
    : "No pending or restricted control items are currently queued.";
  document.getElementById("admin-signal-audit-copy").textContent = lastAudit?.timestamp
    ? `${String(lastAudit.action || "Recent activity")} was the latest recorded admin-relevant event.`
    : "The audit trail has not recorded owner-visible activity yet.";
  document.getElementById("admin-signal-flags-copy").textContent = `${formatNumber(enabledFlags.length)} of ${formatNumber(flags.length)} stored flags are enabled.`;
  runtimeLabel.textContent = queueCount > 0
    ? `${formatNumber(queueCount)} control item${queueCount === 1 ? "" : "s"} need review`
    : `${formatNumber(metrics.users.active || 0)} active users / ${formatNumber(metrics.partners.active || 0)} active partners`;
}

function renderHealthGrid(metrics, activity, flags) {
  const enabledFlags = flags.filter((flag) => Number(flag.enabled || 0) === 1);
  const lastAudit = activity[activity.length - 1];
  const items = [
    {
      label: "Active users",
      value: `${formatNumber(metrics.users.active || 0)} / ${formatNumber(metrics.users.total || 0)}`,
      copy: "Current active user records."
    },
    {
      label: "Partner queue",
      value: formatNumber((metrics.partners.pending || 0) + (metrics.partners.suspended || 0)),
      copy: "Pending and suspended partner tenants."
    },
    {
      label: "API keys",
      value: formatNumber(metrics.api.activeKeys || 0),
      copy: `${formatNumber(metrics.api.requestsToday || 0)} requests logged today.`
    },
    {
      label: "Last audit",
      value: lastAudit?.timestamp ? formatDate(lastAudit.timestamp) : "No entries",
      copy: `${formatNumber(enabledFlags.length)} of ${formatNumber(flags.length)} flags enabled.`
    }
  ];
  document.getElementById("admin-health-grid").innerHTML = items.map((item) => `
    <article class="mini-stat-card">
      <span>${escapeHtml(item.label)}</span>
      <strong>${escapeHtml(item.value)}</strong>
      <small>${escapeHtml(item.copy)}</small>
    </article>
  `).join("");
}

function renderOverviewStage(metrics, flags) {
  const stage = document.getElementById("admin-stage");
  const badge = document.getElementById("admin-stage-badge");
  const usersNode = document.getElementById("admin-stage-users");
  const queueNode = document.getElementById("admin-stage-queue");
  const flagsNode = document.getElementById("admin-stage-flags");
  if (!stage || !badge || !usersNode || !queueNode || !flagsNode) return;

  const queueCount = Number(metrics.partners.pending || 0) + Number(metrics.partners.suspended || 0) + Number(metrics.users.suspended || 0) + Number(metrics.users.deactivated || 0);
  const enabledFlags = flags.filter((flag) => Number(flag.enabled || 0) === 1).length;
  const totalFlags = flags.length;

  badge.textContent = queueCount > 0 ? "Review" : "Stable";
  usersNode.textContent = formatNumber(metrics.users.total || 0);
  queueNode.textContent = formatNumber(queueCount);
  flagsNode.textContent = `${formatNumber(enabledFlags)} / ${formatNumber(totalFlags)}`;

  const canvas = ensureStageCanvas(stage);
  if (!canvas) return;
  const positions = [
    { x: 24, y: 28, tone: nodeTone((metrics.users.active || 0) > 0 ? "active" : "warning"), note: `USERS / ${formatNumber(metrics.users.active || 0)} ACTIVE` },
    { x: 74, y: 28, tone: nodeTone((metrics.partners.active || 0) > 0 ? "active" : "warning"), note: `PARTNERS / ${formatNumber(metrics.partners.active || 0)} ACTIVE` },
    { x: 72, y: 74, tone: queueCount > 0 ? "warning" : "active", note: `QUEUE / ${formatNumber(queueCount)} ITEMS` },
    { x: 24, y: 74, tone: enabledFlags === totalFlags ? "active" : "warning", note: `FLAGS / ${formatNumber(enabledFlags)} OF ${formatNumber(totalFlags)}` }
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

function renderOverviewStats(metrics, flags) {
  const primaryBadge = document.getElementById("admin-primary-badge");
  const primaryValue = document.getElementById("admin-primary-value");
  const primaryCopy = document.getElementById("admin-primary-copy");
  const secondaryValue = document.getElementById("admin-secondary-value");
  const secondaryCopy = document.getElementById("admin-secondary-copy");
  if (!primaryBadge || !primaryValue || !primaryCopy || !secondaryValue || !secondaryCopy) return;

  const completedTransactions = Number(metrics.transactions.completed || 0);
  const enabledFlags = flags.filter((flag) => Number(flag.enabled || 0) === 1).length;

  primaryBadge.textContent = completedTransactions > 0 ? `${formatNumber(completedTransactions)} txs` : "Live";
  primaryValue.textContent = formatCurrency(metrics.transactions.volume || 0, "NGN");
  primaryCopy.textContent = completedTransactions > 0
    ? `${formatNumber(completedTransactions)} completed POS transaction${completedTransactions === 1 ? "" : "s"} contribute to this volume.`
    : "Completed platform volume will appear here as real POS records close.";

  secondaryValue.textContent = `${formatNumber(enabledFlags)} enabled`;
  secondaryCopy.textContent = `${formatNumber(enabledFlags)} of ${formatNumber(flags.length)} stored feature flags are currently enabled.`;
}

function renderQueue(metrics) {
  document.getElementById("admin-queue-summary").innerHTML = `
    <div><dt>Pending partners</dt><dd>${escapeHtml(formatNumber(metrics.partners.pending || 0))}</dd></div>
    <div><dt>Suspended partners</dt><dd>${escapeHtml(formatNumber(metrics.partners.suspended || 0))}</dd></div>
    <div><dt>Suspended users</dt><dd>${escapeHtml(formatNumber(metrics.users.suspended || 0))}</dd></div>
    <div><dt>Disabled users</dt><dd>${escapeHtml(formatNumber(metrics.users.deactivated || 0))}</dd></div>
  `;
}

function renderContext(metrics) {
  const actions = [];

  if ((metrics.partners.pending || 0) > 0) {
    actions.push({
      title: `Review ${formatNumber(metrics.partners.pending)} pending partner request${metrics.partners.pending === 1 ? "" : "s"}`,
      description: "Pending partner applications are ready for owner review.",
      page: "partners"
    });
  }

  if ((metrics.users.suspended || 0) > 0 || (metrics.users.deactivated || 0) > 0) {
    actions.push({
      title: "Review restricted users",
      description: "Suspended or deactivated user accounts need owner attention.",
      page: "users"
    });
  }

  if ((metrics.partners.suspended || 0) > 0) {
    actions.push({
      title: "Review partner status changes",
      description: "Some partner tenants are suspended and may need action.",
      page: "partners"
    });
  }

  if ((metrics.audit.totalEntries || 0) > 0) {
    actions.push({
      title: "Inspect recent platform activity",
      description: "The audit trail has recent entries available for owner review.",
      page: "overview",
      target: "admin-activity-card"
    });
  } else {
    actions.push({
      title: "No platform activity yet",
      description: "Audit logs will appear here automatically as real actions are recorded.",
      page: "overview"
    });
  }

  const primary = actions[0] || {
    title: "Platform overview is current",
    description: "PromptPay is highlighting the next real control task based on database state."
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
    button.addEventListener("click", async () => {
      const page = button.getAttribute("data-action-page");
      const target = button.getAttribute("data-action-target");
      activatePage(page);
      if (page === "users") {
        await loadUsers();
      }
      if (page === "partners") {
        await loadPartners();
      }
      if (target) {
        requestAnimationFrame(() => {
          document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
      }
    });
  });
}

function renderActivity(entries) {
  const tbody = document.getElementById("activity-list");
  if (!entries.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">No activity logs found.</td></tr>`;
    return;
  }

  tbody.innerHTML = entries.map((entry) => `
    <tr>
      <td data-label="Time">${escapeHtml(formatDate(entry.timestamp))}</td>
      <td data-label="Actor">${escapeHtml(entry.actor || "-")}</td>
      <td data-label="Action">${escapeHtml(entry.action || "-")}</td>
      <td data-label="Target">${escapeHtml(entry.target || "-")}</td>
    </tr>
  `).join("");
}

function renderUsers(users) {
  const tbody = document.getElementById("users-table");
  if (!users.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No users found.</td></tr>`;
    return;
  }

  tbody.innerHTML = users.map((user) => {
    const controls = user.role === "owner"
      ? `<span class="muted">Protected</span>`
      : `
        <div class="inline-controls">
          <button class="button button-secondary button-small" type="button" data-user-status="${escapeHtml(user.id)}:active">Activate</button>
          <button class="button button-secondary button-small" type="button" data-user-status="${escapeHtml(user.id)}:suspended">Suspend</button>
          <button class="button button-secondary button-small" type="button" data-user-status="${escapeHtml(user.id)}:deactivated">Deactivate</button>
        </div>
      `;

    return `
      <tr>
        <td data-label="User">${escapeHtml(user.display_name || "-")}<br><span class="muted">${escapeHtml(user.email || "-")}</span></td>
        <td data-label="Role">${escapeHtml(user.role || "-")}</td>
        <td data-label="Status"><span class="status-chip ${statusTone(user.status)}">${escapeHtml(user.status || "unknown")}</span></td>
        <td data-label="Tenant">${escapeHtml(user.tenant_display_name || "-")}</td>
        <td data-label="Last login">${escapeHtml(user.last_login_at ? formatDate(user.last_login_at) : "Never")}</td>
        <td data-label="Controls">${controls}</td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll("[data-user-status]").forEach((button) => {
    button.addEventListener("click", async () => {
      const [id, status] = button.getAttribute("data-user-status").split(":");
      await updateUserStatus(id, status);
    });
  });
}

function renderPartners(partners) {
  const tbody = document.getElementById("partners-table");
  if (!partners.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No partners found.</td></tr>`;
    return;
  }

  tbody.innerHTML = partners.map((partner) => `
    <tr>
      <td data-label="Partner">${escapeHtml(partner.display_name || "-")}<br><span class="muted">${escapeHtml(partner.contact_email || "-")}</span></td>
      <td data-label="Status"><span class="status-chip ${statusTone(partner.status)}">${escapeHtml(partner.status || "unknown")}</span></td>
      <td data-label="Tier">${escapeHtml(partner.tier || "-")}</td>
      <td data-label="Users">${escapeHtml(formatNumber(partner.user_count || 0))}</td>
      <td data-label="Volume">${escapeHtml(formatCurrency(partner.transaction_volume || 0, "NGN"))}</td>
      <td data-label="Controls">
        <div class="inline-controls">
          <button class="button button-secondary button-small" type="button" data-partner-status="${escapeHtml(partner.id)}:active">Activate</button>
          <button class="button button-secondary button-small" type="button" data-partner-status="${escapeHtml(partner.id)}:suspended">Suspend</button>
          <button class="button button-secondary button-small" type="button" data-partner-status="${escapeHtml(partner.id)}:deactivated">Deactivate</button>
        </div>
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll("[data-partner-status]").forEach((button) => {
    button.addEventListener("click", async () => {
      const [id, status] = button.getAttribute("data-partner-status").split(":");
      await updatePartnerStatus(id, status);
    });
  });
}

function renderFlags(flags) {
  const container = document.getElementById("feature-flags");
  if (!flags.length) {
    container.innerHTML = `<div class="empty-state">No feature flags found.</div>`;
    return;
  }

  container.innerHTML = flags.map((flag) => `
    <article class="stack-item">
      <header>
        <div>
          <strong>${escapeHtml(flag.key)}</strong>
          <p>${escapeHtml(flag.description || "No description provided.")}</p>
        </div>
        <label class="checkbox-field inline-checkbox">
          <input type="checkbox" ${flag.enabled === 1 ? "checked" : ""} data-flag-key="${escapeHtml(flag.key)}">
          <span>${flag.enabled === 1 ? "Enabled" : "Disabled"}</span>
        </label>
      </header>
    </article>
  `).join("");

  container.querySelectorAll("[data-flag-key]").forEach((input) => {
    input.addEventListener("change", async () => {
      await updateFeatureFlag(input.getAttribute("data-flag-key"), input.checked);
    });
  });
}

function renderOverviewSurface(summary, activity, flags) {
  renderMetrics(summary.metrics);
  renderQueue(summary.metrics);
  renderContext(summary.metrics);
  renderActivity(activity.entries || []);
  renderHero(summary.metrics, activity.entries || [], flags.flags || []);
  renderAlertFeed(buildAlerts(summary.metrics, activity.entries || [], flags.flags || []));
  renderOverviewStage(summary.metrics, flags.flags || []);
  renderOverviewStats(summary.metrics, flags.flags || []);
  renderOpsStream("admin-stream", buildAdminStream(summary.metrics, activity.entries || [], flags.flags || []));
  renderHealthGrid(summary.metrics, activity.entries || [], flags.flags || []);
}

async function loadOverview(force = false) {
  if (!force && state.summary && state.activity && state.flags) {
    renderOverviewSurface(state.summary, state.activity, state.flags);
    return;
  }

  setStatus(loadStatus, "Loading admin portal...");
  const [summary, activity, flags] = await Promise.all([
    authJson("/api/admin/portal/summary", sessionToken),
    authJson("/api/admin/portal/activity", sessionToken),
    authJson("/api/admin/portal/feature-flags", sessionToken)
  ]);

  state.summary = summary;
  state.activity = activity;
  state.flags = flags;
  renderOverviewSurface(summary, activity, flags);
  setStatus(loadStatus, "");
}

async function loadUsers(force = false) {
  if (!force && state.users) {
    renderUsers(state.users.users || []);
    return;
  }

  setStatus(loadStatus, "Loading users...");
  const users = await authJson(`/api/admin/portal/users${currentUserSearch ? `?search=${encodeURIComponent(currentUserSearch)}` : ""}`, sessionToken);
  state.users = users;
  renderUsers(users.users || []);
  setStatus(loadStatus, "");
}

async function loadPartners(force = false) {
  if (!force && state.partners) {
    renderPartners(state.partners.partners || []);
    return;
  }

  setStatus(loadStatus, "Loading partners...");
  const partners = await authJson("/api/admin/portal/partners", sessionToken);
  state.partners = partners;
  renderPartners(partners.partners || []);
  setStatus(loadStatus, "");
}

async function loadFlags(force = false) {
  if (!force && state.flags) {
    renderFlags(state.flags.flags || []);
    return;
  }

  setStatus(loadStatus, "Loading feature flags...");
  const flags = await authJson("/api/admin/portal/feature-flags", sessionToken);
  state.flags = flags;
  renderFlags(flags.flags || []);
  setStatus(loadStatus, "");
}

async function updateUserStatus(userId, status) {
  try {
    await authJson(`/api/admin/portal/users/${userId}/status`, sessionToken, {
      method: "PUT",
      body: JSON.stringify({ status })
    });
    state.users = null;
    state.summary = null;
    await Promise.all([loadOverview(true), loadUsers(true)]);
  } catch (error) {
    setStatus(loadStatus, error.message || "Unable to update user status.", true);
  }
}

async function updatePartnerStatus(partnerId, status) {
  try {
    await authJson(`/api/admin/portal/partners/${partnerId}/status`, sessionToken, {
      method: "PUT",
      body: JSON.stringify({ status })
    });
    state.partners = null;
    state.summary = null;
    await Promise.all([loadOverview(true), loadPartners(true)]);
  } catch (error) {
    setStatus(loadStatus, error.message || "Unable to update partner status.", true);
  }
}

async function updateFeatureFlag(key, enabled) {
  try {
    await authJson(`/api/admin/portal/feature-flags/${encodeURIComponent(key)}`, sessionToken, {
      method: "PUT",
      body: JSON.stringify({ enabled })
    });
    state.flags = null;
    await loadFlags(true);
  } catch (error) {
    setStatus(loadStatus, error.message || "Unable to update feature flag.", true);
  }
}

async function handleLoginRequest(requestPromise) {
  const payload = await requestPromise;
  saveSession(payload.user, payload.token);
  if (routeIfWrongRole(payload.user)) return;
  sessionToken = payload.token;
  document.getElementById("admin-name").textContent = payload.user.displayName || payload.user.email;
  const dn = document.getElementById("drawer-admin-name");
  if (dn) dn.textContent = payload.user.displayName || payload.user.email;
  showShell();
  startRuntimeClock();
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
    document.getElementById("admin-name").textContent = user.displayName || user.email;
    const dn2 = document.getElementById("drawer-admin-name");
    if (dn2) dn2.textContent = user.displayName || user.email;
    showShell();
    startRuntimeClock();
    await loadOverview(true);
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
    state.summary = null;
    state.activity = null;
    state.flags = null;
    if (currentPage === "users") state.users = null;
    if (currentPage === "partners") state.partners = null;
    if (currentPage === "flags") state.flags = null;
    await loadOverview(true);
    if (currentPage === "users") await loadUsers(true);
    if (currentPage === "partners") await loadPartners(true);
    if (currentPage === "flags") await loadFlags(true);
  } catch (error) {
    setStatus(loadStatus, error.message || "Unable to refresh admin portal.", true);
  }
});

overviewRefreshButton?.addEventListener("click", async () => {
  try {
    state.summary = null;
    state.activity = null;
    state.flags = null;
    await loadOverview(true);
  } catch (error) {
    setStatus(loadStatus, error.message || "Unable to refresh admin portal.", true);
  }
});

logoutButton.addEventListener("click", () => {
  clearSession();
  sessionToken = null;
  state.summary = null;
  state.activity = null;
  state.users = null;
  state.partners = null;
  state.flags = null;
  showAuth();
  window.location.assign("/admin");
});

userSearchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  currentUserSearch = document.getElementById("user-search-input").value.trim();
  state.users = null;
  await loadUsers(true);
});

document.querySelectorAll("[data-switch-page]").forEach((button) => {
  button.addEventListener("click", () => activatePage(button.getAttribute("data-switch-page")));
});

wireNavigation(tabButtons, tabPanels, async (page) => {
  currentPage = page;
  try {
    if (page === "users") await loadUsers();
    if (page === "partners") await loadPartners();
    if (page === "flags") await loadFlags();
  } catch (error) {
    setStatus(loadStatus, error.message || "Unable to load admin data.", true);
  }
});

hydrate();
