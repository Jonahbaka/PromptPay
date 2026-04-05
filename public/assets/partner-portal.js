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
  renderSparkBars,
  requestJson,
  saveSession,
  setLoadingState,
  bootstrapPwaShell,
  wireNavigation,
  wireMobileDrawer
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
const runtimeLabel = document.getElementById("partner-runtime-status");
const runtimeTime = document.getElementById("partner-runtime-time");
const overviewRefreshButton = document.getElementById("partner-rail-refresh");
const overviewZoomInButton = document.getElementById("partner-stage-zoom-in");
const overviewZoomOutButton = document.getElementById("partner-stage-zoom-out");
const overviewCards = {
  summary: document.getElementById("partner-summary-card"),
  command: document.getElementById("partner-command-card"),
  integrations: document.getElementById("partner-integrations-card"),
  transactions: document.getElementById("partner-transactions-card")
};

let sessionToken = null;
let currentPage = "overview";
let clockTimer = null;
let overviewScale = 1;
const state = { dashboard: null, stats: null, revenue: null, transactions: [], apiUsage: null, agents: null };

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

function alertTone(value) {
  const normalized = String(value || "").toLowerCase();
  if (["success", "active"].includes(normalized)) return "alert-active";
  if (["warning", "pending"].includes(normalized)) return "alert-warning";
  return "alert-danger";
}

function renderDetailList(elementId, rows) {
  const node = document.getElementById(elementId);
  if (!node) return;
  node.innerHTML = rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");
}

function summarizeAgents(agents) {
  return agents.reduce((summary, agent) => {
    const status = String(agent.status || "unknown").toLowerCase();
    const dailyLimit = Number(agent.daily_limit || 0);
    const dailyUsed = Number(agent.daily_used || 0);
    const utilization = dailyLimit > 0 ? Math.min(dailyUsed / dailyLimit, 1) : 0;
    summary.total += 1;
    summary.byStatus[status] = (summary.byStatus[status] || 0) + 1;
    if (utilization >= 0.8) summary.nearLimit += 1;
    if (utilization >= 1) summary.overLimit += 1;
    return summary;
  }, { total: 0, nearLimit: 0, overLimit: 0, byStatus: { active: 0, pending: 0, suspended: 0, deactivated: 0, unknown: 0 } });
}

function topAgents(agents, limit = 6) {
  return [...agents]
    .sort((left, right) => {
      const byVolume = Number(right.total_volume || 0) - Number(left.total_volume || 0);
      if (byVolume !== 0) return byVolume;
      return Number(right.total_transactions || 0) - Number(left.total_transactions || 0);
    })
    .slice(0, limit);
}

function nodeTone(status) {
  const normalized = String(status || "").toLowerCase();
  if (["active", "completed", "connected"].includes(normalized)) return "active";
  if (["pending", "review", "processing"].includes(normalized)) return "warning";
  return "danger";
}

function buildGrowthBadge(rows) {
  const daily = [...(rows || [])]
    .sort((left, right) => String(left.date).localeCompare(String(right.date)))
    .map((row) => Number(row.volume || 0))
    .filter((value) => Number.isFinite(value));

  if (daily.length < 2) {
    return { label: "Live", copy: "Waiting for two recorded days before day-over-day movement is available." };
  }

  const previous = daily.at(-2) || 0;
  const latest = daily.at(-1) || 0;
  if (previous <= 0) {
    return { label: "Live", copy: latest > 0 ? "Recent volume is now recorded for this tenant." : "Recent days still have no completed volume." };
  }

  const change = ((latest - previous) / previous) * 100;
  const prefix = change > 0 ? "+" : "";
  return {
    label: `${prefix}${Math.round(change)}%`,
    copy: `Compared with the previous recorded day in the ${state.revenue?.period || "active"} window.`
  };
}

