import {
  authJson,
  clearSession,
  escapeHtml,
  formatCurrency,
  formatDate,
  formatNumber,
  getCurrentUser,
  getStoredToken,
  requestTestAccess,
  redirectForRole,
  renderSparkBars,
  requestJson,
  saveSession,
  setLoadingState,
  wireNavigation
} from "/assets/console-core.js";

const authView = document.getElementById("auth-view");
const authForm = document.getElementById("login-form");
const authStatus = document.getElementById("auth-status");
const authEmail = document.getElementById("auth-email");
const authPassword = document.getElementById("auth-password");
const loginSubmit = document.getElementById("login-submit");
const testAdminAccess = document.getElementById("test-admin-access");

const app = document.getElementById("console-app");
const shellStatus = document.getElementById("shell-status");
const loadStatus = document.getElementById("load-status");
const refreshButton = document.getElementById("refresh-data");
const logoutButton = document.getElementById("logout-button");
const adminUser = document.getElementById("admin-user");
const adminMeta = document.getElementById("admin-meta");
const sidebarContext = document.getElementById("sidebar-context");

const navItems = [...document.querySelectorAll(".nav-item[data-page]")];
const pages = [...document.querySelectorAll(".page")];

const state = {
  token: "",
  user: null
};

wireNavigation(navItems, pages);

function setAuthStatus(message, isError = false) {
  authStatus.textContent = message;
  authStatus.style.color = isError ? "#ff8e69" : "";
}

function setLoadStatus(message, isError = false) {
  loadStatus.textContent = message;
  loadStatus.style.color = isError ? "#ff8e69" : "";
}

function showAuth() {
  authView.classList.remove("hidden");
  app.classList.add("hidden");
}

function showApp() {
  authView.classList.add("hidden");
  app.classList.remove("hidden");
}

function setShellState(label, variant = "success") {
  shellStatus.className = `status-chip ${variant}`;
  shellStatus.textContent = label;
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function setHtml(id, html) {
  const node = document.getElementById(id);
  if (node) node.innerHTML = html;
}

function formatPercent(value) {
  const num = Number(value || 0);
  const prefix = num > 0 ? "+" : "";
  return `${prefix}${num.toFixed(2)}%`;
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds || 0)));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
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

function renderKeyValue(rows) {
  return rows
    .map(
      (row) => `
        <div class="kv-row">
          <span>${escapeHtml(row.label)}</span>
          <strong>${escapeHtml(row.value)}</strong>
        </div>
      `
    )
    .join("");
}

async function fetchJson(url, optional = false) {
  try {
    return await authJson(url, state.token);
  } catch (error) {
    if (optional) return null;
    throw error;
  }
}

function renderOverview(data) {
  const dashboard = data.dashboard;
  const providers = data.providers?.providers || [];
  const audit = data.audit?.entries || [];
  const metrics = data.analyticsMetrics?.metrics || {};
  const insights = data.insights?.insights || [];
  const verify = data.auditVerify || { valid: false, totalEntries: 0 };
  const channels = Array.isArray(dashboard.channels) ? dashboard.channels : [];
  const activeChannels = channels.filter((channel) => channel.active).length;

  setText("metric-uptime", formatDuration(dashboard.uptime));
  setText("metric-volume", formatCurrency(metrics.totalVolume || 0, "USD"));
  setText("metric-revenue", formatCurrency(metrics.totalRevenue || 0, "USD"));
  setText("metric-audit", formatNumber(dashboard.auditEntries || 0));

  setHtml(
    "providers-table",
    providers.length
      ? providers
          .map(
            (provider) => `
              <tr>
                <td>${escapeHtml(provider.name)}</td>
                <td><span class="chip ${provider.status === "healthy" ? "success" : provider.status === "degraded" ? "warning" : "danger"}">${escapeHtml(provider.status)}</span></td>
                <td>${escapeHtml(provider.circuitBreaker?.state || "closed")}</td>
                <td>${formatNumber(provider.circuitBreaker?.failures || 0)}</td>
              </tr>
            `
          )
          .join("")
      : renderEmptyRow(4, "No providers available.")
  );

  setHtml(
    "audit-table",
    audit.length
      ? [...audit]
          .reverse()
          .slice(0, 8)
          .map(
            (entry) => `
              <tr>
                <td>${escapeHtml(formatDate(entry.timestamp))}</td>
                <td>${escapeHtml(entry.actor)}</td>
                <td>${escapeHtml(entry.action)}</td>
                <td>${escapeHtml(entry.target)}</td>
              </tr>
            `
          )
          .join("")
      : renderEmptyRow(4, "Audit trail is empty.")
  );

  setHtml(
    "overview-status",
    renderKeyValue([
      {
        label: "Orchestrator",
        value: dashboard.orchestrator?.isRunning
          ? `${dashboard.orchestrator.agentCount || 0} agents live`
          : "Offline"
      },
      {
        label: "Queued tasks",
        value: formatNumber(dashboard.orchestrator?.taskCount || 0)
      },
      {
        label: "Execution log",
        value: formatNumber(dashboard.memory?.executionLogs || 0)
      },
      {
        label: "Channels active",
        value: `${activeChannels}/${channels.length}`
      },
      {
        label: "Audit verification",
        value: verify.valid ? `Healthy (${verify.totalEntries} entries)` : "Attention required"
      }
    ])
  );

  setHtml(
    "overview-insights",
    renderList(
      insights.slice(0, 3),
      (insight) => `
        <div class="list-item">
          <div>
            <strong>${escapeHtml(insight.title)}</strong>
            <span>${escapeHtml(insight.description)}</span>
          </div>
          <span class="chip ${insight.type === "positive" ? "success" : insight.type === "warning" ? "warning" : ""}">
            ${escapeHtml(insight.impact_level)}
          </span>
        </div>
      `,
      data.insights?.summary || "No active platform insights."
    )
  );
}

