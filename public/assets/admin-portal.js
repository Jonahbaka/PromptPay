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
  wireNavigation
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

let sessionToken = null;
let currentUserSearch = "";
let currentPage = "overview";
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
  if (["active", "completed", "enabled"].includes(normalized)) return "status-active";
  if (["pending", "processing"].includes(normalized)) return "status-pending";
  return "status-danger";
}

function renderMetrics(metrics) {
  document.getElementById("metric-users").textContent = formatNumber(metrics.users.total || 0);
  document.getElementById("metric-partners").textContent = formatNumber(metrics.partners.total || 0);
  document.getElementById("metric-volume").textContent = formatCurrency(metrics.transactions.volume || 0, "NGN");
  document.getElementById("metric-audit").textContent = formatNumber(metrics.audit.totalEntries || 0);
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
      <td>${escapeHtml(formatDate(entry.timestamp))}</td>
      <td>${escapeHtml(entry.actor || "-")}</td>
      <td>${escapeHtml(entry.action || "-")}</td>
      <td>${escapeHtml(entry.target || "-")}</td>
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
        <td>${escapeHtml(user.display_name || "-")}<br><span class="muted">${escapeHtml(user.email || "-")}</span></td>
        <td>${escapeHtml(user.role || "-")}</td>
        <td><span class="status-chip ${statusTone(user.status)}">${escapeHtml(user.status || "unknown")}</span></td>
        <td>${escapeHtml(user.tenant_display_name || "-")}</td>
        <td>${escapeHtml(user.last_login_at ? formatDate(user.last_login_at) : "Never")}</td>
        <td>${controls}</td>
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
      <td>${escapeHtml(partner.display_name || "-")}<br><span class="muted">${escapeHtml(partner.contact_email || "-")}</span></td>
      <td><span class="status-chip ${statusTone(partner.status)}">${escapeHtml(partner.status || "unknown")}</span></td>
      <td>${escapeHtml(partner.tier || "-")}</td>
      <td>${escapeHtml(formatNumber(partner.user_count || 0))}</td>
      <td>${escapeHtml(formatCurrency(partner.transaction_volume || 0, "NGN"))}</td>
      <td>
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

async function loadOverview(force = false) {
  if (!force && state.summary && state.activity) {
    renderMetrics(state.summary.metrics);
    renderQueue(state.summary.metrics);
    renderContext(state.summary.metrics);
    renderActivity(state.activity.entries || []);
    return;
  }

  setStatus(loadStatus, "Loading admin portal...");
  const [summary, activity] = await Promise.all([
    authJson("/api/admin/portal/summary", sessionToken),
    authJson("/api/admin/portal/activity", sessionToken)
  ]);

  state.summary = summary;
  state.activity = activity;
  renderMetrics(summary.metrics);
  renderQueue(summary.metrics);
  renderContext(summary.metrics);
  renderActivity(activity.entries || []);
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
    document.getElementById("admin-name").textContent = user.displayName || user.email;
    showShell();
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