function ensureStageCanvas(container) {
  if (!container) return null;
  let canvas = container.querySelector(".ops-stage-canvas");
  const anchor = container.querySelector(".ops-stage-legend") || container.querySelector(".ops-stage-controls");
  if (!canvas) {
    canvas = document.createElement("div");
    canvas.className = "ops-stage-canvas";
    if (anchor) {
      container.insertBefore(canvas, anchor);
    } else {
      container.appendChild(canvas);
    }
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

function buildStreamItems(stats, apiUsage, transactions, agents) {
  const stream = [];
  const health = summarizeAgents(agents);

  if ((stats.pendingTransactions || 0) > 0) {
    stream.push({
      type: "warning",
      tag: "QUEUE",
      detail: `${formatNumber(stats.pendingTransactions)} partner transaction${stats.pendingTransactions === 1 ? "" : "s"} still pending completion.`,
      meta: "Partner review",
      time: stats.lastTransactionAt ? relativeTime(stats.lastTransactionAt) : "Live"
    });
  }

  if (apiUsage.lastRequestAt) {
    stream.push({
      type: (apiUsage.activeKeys || 0) > 0 ? "active" : "warning",
      tag: "API",
      detail: `${formatNumber(apiUsage.totalCalls || 0)} logged request${(apiUsage.totalCalls || 0) === 1 ? "" : "s"} for this tenant.`,
      meta: `${formatNumber(apiUsage.activeKeys || 0)} active key${(apiUsage.activeKeys || 0) === 1 ? "" : "s"}`,
      time: relativeTime(apiUsage.lastRequestAt)
    });
  }

  if (health.nearLimit > 0) {
    stream.push({
      type: "warning",
      tag: "LIMIT",
      detail: `${formatNumber(health.nearLimit)} agent${health.nearLimit === 1 ? "" : "s"} are above 80% of daily limit.`,
      meta: "Utilization",
      time: "Now"
    });
  }

  transactions.slice(0, 6).forEach((item) => {
    const type = String(item.status || "").toLowerCase() === "completed"
      ? "active"
      : String(item.status || "").toLowerCase() === "pending"
        ? "warning"
        : "danger";
    stream.push({
      type,
      tag: String(item.product_type || "transaction").toUpperCase(),
      detail: `${item.agent_name || item.agent_email || "Agent"} / ${formatCurrency(item.face_value || 0, "NGN")} / ${item.customer_phone || "-"}`,
      meta: item.carrier || "POS",
      time: relativeTime(item.created_at)
    });
  });

  return stream.slice(0, 6);
}

function renderOverviewStage(stats, agents) {
  const topology = document.getElementById("partner-overview-topology");
  const coverageNode = document.getElementById("partner-stage-coverage");
  const volumeNode = document.getElementById("partner-stage-volume");
  const activeNode = document.getElementById("partner-stage-active");
  if (!topology || !coverageNode || !volumeNode || !activeNode) return;

  const health = summarizeAgents(agents);
  const totalAgents = Number(stats.agentCount || health.total || 0);
  const activeAgents = Number(stats.activeAgents || health.byStatus.active || 0);
  const coverage = totalAgents > 0 ? Math.round((activeAgents / totalAgents) * 100) : 0;
  const averageVolume = Number(stats.transactionCount || 0) > 0
    ? Number(stats.transactionVolume || 0) / Number(stats.transactionCount || 1)
    : 0;

  coverageNode.textContent = `${coverage}%`;
  volumeNode.textContent = formatCurrency(averageVolume, "NGN");
  activeNode.textContent = `${formatNumber(activeAgents)}/${formatNumber(totalAgents)}`;

  const canvas = ensureStageCanvas(topology);
  if (!canvas) return;

  const positions = [
    { x: 18, y: 28 },
    { x: 50, y: 18 },
    { x: 82, y: 30 },
    { x: 74, y: 72 },
    { x: 44, y: 80 },
    { x: 16, y: 66 }
  ];
  const ranked = topAgents(agents, positions.length);

  if (!ranked.length) {
    canvas.style.transform = `scale(${overviewScale})`;
    canvas.innerHTML = `<div class="empty-state" style="position:absolute;inset:0;display:grid;place-items:center;">No live partner agents yet.</div>`;
    return;
  }

  const links = ranked.slice(0, Math.max(ranked.length - 1, 0)).map((_, index) => {
    const current = positions[index];
    const next = positions[(index + 1) % ranked.length];
    const dx = next.x - current.x;
    const dy = next.y - current.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    return `<span class="ops-stage-link" style="left:${current.x}%;top:${current.y}%;width:${distance}%;transform:rotate(${angle}deg);"></span>`;
  }).join("");

  const nodes = ranked.map((agent, index) => {
    const position = positions[index];
    const tone = nodeTone(agent.status);
    return `
      <div class="ops-stage-node ${tone}" style="left:${position.x}%;top:${position.y}%;">
        <span class="ops-stage-node-glow"></span>
        <span class="ops-stage-node-dot"></span>
        <span class="ops-stage-node-note">${escapeHtml(agent.display_name || agent.email || "Agent")} / ${escapeHtml(formatNumber(agent.total_transactions || 0))} txs</span>
      </div>
    `;
  }).join("");

  canvas.style.transform = `scale(${overviewScale})`;
  canvas.innerHTML = `${links}${nodes}`;
}

function renderOverviewStats(stats, agents) {
  const velocityBadge = document.getElementById("partner-velocity-badge");
  const velocityValue = document.getElementById("partner-velocity-value");
  const velocityCopy = document.getElementById("partner-velocity-copy");
  const fleetValue = document.getElementById("partner-fleet-value");
  const fleetStrip = document.getElementById("partner-fleet-strip");
  const fleetCopy = document.getElementById("partner-fleet-copy");
  if (!velocityBadge || !velocityValue || !velocityCopy || !fleetValue || !fleetStrip || !fleetCopy) return;

  const health = summarizeAgents(agents);
  const growth = buildGrowthBadge(state.revenue?.daily || []);
  const ranked = topAgents(agents, 4);

  velocityBadge.textContent = growth.label;
  velocityValue.textContent = formatCurrency(stats.transactionVolume || 0, "NGN");
  velocityCopy.textContent = growth.copy;

  fleetValue.textContent = formatNumber(stats.activeAgents || health.byStatus.active || 0);
  fleetStrip.innerHTML = ranked.length
    ? ranked.map((agent) => `<span class="ops-avatar-dot ${nodeTone(agent.status)}" title="${escapeHtml(agent.display_name || agent.email || "Agent")}"></span>`).join("")
    : `<span class="ops-avatar-dot" title="No active fleet"></span>`;
  fleetCopy.textContent = health.nearLimit > 0
    ? `${formatNumber(health.nearLimit)} agent${health.nearLimit === 1 ? "" : "s"} are close to their daily limit.`
    : "Real partner agents currently available for operations.";
}

function startRuntimeClock() {
  const update = () => {
    runtimeTime.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };
  update();
  if (clockTimer) window.clearInterval(clockTimer);
  clockTimer = window.setInterval(update, 30000);
}

function buildAlerts(partner, stats, apiUsage, agents) {
  const health = summarizeAgents(agents);
  const alerts = [];
  if (String(partner.status || "").toLowerCase() !== "active") {
    alerts.push({ tone: "warning", title: "Partner activation is still pending", copy: "PromptPay keeps network views limited until this tenant is active." });
  }
  if ((stats.pendingTransactions || 0) > 0) {
    alerts.push({ tone: "warning", title: `${formatNumber(stats.pendingTransactions)} pending transaction${stats.pendingTransactions === 1 ? "" : "s"} require review`, copy: "Pending POS records remain in the network and should be cleared before they accumulate." });
  }
  if ((health.byStatus.suspended || 0) > 0 || (health.byStatus.deactivated || 0) > 0) {
    const restricted = (health.byStatus.suspended || 0) + (health.byStatus.deactivated || 0);
    alerts.push({ tone: "danger", title: "Restricted agents detected", copy: `${formatNumber(restricted)} agent account${restricted === 1 ? " is" : "s are"} not active.` });
  }
  if (health.nearLimit > 0) {
    alerts.push({ tone: "warning", title: "Agent utilization is approaching the limit", copy: `${formatNumber(health.nearLimit)} agent${health.nearLimit === 1 ? "" : "s"} are above 80% of their configured daily limit.` });
  }
  if ((apiUsage.activeKeys || 0) === 0) {
    alerts.push({ tone: "warning", title: "No connected partner API keys", copy: "Developer access is still disconnected. Integrations stay unavailable until a real key is active." });
  }
  if (!alerts.length) {
    alerts.push({ tone: "success", title: "No immediate partner blockers", copy: "Current tenant, agent, and integration records do not show pending operational issues." });
  }
  return alerts.slice(0, 4);
}

function renderAlertFeed(alerts) {
  document.getElementById("partner-alert-feed").innerHTML = alerts.map((alert) => `
    <article class="alert-card ${alertTone(alert.tone)}">
      <div class="alert-stripe"></div>
      <div>
        <strong>${escapeHtml(alert.title)}</strong>
        <p>${escapeHtml(alert.copy)}</p>
      </div>
    </article>
  `).join("");
}

function sortOverviewCards(stats, apiUsage, agents, transactions) {
  const health = summarizeAgents(agents);
  const priorities = new Map([
    ["summary", String(state.dashboard?.partner?.status || "").toLowerCase() === "active" ? 3 : 1],
    ["command", health.nearLimit > 0 || health.byStatus.suspended > 0 ? 1 : 2],
    ["integrations", (apiUsage.activeKeys || 0) > 0 ? 4 : 2],
    ["transactions", transactions.length > 0 ? 2 : 4]
  ]);
  Object.entries(overviewCards).forEach(([key, node]) => {
    if (node) node.style.order = String(priorities.get(key) || 10);
  });
}

function renderHero(partner, stats, apiUsage, agents) {
  const health = summarizeAgents(agents);
  const recentActivity = stats.lastTransactionAt || apiUsage.lastRequestAt || null;
  document.getElementById("partner-name").textContent = partner.displayName || partner.name;
  document.getElementById("partner-meta").textContent = `${partner.contactEmail || "No contact email"} / ${partner.tier || "standard"}`;
  const drawerName = document.getElementById("drawer-partner-name");
  const drawerMeta = document.getElementById("drawer-partner-meta");
  if (drawerName) drawerName.textContent = partner.displayName || partner.name;
  if (drawerMeta) drawerMeta.textContent = `${partner.contactEmail || "No contact email"} / ${partner.tier || "standard"}`;
  document.getElementById("partner-live-volume").textContent = `Volume: ${formatCurrency(stats.transactionVolume || 0, "NGN")}`;
  document.getElementById("partner-live-activity").textContent = `Transactions: ${formatNumber(stats.transactionCount || 0)}`;
  document.getElementById("partner-live-users").textContent = `Active team: ${formatNumber(stats.activeUsers || 0)}`;
  document.getElementById("signal-status").textContent = String(partner.status || "-");
  document.getElementById("signal-api").textContent = apiUsage.status || "Not Connected";
  document.getElementById("signal-activity").textContent = recentActivity ? relativeTime(recentActivity) : "No recent activity";
  document.getElementById("signal-status-copy").textContent = String(partner.status || "").toLowerCase() === "active"
    ? "This tenant can surface live network activity."
    : "Activation is still required before rollout metrics become meaningful.";
  document.getElementById("signal-api-copy").textContent = (apiUsage.activeKeys || 0) > 0
    ? `${formatNumber(apiUsage.activeKeys || 0)} active key${apiUsage.activeKeys === 1 ? "" : "s"} and ${formatNumber(apiUsage.totalCalls || 0)} logged calls.`
    : "No active key has been recorded for this tenant.";
  document.getElementById("signal-activity-copy").textContent = recentActivity
    ? "Based on the latest transaction or API record for this partner."
    : "No partner transaction or API activity has been recorded yet.";
  runtimeLabel.textContent = health.total > 0 ? `${formatNumber(health.byStatus.active || 0)} active of ${formatNumber(health.total)} agents` : "No agent coverage yet";
}

function renderContext(partner, stats, apiUsage, agents) {
  const health = summarizeAgents(agents);
  const actions = [];
  if (String(partner.status || "").toLowerCase() !== "active") {
    actions.push({ title: "Review onboarding status", description: "This tenant is not active yet, so network visibility and volume remain limited.", page: "overview" });
  }
  if ((stats.agentCount || 0) === 0) {
    actions.push({ title: "No agents yet", description: "Your network has no active partner agents. Review rollout readiness before scaling.", page: "agents" });
  } else {
    actions.push({ title: "Inspect network coverage", description: "Open the live network matrix to review agent status, utilization, and top performers.", page: "network" });
  }
  if ((apiUsage.activeKeys || 0) === 0) {
    actions.push({ title: "Connect provider access", description: "No active developer keys or API traffic are connected for this partner yet.", page: "integrations" });
  }
  if ((stats.pendingTransactions || 0) > 0) {
    actions.push({ title: "Review pending activity", description: "There are partner transactions still waiting to complete.", page: "network", target: "partner-stream" });
  } else if ((stats.transactionCount || 0) > 0) {
    actions.push({ title: "Review recent transaction activity", description: "Real partner transaction records are available for inspection now.", page: "overview", target: "partner-transactions-card" });
  }
  if (health.nearLimit > 0) {
    actions.push({ title: "Check agent utilization", description: `${formatNumber(health.nearLimit)} agent${health.nearLimit === 1 ? "" : "s"} are nearing their daily limit.`, page: "agents" });
  }

  const primary = actions[0] || { title: "Partner activity is live", description: "PromptPay is surfacing the next operational action using real partner records." };
  contextTitle.textContent = primary.title;
  contextCopy.textContent = primary.description;
  contextActions.innerHTML = actions.slice(0, 3).map((action) => `
    <article class="action-card">
      <strong>${escapeHtml(action.title)}</strong>
      <p>${escapeHtml(action.description)}</p>
      <button class="button button-secondary button-small" type="button" data-action-page="${escapeHtml(action.page)}" ${action.target ? `data-action-target="${escapeHtml(action.target)}"` : ""}>Open</button>
    </article>
  `).join("");

  contextActions.querySelectorAll("[data-action-page]").forEach((button) => {
    button.addEventListener("click", async () => {
      const page = button.getAttribute("data-action-page");
      const target = button.getAttribute("data-action-target");
      activatePage(page);
      if (page === "agents") await loadAgents();
      if (target) {
        requestAnimationFrame(() => {
          document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
      }
    });
  });
}

function renderHealthGrid(stats, apiUsage, agents) {
  const health = summarizeAgents(agents);
  const items = [
    { label: "Active agents", value: `${formatNumber(stats.activeAgents || health.byStatus.active || 0)} / ${formatNumber(stats.agentCount || health.total || 0)}`, copy: "Live agent status coverage." },
    { label: "Active users", value: formatNumber(stats.activeUsers || 0), copy: "Signed in during the last 7 days." },
    { label: "Pending records", value: formatNumber(stats.pendingTransactions || 0), copy: "Transactions still waiting on completion." },
    { label: "API traffic", value: formatNumber(apiUsage.todayCalls || 0), copy: "Requests logged today." }
  ];
  document.getElementById("partner-health-grid").innerHTML = items.map((item) => `
    <article class="mini-stat-card">
      <span>${escapeHtml(item.label)}</span>
      <strong>${escapeHtml(item.value)}</strong>
      <small>${escapeHtml(item.copy)}</small>
    </article>
  `).join("");
}

function renderOverview() {
  const partner = state.dashboard.partner;
  const stats = state.stats;
  const apiUsage = state.apiUsage;
  const agents = state.agents || [];
  const transactions = state.transactions;

  renderHero(partner, stats, apiUsage, agents);
  renderAlertFeed(buildAlerts(partner, stats, apiUsage, agents));
  renderContext(partner, stats, apiUsage, agents);
  renderHealthGrid(stats, apiUsage, agents);
  renderOverviewStage(stats, agents);
  renderOverviewStats(stats, agents);
  renderOpsStream("partner-overview-stream", buildStreamItems(stats, apiUsage, transactions, agents), "No partner activity has been recorded yet.");

  document.getElementById("metric-status").textContent = String(partner.status || "-");
  document.getElementById("metric-agents").textContent = formatNumber(stats.agentCount || state.dashboard.network.totalAgents || 0);
  document.getElementById("metric-volume").textContent = formatCurrency(stats.transactionVolume || 0, "NGN");
  document.getElementById("metric-commission").textContent = formatCurrency(stats.commissionSummary?.promptPayShare || 0, "NGN");

  renderDetailList("partner-summary", [
    ["Name", partner.displayName || partner.name || "-"],
    ["Contact", `${partner.contactEmail || "-"}${partner.contactPhone ? ` / ${partner.contactPhone}` : ""}`],
    ["Created", formatDate(partner.createdAt)],
    ["Activated", partner.activatedAt ? formatDate(partner.activatedAt) : "Pending activation"]
  ]);
  renderDetailList("integration-summary", [
    ["Status", apiUsage.status || "Not Connected"],
    ["Active keys", formatNumber(apiUsage.activeKeys || 0)],
    ["Total calls", formatNumber(apiUsage.totalCalls || 0)],
    ["Last request", apiUsage.lastRequestAt ? relativeTime(apiUsage.lastRequestAt) : "Not Connected"]
  ]);

  if (String(partner.status || "").toLowerCase() !== "active") {
    statusBanner.textContent = "This partner is not active yet. Metrics remain limited until the account and network are activated.";
    statusBanner.classList.remove("hidden");
  } else {
    statusBanner.classList.add("hidden");
    statusBanner.textContent = "";
  }

  const txContainer = document.getElementById("partner-transactions");
  txContainer.innerHTML = transactions.length
    ? transactions.map((item) => `
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
      `).join("")
    : `<div class="empty-state">No transaction records found for this partner.</div>`;

  sortOverviewCards(stats, apiUsage, agents, transactions);
}

function renderNetwork() {
  const agents = state.agents || [];
  const stats = state.stats;
  const revenue = state.revenue;
  const apiUsage = state.apiUsage;
  const matrix = document.getElementById("partner-network-matrix");
  const topology = document.getElementById("partner-network-topology");
  const topologyPositions = [
    { x: 18, y: 28 },
    { x: 50, y: 18 },
    { x: 82, y: 30 },
    { x: 74, y: 72 },
    { x: 44, y: 80 },
    { x: 16, y: 66 }
  ];

  if (!agents.length) {
    topology.innerHTML = `<div class="empty-state" style="position:absolute;inset:0;display:grid;place-items:center;">No live topology yet.</div>`;
  } else {
    const ranked = topAgents(agents, 6);
    const links = ranked.slice(0, Math.max(ranked.length - 1, 0)).map((_, index) => {
      const current = topologyPositions[index];
      const next = topologyPositions[(index + 1) % topologyPositions.length];
      const dx = next.x - current.x;
      const dy = next.y - current.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);
      return `<span class="topology-link" style="left:${current.x}%;top:${current.y}%;width:${distance}%;transform:rotate(${angle}deg);"></span>`;
    }).join("");

    const nodes = ranked.map((agent, index) => {
      const position = topologyPositions[index];
      return `
        <article class="topology-node" style="left:${position.x}%;top:${position.y}%;">
          <header>
            <span class="node-dot ${statusTone(agent.status)}"></span>
            <strong>${escapeHtml(agent.display_name || agent.email || "Agent")}</strong>
          </header>
          <small>${escapeHtml(agent.agent_code || "-")} / ${escapeHtml(agent.status || "unknown")}</small>
          <footer>
            <span>${escapeHtml(formatNumber(agent.total_transactions || 0))} txs</span>
            <span>${escapeHtml(formatCurrency(agent.total_volume || 0, "NGN"))}</span>
          </footer>
        </article>
      `;
    }).join("");

    topology.innerHTML = `<div class="topology-canvas">${links}${nodes}</div>`;
  }

  matrix.innerHTML = agents.length
    ? topAgents(agents, 8).map((agent) => {
        const dailyLimit = Number(agent.daily_limit || 0);
        const dailyUsed = Number(agent.daily_used || 0);
        const utilization = dailyLimit > 0 ? Math.min(dailyUsed / dailyLimit, 1) : 0;
        const width = Math.max(8, Math.round(utilization * 100));
        const label = dailyLimit > 0 ? `${Math.round(utilization * 100)}% of daily limit` : "No daily limit configured";
        return `
          <article class="node-card">
            <header>
              <div><span class="node-dot ${statusTone(agent.status)}"></span><strong>${escapeHtml(agent.display_name || agent.email || "Agent")}</strong></div>
              <span>${escapeHtml(agent.status || "unknown")}</span>
            </header>
            <div class="node-meta">
              <span>${escapeHtml(agent.agent_code || "-")}</span>
              <span>${escapeHtml(formatNumber(agent.total_transactions || 0))} txs</span>
            </div>
            <div class="utilization-track" aria-hidden="true"><strong style="width:${width}%"></strong></div>
            <footer>
              <span>${escapeHtml(label)}</span>
              <span>${escapeHtml(formatCurrency(agent.total_volume || 0, "NGN"))}</span>
            </footer>
          </article>
        `;
      }).join("")
    : `<div class="empty-state">No agents found for this partner yet.</div>`;

  const daily = [...(revenue.daily || [])].sort((left, right) => String(left.date).localeCompare(String(right.date)));
  const bars = document.getElementById("partner-daily-bars");
  const caption = document.getElementById("partner-daily-caption");
  if (!daily.length) {
    bars.innerHTML = `<div class="empty-state">No trend data yet.</div>`;
    caption.textContent = "Real daily volume appears after completed partner transactions are recorded.";
  } else {
    bars.innerHTML = renderSparkBars(daily.map((row) => Number(row.volume || 0)));
    const latest = daily.at(-1);
    caption.textContent = `Latest recorded day: ${formatDate(latest.date)} / ${formatCurrency(latest.volume || 0, "NGN")} completed volume.`;
  }

  const mixTotal = (revenue.byType || []).reduce((sum, row) => sum + Number(row.volume || 0), 0);
  const mix = document.getElementById("partner-product-mix");
  mix.innerHTML = !(revenue.byType || []).length || mixTotal === 0
    ? `<div class="empty-state">No product mix data yet.</div>`
    : revenue.byType.map((row) => {
        const share = mixTotal > 0 ? (Number(row.volume || 0) / mixTotal) * 100 : 0;
        return `
          <article class="mix-item">
            <div class="mix-item-copy">
              <strong>${escapeHtml(String(row.type || "unknown").toUpperCase())}</strong>
              <span>${escapeHtml(formatNumber(row.transactionCount || 0))} txs / ${escapeHtml(formatCurrency(row.volume || 0, "NGN"))}</span>
            </div>
            <div class="mix-item-bar"><strong style="width:${Math.max(8, Math.round(share))}%"></strong></div>
            <small>${escapeHtml(`${share.toFixed(0)}% of completed volume`)}</small>
          </article>
        `;
      }).join("");

  document.getElementById("partner-top-agents").innerHTML = agents.length
    ? topAgents(agents).map((agent, index) => `
        <article class="stack-item compact-item">
          <header>
            <div>
              <strong>#${index + 1} ${escapeHtml(agent.display_name || agent.email || "Agent")}</strong>
              <p>${escapeHtml(agent.agent_code || "-")} / ${escapeHtml(agent.tier || "-")}</p>
            </div>
            <span>${escapeHtml(formatCurrency(agent.total_volume || 0, "NGN"))}</span>
          </header>
        </article>
      `).join("")
    : `<div class="empty-state">No agent performance data yet.</div>`;

  renderOpsStream(
    "partner-stream",
    buildStreamItems(stats, apiUsage, state.transactions, agents),
    "No activity stream available yet."
  );

  document.getElementById("partner-agent-highlights").innerHTML = [
    { label: "Total agents", value: formatNumber(stats.agentCount || agents.length), copy: "Registered partner agents." },
    { label: "Active agents", value: formatNumber(stats.activeAgents || summarizeAgents(agents).byStatus.active || 0), copy: "Currently active for live operations." },
    { label: "Near limit", value: formatNumber(summarizeAgents(agents).nearLimit || 0), copy: "Above 80% of daily configured limit." },
    { label: "New users this month", value: formatNumber(stats.newUsersThisMonth || 0), copy: "Real user growth in this tenant." }
  ].map((item) => `
    <article class="mini-stat-card">
      <span>${escapeHtml(item.label)}</span>
      <strong>${escapeHtml(item.value)}</strong>
      <small>${escapeHtml(item.copy)}</small>
    </article>
  `).join("");
}

function renderAgents() {
  const tbody = document.getElementById("agent-table");
  const agents = state.agents || [];
  tbody.innerHTML = agents.length
    ? agents.map((agent) => `
        <tr>
          <td data-label="Agent">${escapeHtml(agent.display_name || "-")}<br><span class="muted">${escapeHtml(agent.email || "-")}</span></td>
          <td data-label="Code">${escapeHtml(agent.agent_code || "-")}</td>
          <td data-label="Status"><span class="status-chip ${statusTone(agent.status)}">${escapeHtml(agent.status || "unknown")}</span></td>
          <td data-label="Tier">${escapeHtml(agent.tier || "-")}</td>
          <td data-label="Transactions">${escapeHtml(formatNumber(agent.total_transactions || 0))}</td>
          <td data-label="Volume">${escapeHtml(formatCurrency(agent.total_volume || 0, "NGN"))}</td>
        </tr>
      `).join("")
    : `<tr><td colspan="6" class="empty-state">No agents found for this partner.</td></tr>`;
}

function renderIntegrations() {
  renderDetailList("integration-summary-panel", [
    ["Status", state.apiUsage.status || "Not Connected"],
    ["Active keys", formatNumber(state.apiUsage.activeKeys || 0)],
    ["Total calls", formatNumber(state.apiUsage.totalCalls || 0)],
    ["Last request", state.dashboard.apiIntegration?.lastRequestAt ? relativeTime(state.dashboard.apiIntegration.lastRequestAt) : "Not Connected"]
  ]);
  document.getElementById("integration-keys").innerHTML = state.apiUsage.keys?.length
    ? state.apiUsage.keys.map((key) => `
        <article class="stack-item compact-item">
          <header>
            <div>
              <strong>${escapeHtml(key.name || "Key")}</strong>
              <p>${escapeHtml(key.api_key_prefix || "")} / ${escapeHtml(key.status || "inactive")}</p>
            </div>
            <span>${escapeHtml(formatNumber(key.requests_today || 0))} requests today</span>
          </header>
        </article>
      `).join("")
    : `<div class="empty-state">No developer keys found.</div>`;
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

function renderAll() {
  renderOverview();
  renderNetwork();
  renderAgents();
  renderIntegrations();
}

async function loadOverview(force = false) {
  if (!force && state.dashboard && state.stats && state.revenue && state.apiUsage && state.agents) {
    renderAll();
    return;
  }
  setStatus(loadStatus, "Loading partner portal...");
  const [dashboard, stats, revenue, transactionsPayload, apiUsage, agentsPayload] = await Promise.all([
    authJson("/api/partners/me/dashboard", sessionToken),
    authJson("/api/partners/me/stats", sessionToken),
    authJson("/api/partners/me/revenue?days=14", sessionToken),
    authJson("/api/partners/me/transactions?limit=8", sessionToken),
    authJson("/api/partners/me/api-usage", sessionToken),
    authJson("/api/partners/me/agents", sessionToken)
  ]);
  state.dashboard = dashboard;
  state.stats = stats;
  state.revenue = revenue;
  state.transactions = transactionsPayload.transactions || [];
  state.apiUsage = apiUsage;
  state.agents = agentsPayload.agents || [];
  renderAll();
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
  renderNetwork();
  setStatus(loadStatus, "");
}

async function handleLoginRequest(requestPromise) {
  const payload = await requestPromise;
  saveSession(payload.user, payload.token);
  if (routeIfWrongRole(payload.user)) return;
  sessionToken = payload.token;
  showShell();
  window.scrollTo(0, 0);
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
    showShell();
    startRuntimeClock();
    await loadOverview(true);
  } catch {
    clearSession();
    showAuth();
  }
}

authTabs.forEach((tab) => tab.addEventListener("click", () => setAuthTab(tab.dataset.authTab)));

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
    await handleLoginRequest(requestJson("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }));
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
    const response = await requestJson("/api/partners/apply", { method: "POST", body: JSON.stringify(payload) });
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
    state.stats = null;
    state.revenue = null;
    state.apiUsage = null;
    state.transactions = [];
    state.agents = null;
    await loadOverview(true);
  } catch (error) {
    setStatus(loadStatus, error.message || "Unable to refresh portal.", true);
  }
});

overviewRefreshButton?.addEventListener("click", async () => {
  try {
    state.dashboard = null;
    state.stats = null;
    state.revenue = null;
    state.apiUsage = null;
    state.transactions = [];
    state.agents = null;
    await loadOverview(true);
  } catch (error) {
    setStatus(loadStatus, error.message || "Unable to refresh portal.", true);
  }
});

overviewZoomInButton?.addEventListener("click", () => {
  overviewScale = Math.min(1.45, Number((overviewScale + 0.1).toFixed(2)));
  if (state.stats && state.agents) renderOverviewStage(state.stats, state.agents);
});

overviewZoomOutButton?.addEventListener("click", () => {
  overviewScale = Math.max(0.85, Number((overviewScale - 0.1).toFixed(2)));
  if (state.stats && state.agents) renderOverviewStage(state.stats, state.agents);
});

logoutButton.addEventListener("click", () => {
  clearSession();
  sessionToken = null;
  state.dashboard = null;
  state.stats = null;
  state.revenue = null;
  state.transactions = [];
  state.apiUsage = null;
  state.agents = null;
  if (clockTimer) window.clearInterval(clockTimer);
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
    if (page === "agents") await loadAgents();
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

bootstrapPwaShell({
  appName: "PromptPay",
  installDescription:
    "Install PromptPay for a standalone partner command center with faster relaunch and offline shell recovery.",
  iosDescription:
    "Add PromptPay to your home screen from Safari so the partner command center launches like a native app."
});
hydrate();