function renderNetwork(data) {
  const network = data.agentsNetwork || {};
  const agentAccounts = Array.isArray(network.agents) ? network.agents : [];
  const partnerRankings = data.partnerRankings?.rankings || [];
  const atRisk = data.partnerRankings?.atRisk || [];
  const agents = data.agents || { count: 0, registeredRoles: [] };

  setText("network-agents", formatNumber(network.count || 0));
  setText("network-float", formatCurrency(network.totalFloat || 0, "USD"));
  setText("network-commissions", formatCurrency(network.totalCommissions || 0, "USD"));
  setText("network-transactions", formatNumber(network.transactionsToday || 0));

  setHtml(
    "agents-table",
    agentAccounts.length
      ? agentAccounts
          .slice()
          .sort((left, right) => Number(right.floatBalance || 0) - Number(left.floatBalance || 0))
          .slice(0, 10)
          .map(
            (agent) => `
              <tr>
                <td class="mono">${escapeHtml(String(agent.userId || "Unknown"))}</td>
                <td>${escapeHtml([agent.locationCity, agent.locationCountry].filter(Boolean).join(", ") || "Unassigned")}</td>
                <td>${formatCurrency(agent.floatBalance || 0, "USD")}</td>
                <td>${formatCurrency(agent.commissionEarned || 0, "USD")}</td>
                <td><span class="chip ${agent.status === "active" ? "success" : "warning"}">${escapeHtml(agent.status || "unknown")}</span></td>
              </tr>
            `
          )
          .join("")
      : renderEmptyRow(5, "No active agent accounts yet.")
  );

  setHtml(
    "partners-table",
    partnerRankings.length
      ? partnerRankings
          .slice(0, 8)
          .map(
            (partner) => `
              <tr>
                <td>${escapeHtml(partner.partnerName || partner.partnerId || "Unknown partner")}</td>
                <td>${formatCurrency(partner.volume || 0, "USD")}</td>
                <td>${formatCurrency(partner.revenue || 0, "USD")}</td>
                <td>${formatNumber(partner.transactions || 0)}</td>
              </tr>
            `
          )
          .join("")
      : renderEmptyRow(4, "No partner rankings available.")
  );

  const territories = [
    ...new Set(
      agentAccounts
        .map((agent) => [agent.locationCity, agent.locationCountry].filter(Boolean).join(", "))
        .filter(Boolean)
    )
  ];

  setHtml(
    "coverage-list",
    `
      <div class="list-item">
        <div>
          <strong>Registered operator roles</strong>
          <span>${escapeHtml((agents.registeredRoles || []).join(", ") || "No roles registered.")}</span>
        </div>
        <span class="chip success">${formatNumber(agents.count || 0)} system agents</span>
      </div>
      <div class="list-item">
        <div>
          <strong>Territory visibility</strong>
          <span>${escapeHtml(territories.slice(0, 6).join(" | ") || "No active territories yet.")}</span>
        </div>
        <span class="chip">${formatNumber(territories.length)} territories</span>
      </div>
      <div class="list-item">
        <div>
          <strong>Partners needing review</strong>
          <span>${escapeHtml(atRisk.map((partner) => partner.partnerName || partner.partnerId).slice(0, 3).join(", ") || "No at-risk partners flagged.")}</span>
        </div>
        <span class="chip ${atRisk.length ? "warning" : "success"}">${formatNumber(atRisk.length)} at risk</span>
      </div>
    `
  );
}

