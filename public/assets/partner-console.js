import {
  authJson,
  clearSession,
  escapeHtml,
  formatCurrency,
  formatDate,
  formatNumber,
  getCurrentUser,
  getStoredToken,
  readFileAsDataUrl,
  redirectForRole,
  renderSparkBars,
  requestJson,
  saveSession,
  setLoadingState,
  wireNavigation
} from "/assets/console-core.js";

const MAX_TOTAL_UPLOAD = 4.5 * 1024 * 1024;

const authView = document.getElementById("auth-view");
const authTabs = [...document.querySelectorAll("[data-auth-tab]")];
const authPanels = [...document.querySelectorAll("[data-auth-panel]")];

const loginForm = document.getElementById("login-form");
const loginEmail = document.getElementById("login-email");
const loginPassword = document.getElementById("login-password");
const loginSubmit = document.getElementById("login-submit");
const loginStatus = document.getElementById("login-status");

const applyForm = document.getElementById("apply-form");
const applyTier = document.getElementById("apply-tier");
const applySubmit = document.getElementById("apply-submit");
const applyStatus = document.getElementById("apply-status");
const tierSummary = document.getElementById("tier-summary");
const docInputs = [...document.querySelectorAll("[data-doc-type]")];

const app = document.getElementById("console-app");
const shellStatus = document.getElementById("partner-shell-status");
const loadStatus = document.getElementById("partner-load-status");
const refreshButton = document.getElementById("partner-refresh");
const logoutButton = document.getElementById("partner-logout");
const partnerUser = document.getElementById("partner-user");
const partnerMeta = document.getElementById("partner-meta");
const partnerContext = document.getElementById("partner-context");

const navItems = [...document.querySelectorAll(".nav-item[data-page]")];
const pages = [...document.querySelectorAll(".page")];

const brandingForm = document.getElementById("branding-form");
const brandingName = document.getElementById("branding-name");
const brandingLogo = document.getElementById("branding-logo");
const brandingColor = document.getElementById("branding-color");
const brandingSubmit = document.getElementById("branding-submit");
const brandingStatus = document.getElementById("branding-status");
const brandingNote = document.getElementById("branding-note");

const state = {
  token: "",
  user: null,
  tiers: [],
  partner: null
};

wireNavigation(navItems, pages);