function renderIntelligence(data) {
  const metrics = data.analyticsMetrics?.metrics || {};
  const sparklines = data.analyticsMetrics?.sparklines || {};
  const insights = data.insights?.insights || [];
  const cashFlowRows = data.cashFlow?.balanceProjection || [];
  const lowLiquidity = Boolean(data.cashFlow?.lowLiquidityWarning);

  setText("intel-transactions", formatNumber(metrics.totalTransactions || 0));
  setText("intel-active-users", formatNumber(metrics.activeUsers || 0));
  setText("intel-partners", formatNumber(metrics.activePartners || 0));
  setText("intel-growth", formatPercent(metrics.growth30d || 0));

  setHtml(
    "trend-cards",
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
    "insight-list",
    renderList(
      insights.slice(0, 6),
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
      data.insights?.summary || "No intelligence available."
    )
  );

  setHtml(
    "cashflow-table",
    cashFlowRows.length
      ? cashFlowRows
          .slice(0, 8)
          .map(
            (row) => `
              <tr>
                <td>${escapeHtml(String(row.period || ""))}</td>
                <td>${formatCurrency(row.inflow || 0, "USD")}</td>
                <td>${formatCurrency(row.outflow || 0, "USD")}</td>
                <td><span class="chip ${Number(row.balance || 0) < 0 ? "danger" : "success"}">${formatCurrency(row.balance || 0, "USD")}</span></td>
              </tr>
            `
          )
          .join("")
      : renderEmptyRow(4, lowLiquidity ? "Projection unavailable while liquidity warning is active." : "No forecast data available.")
  );
}

function renderGovernance(data) {
  const partners = data.dashboard.partners || {};
  const posSettings = data.posSettings?.settings || {};
  const platformFee = Number(posSettings.pos_platform_fee_pct?.value || 0);
  const config = data.config || {};
  const configEntries = Object.entries(config);
  const roles = data.roles?.roles || [];

  setText("gov-partners", formatNumber(partners.total || 0));
  setText("gov-pending", formatNumber(partners.pending || 0));
  setText("gov-platform-fee", `${platformFee.toFixed(1)}%`);
  setText("gov-config", formatNumber(configEntries.length));
  document.getElementById("platform-fee-input").value = String(platformFee || 0);

  setHtml(
    "roles-table",
    roles.length
      ? roles
          .slice(0, 10)
          .map(
            (role) => `
              <tr>
                <td>
                  <strong>${escapeHtml(role.name)}</strong><br>
                  <span>${escapeHtml(role.description || "No description")}</span>
                </td>
                <td>${formatNumber(role.hierarchyLevel || 0)}</td>
                <td>${escapeHtml((role.permissions || []).slice(0, 4).join(", ") || "No permissions listed")}</td>
              </tr>
            `
          )
          .join("")
      : renderEmptyRow(3, "Role catalog unavailable for this session.")
  );

  setHtml(
    "config-list",
    configEntries.length
      ? configEntries
          .slice(0, 6)
          .map(
            ([section, values]) => `
              <div class="list-item">
                <div>
                  <strong>${escapeHtml(section)}</strong>
                  <span>${escapeHtml(Object.keys(values || {}).join(", ") || "No keys exposed")}</span>
                </div>
                <span class="chip">${formatNumber(Object.keys(values || {}).length)} keys</span>
              </div>
            `
          )
          .join("")
      : '<div class="empty-state">No configuration data available.</div>'
  );

  setHtml(
    "governance-note",
    `
      <div class="stack-tight">
        <div>PromptPay is the orchestration, observability, and governance layer for agent payment networks.</div>
        <div>Active partners: <strong>${formatNumber(partners.active || 0)}</strong></div>
        <div>Total operator users: <strong>${formatNumber(partners.totalUsers || 0)}</strong></div>
        <div>Domain: <span class="mono">${escapeHtml(data.dashboard.domain || "https://www.upromptpay.com")}</span></div>
      </div>
    `
  );
}

async function loadConsole() {
  setShellState("Refreshing", "warning");
  setLoadStatus("Refreshing operator data...");

  const [
    dashboard,
    providers,
    agentsNetwork,
    agents,
    audit,
    auditVerify,
    analyticsMetrics,
    insights,
    cashFlow,
    partnerRankings,
    posSettings,
    config,
    roles
  ] = await Promise.all([
    fetchJson("/admin/dashboard"),
    fetchJson("/admin/providers"),
    fetchJson("/admin/agents-network"),
    fetchJson("/admin/agents"),
    fetchJson("/admin/audit?limit=12"),
    fetchJson("/admin/audit/verify"),
    fetchJson("/super-analytics/metrics"),
    fetchJson("/super-analytics/insights"),
    fetchJson("/super-analytics/cash-flow?days=14"),
    fetchJson("/super-analytics/partners?sort=volume"),
    fetchJson("/admin/pos/settings"),
    fetchJson("/admin/config", true),
    fetchJson("/admin/roles", true)
  ]);

  const data = {
    dashboard,
    providers,
    agentsNetwork,
    agents,
    audit,
    auditVerify,
    analyticsMetrics,
    insights,
    cashFlow,
    partnerRankings,
    posSettings,
    config,
    roles
  };

  renderOverview(data);
  renderNetwork(data);
  renderIntelligence(data);
  renderGovernance(data);

  adminUser.textContent = state.user?.displayName || state.user?.email || "Owner";
  adminMeta.textContent = state.user?.email || "Authenticated";
  sidebarContext.textContent = dashboard.tenantId
    ? `Tenant scoped session: ${dashboard.tenantId}`
    : `${dashboard.partners?.active || 0} active partners across ${dashboard.orchestrator?.agentCount || 0} agents`;

  setShellState("Live", "success");
  setLoadStatus(`Last refreshed ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`);
}

async function bootstrap(token, user) {
  state.token = token;
  state.user = user;

  if (user.role !== "owner") {
    redirectForRole(user, "/");
    return;
  }

  showApp();
  await loadConsole();
}

async function handleLogin(event) {
  event.preventDefault();

  const email = authEmail.value.trim();
  const password = authPassword.value;
  if (!email || !password) {
    setAuthStatus("Enter email and password.", true);
    return;
  }

  const resetButton = setLoadingState(loginSubmit, "Sign In", "Signing In...");
  setAuthStatus("Authenticating...");

  try {
    const payload = await requestJson("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    saveSession(payload.user, payload.token);
    await bootstrap(payload.token, payload.user);
  } catch (error) {
    setAuthStatus(error.message || "Unable to sign in.", true);
  } finally {
    resetButton();
  }
}

async function handleTestAccess() {
  const resetButton = setLoadingState(testAdminAccess, "Use Test Admin", "Opening...");
  setAuthStatus("Opening test admin access...");

  try {
    const payload = await requestTestAccess("owner");
    saveSession(payload.user, payload.token);
    await bootstrap(payload.token, payload.user);
  } catch (error) {
    setAuthStatus(error.message || "Unable to open test admin access.", true);
  } finally {
    resetButton();
  }
}

async function handleSettingsSubmit(event) {
  event.preventDefault();
  const button = document.getElementById("settings-submit");
  const status = document.getElementById("settings-status");
  const input = document.getElementById("platform-fee-input");
  const value = Number(input.value);

  if (Number.isNaN(value) || value < 0 || value > 25) {
    status.textContent = "Enter a fee between 0 and 25.";
    status.style.color = "#ff8e69";
    return;
  }

  const resetButton = setLoadingState(button, "Save fee", "Saving...");
  status.textContent = "Updating fee configuration...";
  status.style.color = "";

  try {
    await authJson("/admin/pos/settings", state.token, {
      method: "POST",
      body: JSON.stringify({ platformFeePct: value })
    });
    status.textContent = "Platform fee updated.";
    await loadConsole();
  } catch (error) {
    status.textContent = error.message || "Unable to update fee.";
    status.style.color = "#ff8e69";
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

authForm.addEventListener("submit", handleLogin);
testAdminAccess.addEventListener("click", handleTestAccess);
document.getElementById("settings-form").addEventListener("submit", handleSettingsSubmit);
refreshButton.addEventListener("click", () => {
  loadConsole().catch((error) => {
    setLoadStatus(error.message || "Unable to refresh data.", true);
    setShellState("Attention", "danger");
  });
});
logoutButton.addEventListener("click", () => {
  clearSession();
  window.location.assign("/");
});

hydrate().catch((error) => {
  setLoadStatus(error.message || "Unable to load owner console.", true);
  setShellState("Attention", "danger");
});