function setAuthTab(mode) {
  authTabs.forEach((tab) => {
    const active = tab.dataset.authTab === mode;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  authPanels.forEach((panel) => panel.classList.toggle("active", panel.dataset.authPanel === mode));
}

function setLoginStatus(message, isError = false) {
  loginStatus.textContent = message;
  loginStatus.style.color = isError ? "#ff8e69" : "";
}

function setApplyStatus(message, isError = false) {
  applyStatus.textContent = message;
  applyStatus.style.color = isError ? "#ff8e69" : "";
}

function setLoadStatus(message, isError = false) {
  loadStatus.textContent = message;
  loadStatus.style.color = isError ? "#ff8e69" : "";
}

function setShellState(label, variant = "success") {
  shellStatus.className = `status-chip ${variant}`;
  shellStatus.textContent = label;
}

function showAuth() {
  authView.classList.remove("hidden");
  app.classList.add("hidden");
}

function showApp() {
  authView.classList.add("hidden");
  app.classList.remove("hidden");
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function setHtml(id, html) {
  const node = document.getElementById(id);
  if (node) node.innerHTML = html;
}

function titleCase(value) {
  return String(value || "")
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatPercent(value) {
  const num = Number(value || 0);
  const prefix = num > 0 ? "+" : "";
  return `${prefix}${num.toFixed(2)}%`;
}

function renderEmptyRow(columns, message) {
  return `<tr><td colspan="${columns}" class="empty-state">${escapeHtml(message)}</td></tr>`;
}

function renderList(items, formatter, fallback) {
  if (!Array.isArray(items) || items.length === 0) {
    return `<div class="empty-state">${escapeHtml(fallback)}</div>`;
  }
  return items.map(formatter).join("");
}

async function fetchJson(url) {
  return authJson(url, state.token);
}

function renderTierSummary() {
  const tier = state.tiers.find((item) => item.name === applyTier.value);
  if (!tier) {
    tierSummary.innerHTML = '<div class="empty-state">Package details are unavailable.</div>';
    return;
  }

  tierSummary.innerHTML = `
    <div class="list-item">
      <div>
        <strong>${escapeHtml(titleCase(tier.name))}</strong>
        <span>${escapeHtml(String(tier.price))} monthly with ${escapeHtml(String(tier.transactionCut))}% transaction cut.</span>
      </div>
      <span class="chip ${tier.whiteLabel ? "success" : ""}">${tier.whiteLabel ? "White label" : "Standard brand"}</span>
    </div>
    <div class="list-item">
      <div>
        <strong>User allowance</strong>
        <span>${escapeHtml(String(tier.maxUsers))} operator accounts and ${escapeHtml(String(tier.apiCalls))} API calls.</span>
      </div>
      <span class="chip">${escapeHtml(String(tier.apiCalls))} calls</span>
    </div>
    <div class="list-item">
      <div>
        <strong>Included features</strong>
        <span>${escapeHtml((tier.features || []).join(", ") || "No features listed.")}</span>
      </div>
      <span class="chip">${formatNumber((tier.features || []).length)} features</span>
    </div>
  `;
}

async function loadTiers() {
  try {
    const payload = await requestJson("/api/partners/tiers");
    state.tiers = payload.tiers || [];
    if (state.tiers.length) {
      applyTier.innerHTML = state.tiers
        .map((tier) => `<option value="${escapeHtml(tier.name)}">${escapeHtml(titleCase(tier.name))}</option>`)
        .join("");
    }
    renderTierSummary();
  } catch {
    renderTierSummary();
  }
}

async function collectDocuments() {
  const documents = {};
  let totalLength = 0;

  for (const input of docInputs) {
    const file = input.files?.[0];
    if (!file) continue;
    const data = await readFileAsDataUrl(file);
    totalLength += String(data).length;

    if (totalLength > MAX_TOTAL_UPLOAD) {
      throw new Error("Combined document upload exceeds 4.5MB for this public application flow.");
    }

    documents[input.dataset.docType] = {
      name: file.name,
      type: file.type || "application/octet-stream",
      data
    };
  }

  return documents;
}

function renderOverview(data) {
  const me = data.me;
  const stats = data.stats;
  const insights = data.insights?.insights || [];
  const transactions = data.transactions?.transactions || [];

  setText("partner-users", formatNumber(stats.totalUsers || 0));
  setText("partner-active", formatNumber(stats.activeUsers || 0));
  setText("partner-volume", formatCurrency(stats.transactionVolume || 0, "USD"));
  setText("partner-revenue", formatCurrency(stats.revenueShare || 0, "USD"));

  setHtml(
    "partner-summary",
    `
      <div class="list-item">
        <div>
          <strong>${escapeHtml(me.displayName || me.name)}</strong>
          <span>${escapeHtml(me.contactEmail || "No contact email")} | ${escapeHtml(titleCase(me.status || "pending"))}</span>
        </div>
        <span class="chip ${me.status === "active" ? "success" : "warning"}">${escapeHtml(titleCase(me.tier || "standard"))}</span>
      </div>
      <div class="list-item">
        <div>
          <strong>Commercial terms</strong>
          <span>${escapeHtml(String(me.limits?.price || "-"))} monthly, ${escapeHtml(String(me.limits?.transactionCut || 0))}% transaction cut.</span>
        </div>
        <span class="chip">${escapeHtml(String(me.limits?.maxUsers || "-"))} users</span>
      </div>
      <div class="list-item">
        <div>
          <strong>Activation timeline</strong>
          <span>Created ${escapeHtml(formatDate(me.createdAt))}${me.activatedAt ? ` | Activated ${escapeHtml(formatDate(me.activatedAt))}` : ""}</span>
        </div>
        <span class="chip ${me.limits?.whiteLabel ? "success" : ""}">${me.limits?.whiteLabel ? "White label enabled" : "Shared brand"}</span>
      </div>
    `
  );

  setHtml(
    "partner-transactions-table",
    transactions.length
      ? transactions
          .slice(0, 8)
          .map(
            (transaction) => `
              <tr>
                <td>${escapeHtml(transaction.display_name || transaction.email || "Unknown user")}</td>
                <td>${escapeHtml(titleCase(transaction.type || "unknown"))}</td>
                <td>${formatCurrency(transaction.amount || 0, "USD")}</td>
                <td><span class="chip ${transaction.status === "completed" ? "success" : transaction.status === "failed" ? "danger" : "warning"}">${escapeHtml(transaction.status || "unknown")}</span></td>
                <td>${escapeHtml(formatDate(transaction.created_at))}</td>
              </tr>
            `
          )
          .join("")
      : renderEmptyRow(5, "No transactions recorded for this partner yet.")
  );

  setHtml(
    "partner-activity-list",
    `
      <div class="list-item">
        <div>
          <strong>Transactions processed</strong>
          <span>${formatNumber(stats.transactionCount || 0)} completed transactions recorded.</span>
        </div>
        <span class="chip success">${formatNumber(stats.newUsersThisMonth || 0)} new this month</span>
      </div>
      <div class="list-item">
        <div>
          <strong>Feature access</strong>
          <span>${escapeHtml((me.limits?.features || []).join(", ") || "No features listed.")}</span>
        </div>
        <span class="chip">${formatNumber((me.limits?.features || []).length)} features</span>
      </div>
      <div class="list-item">
        <div>
          <strong>API readiness</strong>
          <span>${escapeHtml(String(me.limits?.apiCalls || "-"))} calls available in the current package.</span>
        </div>
        <span class="chip">${escapeHtml(titleCase(me.tier || "standard"))}</span>
      </div>
    `
  );

  setHtml(
    "partner-insights",
    renderList(
      insights.slice(0, 4),
      (insight) => `
        <div class="list-item">
          <div>
            <strong>${escapeHtml(insight.title)}</strong>
            <span>${escapeHtml(insight.description)}</span>
          </div>
          <span class="chip ${insight.type === "positive" ? "success" : insight.type === "warning" ? "warning" : ""}">
            ${escapeHtml(insight.category)}
          </span>
        </div>
      `,
      data.insights?.summary || "No partner insights available."
    )
  );
}

function renderRevenue(data) {
  const stats = data.stats;
  const metrics = data.metrics?.metrics || {};
  const sparklines = data.metrics?.sparklines || {};
  const revenue = data.revenue || {};
  const users = data.users?.users || [];

  setText("partner-transactions-count", formatNumber(stats.transactionCount || 0));
  setText("partner-ticket-size", formatCurrency(metrics.avgTransactionSize || 0, "USD"));
  setText("partner-growth", formatPercent(metrics.growth30d || 0));
  setText("partner-new-users", formatNumber(stats.newUsersThisMonth || 0));

  setHtml(
    "partner-trend-cards",
    [
      {
        label: "Volume",
        value: formatCurrency(metrics.totalVolume || 0, "USD"),
        spark: sparklines.volume || []
      },
      {
        label: "Revenue",
        value: formatCurrency(metrics.totalRevenue || 0, "USD"),
        spark: sparklines.revenue || []
      },
      {
        label: "Transactions",
        value: formatNumber(metrics.totalTransactions || 0),
        spark: sparklines.transactions || []
      },
      {
        label: "Users",
        value: formatNumber(metrics.activeUsers || 0),
        spark: sparklines.users || []
      }
    ]
      .map(
        (item) => `
          <article class="metric-card">
            <h3>${escapeHtml(item.label)}</h3>
            <strong>${escapeHtml(item.value)}</strong>
            ${renderSparkBars(item.spark)}
          </article>
        `
      )
      .join("")
  );

  setHtml(
    "partner-revenue-types",
    (revenue.byType || []).length
      ? revenue.byType
          .map(
            (item) => `
              <tr>
                <td>${escapeHtml(titleCase(item.type || "unknown"))}</td>
                <td>${formatCurrency(item.volume || 0, "USD")}</td>
                <td>${formatNumber(item.count || 0)}</td>
              </tr>
            `
          )
          .join("")
      : renderEmptyRow(3, "No revenue mix is available yet.")
  );

  setHtml(
    "partner-user-table",
    users.length
      ? users
          .slice(0, 8)
          .map(
            (user) => `
              <tr>
                <td>${escapeHtml(user.display_name || user.email || "Unknown user")}</td>
                <td>${escapeHtml(titleCase(user.role || "user"))}</td>
                <td><span class="chip ${user.status === "active" ? "success" : "warning"}">${escapeHtml(user.status || "unknown")}</span></td>
                <td>${escapeHtml(user.last_login_at ? formatDate(user.last_login_at) : "No recent login")}</td>
              </tr>
            `
          )
          .join("")
      : renderEmptyRow(4, "No users provisioned yet.")
  );
}

function renderDevelopers(data) {
  const apiUsage = data.apiUsage || { totalCalls: 0, todayCalls: 0, keys: [] };
  const me = data.me;

  setText("partner-api-total", formatNumber(apiUsage.totalCalls || 0));
  setText("partner-api-today", formatNumber(apiUsage.todayCalls || 0));
  setText("partner-api-keys", formatNumber((apiUsage.keys || []).length));
  setText("partner-tier-name", titleCase(me.tier || "standard"));

  setHtml(
    "partner-api-table",
    (apiUsage.keys || []).length
      ? apiUsage.keys
          .map(
            (key) => `
              <tr>
                <td>${escapeHtml(key.name || "Unnamed key")}</td>
                <td class="mono">${escapeHtml(key.api_key_prefix || "-")}</td>
                <td>${formatNumber(key.requests_today || 0)}</td>
                <td>${formatNumber(key.rate_limit || 0)}</td>
                <td><span class="chip ${key.status === "active" ? "success" : "warning"}">${escapeHtml(key.status || "unknown")}</span></td>
              </tr>
            `
          )
          .join("")
      : renderEmptyRow(5, "No API keys have been issued for this partner.")
  );

  setHtml(
    "partner-tier-card",
    `
      <div class="list-item">
        <div>
          <strong>${escapeHtml(titleCase(me.tier || "standard"))}</strong>
          <span>${escapeHtml(String(me.limits?.price || "-"))} monthly with ${escapeHtml(String(me.limits?.transactionCut || 0))}% transaction cut.</span>
        </div>
        <span class="chip ${me.limits?.whiteLabel ? "success" : ""}">${me.limits?.whiteLabel ? "White label" : "Shared brand"}</span>
      </div>
      <div class="list-item">
        <div>
          <strong>Limits</strong>
          <span>${escapeHtml(String(me.limits?.maxUsers || "-"))} users, ${escapeHtml(String(me.limits?.apiCalls || "-"))} API calls.</span>
        </div>
        <span class="chip">${escapeHtml(String(me.limits?.apiCalls || "-"))} calls</span>
      </div>
      <div class="list-item">
        <div>
          <strong>Included features</strong>
          <span>${escapeHtml((me.limits?.features || []).join(", ") || "No features listed.")}</span>
        </div>
        <span class="chip">${formatNumber((me.limits?.features || []).length)} features</span>
      </div>
    `
  );
}

function renderBrandingPreview(partner) {
  setHtml(
    "branding-preview",
    `
      <div class="list-item">
        <div>
          <strong>${escapeHtml(partner.displayName || partner.name)}</strong>
          <span>${escapeHtml(partner.contactEmail || "No contact email")}</span>
        </div>
        <span class="chip ${partner.limits?.whiteLabel ? "success" : "warning"}">${partner.limits?.whiteLabel ? "Custom brand enabled" : "Locked to enterprise"}</span>
      </div>
      <div class="list-item">
        <div>
          <strong>Logo URL</strong>
          <span class="mono">${escapeHtml(partner.logoUrl || "Not configured")}</span>
        </div>
        <span class="chip">${escapeHtml(partner.primaryColor || "#15b87a")}</span>
      </div>
      <div class="list-item">
        <div>
          <strong>Branding status</strong>
          <span>${partner.limits?.whiteLabel ? "Customization is active for this partner tier." : "Upgrade to enterprise to unlock white-label branding."}</span>
        </div>
        <span class="chip">${escapeHtml(titleCase(partner.tier || "standard"))}</span>
      </div>
    `
  );
}

function renderBranding(partner) {
  state.partner = partner;
  brandingName.value = partner.displayName || partner.name || "";
  brandingLogo.value = partner.logoUrl || "";
  brandingColor.value = partner.primaryColor || "#15b87a";
  renderBrandingPreview(partner);

  const canCustomize = Boolean(partner.limits?.whiteLabel);
  [brandingName, brandingLogo, brandingColor, brandingSubmit].forEach((field) => {
    field.disabled = !canCustomize;
  });

  brandingNote.className = `notice ${canCustomize ? "" : "warning"}`.trim();
  brandingNote.textContent = canCustomize
    ? "White-label controls are active for this partner."
    : "White-label branding is available only where the assigned tier permits customization.";
}

async function loadConsole() {
  setShellState("Refreshing", "warning");
  setLoadStatus("Refreshing partner data...");

  const [me, stats, transactions, revenue, apiUsage, users, metrics, insights] = await Promise.all([
    fetchJson("/api/partners/me"),
    fetchJson("/api/partners/me/stats"),
    fetchJson("/api/partners/me/transactions?limit=8"),
    fetchJson("/api/partners/me/revenue?days=30"),
    fetchJson("/api/partners/me/api-usage"),
    fetchJson("/api/partners/me/users?limit=8"),
    fetchJson("/partner-admin/analytics/metrics"),
    fetchJson("/partner-admin/analytics/insights")
  ]);

  const data = {
    me,
    stats,
    transactions,
    revenue,
    apiUsage,
    users,
    metrics,
    insights
  };

  renderOverview(data);
  renderRevenue(data);
  renderDevelopers(data);
  renderBranding(data.me);

  partnerUser.textContent = state.user?.displayName || state.user?.email || "Partner admin";
  partnerMeta.textContent = state.user?.email || "Authenticated";
  partnerContext.textContent = `${titleCase(data.me.tier || "standard")} tier | ${titleCase(data.me.status || "pending")} status`;

  setShellState("Live", "success");
  setLoadStatus(`Last refreshed ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`);
}

async function bootstrap(token, user) {
  state.token = token;
  state.user = user;

  if (user.role !== "partner_admin") {
    redirectForRole(user, "/");
    return;
  }

  showApp();
  await loadConsole();
}

async function handleLogin(event) {
  event.preventDefault();
  const email = loginEmail.value.trim();
  const password = loginPassword.value;

  if (!email || !password) {
    setLoginStatus("Enter email and password.", true);
    return;
  }

  const resetButton = setLoadingState(loginSubmit, "Sign In", "Signing In...");
  setLoginStatus("Authenticating...");

  try {
    const payload = await requestJson("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    saveSession(payload.user, payload.token);
    await bootstrap(payload.token, payload.user);
  } catch (error) {
    setLoginStatus(error.message || "Unable to sign in.", true);
  } finally {
    resetButton();
  }
}

async function handleApply(event) {
  event.preventDefault();

  const name = document.getElementById("apply-name").value.trim();
  const displayName = document.getElementById("apply-display-name").value.trim();
  const contactEmail = document.getElementById("apply-email").value.trim();
  const contactPhone = document.getElementById("apply-phone").value.trim();
  const website = document.getElementById("apply-website").value.trim();
  const tier = applyTier.value;
  const description = document.getElementById("apply-description").value.trim();

  if (!name || !contactEmail) {
    setApplyStatus("Organization name and contact email are required.", true);
    return;
  }

  const resetButton = setLoadingState(applySubmit, "Submit Application", "Submitting...");
  setApplyStatus("Preparing application...");

  try {
    const documents = await collectDocuments();
    const payload = await requestJson("/api/partners/apply", {
      method: "POST",
      body: JSON.stringify({
        name,
        displayName,
        contactEmail,
        contactPhone,
        tier,
        website,
        description,
        documents
      })
    });

    applyForm.reset();
    renderTierSummary();
    setApplyStatus(`Application submitted for ${payload.slug}. Status: ${payload.status}.`);
  } catch (error) {
    setApplyStatus(error.message || "Unable to submit application.", true);
  } finally {
    resetButton();
  }
}

async function handleBrandingSubmit(event) {
  event.preventDefault();

  if (!state.partner?.limits?.whiteLabel) {
    brandingStatus.textContent = "Branding customization requires enterprise white-label access.";
    brandingStatus.style.color = "#ff8e69";
    return;
  }

  const displayName = brandingName.value.trim();
  const logoUrl = brandingLogo.value.trim();
  const primaryColor = brandingColor.value.trim();
  const resetButton = setLoadingState(brandingSubmit, "Save branding", "Saving...");

  brandingStatus.textContent = "Updating branding...";
  brandingStatus.style.color = "";

  try {
    await authJson("/api/partners/me/branding", state.token, {
      method: "PUT",
      body: JSON.stringify({ displayName, logoUrl, primaryColor })
    });
    brandingStatus.textContent = "Branding updated.";
    await loadConsole();
  } catch (error) {
    brandingStatus.textContent = error.message || "Unable to update branding.";
    brandingStatus.style.color = "#ff8e69";
  } finally {
    resetButton();
  }
}

async function hydrate() {
  const token = getStoredToken();
  if (!token) {
    showAuth();
    setShellState("Locked", "warning");
    return;
  }

  try {
    const user = await getCurrentUser(token);
    await bootstrap(token, user);
  } catch {
    clearSession();
    showAuth();
    setShellState("Locked", "warning");
  }
}

authTabs.forEach((tab) => {
  tab.addEventListener("click", () => setAuthTab(tab.dataset.authTab));
});
applyTier.addEventListener("change", renderTierSummary);
loginForm.addEventListener("submit", handleLogin);
applyForm.addEventListener("submit", handleApply);
brandingForm.addEventListener("submit", handleBrandingSubmit);
refreshButton.addEventListener("click", () => {
  loadConsole().catch((error) => {
    setLoadStatus(error.message || "Unable to refresh partner data.", true);
    setShellState("Attention", "danger");
  });
});
logoutButton.addEventListener("click", () => {
  clearSession();
  window.location.assign("/");
});

loadTiers();
hydrate().catch((error) => {
  setLoadStatus(error.message || "Unable to load partner console.", true);
  setShellState("Attention", "danger");
});
