import { copyText } from "./console-core.js";

const authDialog = document.getElementById("auth-dialog");
const authStatus = document.getElementById("auth-status");
const sessionTitle = document.getElementById("session-title");
const sessionCopy = document.getElementById("session-copy");
const sessionActions = document.getElementById("session-actions");
const header = document.querySelector("[data-header]");
const nav = document.querySelector("[data-nav]");
const menuToggle = document.querySelector("[data-menu-toggle]");
const closeAuth = document.querySelector("[data-close-auth]");
const authTabs = [...document.querySelectorAll("[data-auth-tab]")];
const authPanels = [...document.querySelectorAll("[data-auth-panel]")];
const demoRequestForm = document.getElementById("demo-request-form");
const demoEmailButton = document.getElementById("demo-email-button");
const demoStatus = document.getElementById("demo-request-status");

const STORAGE_TOKEN = "promptpay_token";
const STORAGE_USER = "promptpay_user";
const OPERATOR_ROLES = new Set(["owner", "partner_admin"]);
const USER_ROLE = "user";

function setStatus(message, isError = false) {
  authStatus.textContent = message;
  authStatus.style.color = isError ? "#ff9d67" : "#8da0b3";
}

function setDemoStatus(message, isError = false) {
  if (!demoStatus) return;
  demoStatus.textContent = message;
  demoStatus.style.color = isError ? "#ff9d67" : "#8da0b3";
}

function setTab(mode) {
  authTabs.forEach((tab) => {
    const active = tab.dataset.authTab === mode;
    tab.classList.toggle("auth-tab-active", active);
    tab.setAttribute("aria-selected", String(active));
  });

  authPanels.forEach((panel) => {
    panel.classList.toggle("auth-panel-active", panel.dataset.authPanel === mode);
  });

  setStatus("");
}

function showAuth(mode = "signin") {
  setTab(mode);
  if (typeof authDialog.showModal === "function" && !authDialog.open) {
    authDialog.showModal();
  } else {
    authDialog.setAttribute("open", "open");
  }
}

function hideAuth() {
  if (typeof authDialog.close === "function" && authDialog.open) {
    authDialog.close();
  } else {
    authDialog.removeAttribute("open");
  }
}

function bindAuthTriggers(scope = document) {
  scope.querySelectorAll("[data-open-auth]").forEach((trigger) => {
    trigger.addEventListener("click", () => {
      showAuth(trigger.getAttribute("data-open-auth") || "signin");
    });
  });
}

function getConsoleHref(user) {
  if (!user || !user.role) return "/";
  if (user.role === "owner") return "/admin";
  if (user.role === "partner_admin") return "/partner";
  return "/dashboard";
}

function shouldRedirectAfterAuth(user) {
  return Boolean(user?.role && (OPERATOR_ROLES.has(user.role) || user.role === USER_ROLE));
}

function renderLoggedOut() {
  sessionTitle.textContent = "Choose your PromptPay access point";
  sessionCopy.textContent =
    "Open the end-user dashboard, the partner portal, or the owner portal from one PromptPay sign-in flow.";
  sessionActions.innerHTML = `
    <button class="button button-primary" type="button" data-open-auth="signin">Sign In</button>
    <button class="button button-secondary" type="button" data-open-auth="register">Create Account</button>
    <a class="button button-secondary" href="#demo-request" data-demo-link>Book Demo</a>
  `;
  bindAuthTriggers(sessionActions);
  bindDemoLinks(sessionActions);
}

function renderLoggedIn(user) {
  sessionTitle.textContent = `Welcome back, ${user.displayName || user.email}`;
  const isUser = user.role === USER_ROLE;
  const primaryLabel = isUser ? "Open Dashboard" : "Open Workspace";
  sessionCopy.textContent = isUser
    ? "Your PromptPay dashboard is ready for profile, account status, notifications, and transaction history."
    : "Your workspace is ready for agent networks, partner controls, provider monitoring, and administrative workflows.";
  sessionActions.innerHTML = `
    <a class="button button-primary" href="${getConsoleHref(user)}">${primaryLabel}</a>
    <button class="button button-secondary" type="button" id="logout-button">Log Out</button>
  `;
  document.getElementById("logout-button").addEventListener("click", () => {
    localStorage.removeItem(STORAGE_TOKEN);
    localStorage.removeItem(STORAGE_USER);
    renderLoggedOut();
  });
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }
  return payload;
}

function persistSession(user, token) {
  localStorage.setItem(STORAGE_TOKEN, token);
  localStorage.setItem(STORAGE_USER, JSON.stringify(user));
  if (shouldRedirectAfterAuth(user)) {
    window.location.assign(getConsoleHref(user));
    return true;
  }
  renderLoggedIn(user);
  return false;
}

async function handleSignIn() {
  const email = document.getElementById("signin-email").value.trim();
  const password = document.getElementById("signin-password").value;
  const button = document.getElementById("signin-submit");

  if (!email || !password) {
    setStatus("Enter email and password.", true);
    return;
  }

  button.disabled = true;
  button.textContent = "Signing In...";
  setStatus("Authenticating...");

  try {
    const payload = await requestJson("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    const redirected = persistSession(payload.user, payload.token);
    if (redirected) return;
    hideAuth();
  } catch (error) {
    setStatus(error.message || "Unable to sign in.", true);
  } finally {
    button.disabled = false;
    button.textContent = "Sign In";
  }
}

async function handleRegister() {
  const displayName = document.getElementById("register-name").value.trim();
  const email = document.getElementById("register-email").value.trim();
  const password = document.getElementById("register-password").value;
  const country = document.getElementById("register-country").value.trim();
  const button = document.getElementById("register-submit");

  if (!displayName || !email || !password) {
    setStatus("Enter name, email, and password.", true);
    return;
  }

  button.disabled = true;
  button.textContent = "Creating Access...";
  setStatus("Provisioning workspace...");

  try {
    const payload = await requestJson("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ displayName, email, password, country })
    });
    const redirected = persistSession(payload.user, payload.token);
    if (redirected) return;
    hideAuth();
  } catch (error) {
    setStatus(error.message || "Unable to create access.", true);
  } finally {
    button.disabled = false;
    button.textContent = "Create Access";
  }
}

async function hydrateSession() {
  const token = localStorage.getItem(STORAGE_TOKEN);
  if (!token) {
    renderLoggedOut();
    return;
  }

  try {
    const user = await requestJson("/api/auth/me", {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    localStorage.setItem(STORAGE_USER, JSON.stringify(user));
    renderLoggedIn(user);
  } catch {
    localStorage.removeItem(STORAGE_TOKEN);
    localStorage.removeItem(STORAGE_USER);
    renderLoggedOut();
  }
}

function setupDialogDismissal() {
  authDialog.addEventListener("click", (event) => {
    const rect = authDialog.getBoundingClientRect();
    const inside =
      rect.top <= event.clientY &&
      event.clientY <= rect.top + rect.height &&
      rect.left <= event.clientX &&
      event.clientX <= rect.left + rect.width;

    if (!inside) hideAuth();
  });

  closeAuth.addEventListener("click", hideAuth);
}

function setupMenu() {
  if (!menuToggle || !header || !nav) return;
  menuToggle.addEventListener("click", () => {
    const isOpen = header.classList.toggle("is-open");
    menuToggle.setAttribute("aria-expanded", String(isOpen));
  });

  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      header.classList.remove("is-open");
      menuToggle.setAttribute("aria-expanded", "false");
    });
  });
}

function setupHeaderState() {
  if (!header) return;
  const syncHeader = () => {
    header.classList.toggle("is-scrolled", window.scrollY > 12);
  };
  syncHeader();
  window.addEventListener("scroll", syncHeader, { passive: true });
}

function scrollToDemo() {
  document.getElementById("demo-request")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function bindDemoLinks(scope = document) {
  scope.querySelectorAll("[data-demo-link]").forEach((link) => {
    if (link.dataset.demoBound === "true") return;
    link.dataset.demoBound = "true";
    link.addEventListener("click", (event) => {
      event.preventDefault();
      scrollToDemo();
    });
  });
}

function buildDemoBrief() {
  const name = document.getElementById("demo-name").value.trim();
  const company = document.getElementById("demo-company").value.trim();
  const email = document.getElementById("demo-email").value.trim();
  const useCase = document.getElementById("demo-use-case").value;
  const notes = document.getElementById("demo-notes").value.trim();

  if (!name || !company || !email) {
    throw new Error("Enter name, company, and work email.");
  }

  const subject = `PromptPay Demo Request - ${company}`;
  const body = [
    `Name: ${name}`,
    `Company: ${company}`,
    `Email: ${email}`,
    `Use case: ${useCase}`,
    "",
    "Notes:",
    notes || "No additional notes provided."
  ].join("\n");

  return { subject, body };
}

function setupDemoForm() {
  if (!demoRequestForm) return;

  demoRequestForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const { subject, body } = buildDemoBrief();
      await copyText(`To: support@upromptpay.com\nSubject: ${subject}\n\n${body}`);
      setDemoStatus("Demo brief copied. Send it to support@upromptpay.com.");
    } catch (error) {
      setDemoStatus(error.message || "Unable to prepare demo request.", true);
    }
  });

  demoEmailButton?.addEventListener("click", () => {
    try {
      const { subject, body } = buildDemoBrief();
      const href = `mailto:support@upromptpay.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      window.location.href = href;
      setDemoStatus("If your device supports email links, your client should open now.");
    } catch (error) {
      setDemoStatus(error.message || "Unable to prepare email draft.", true);
    }
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const register = () => navigator.serviceWorker.register("/sw.js").catch(() => {});
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(register, { timeout: 1800 });
  } else {
    window.addEventListener("load", register, { once: true });
  }
}

bindAuthTriggers();
bindDemoLinks();
setupDialogDismissal();
setupMenu();
setupHeaderState();
setupDemoForm();
document.getElementById("signin-submit").addEventListener("click", handleSignIn);
document.getElementById("register-submit").addEventListener("click", handleRegister);
hydrateSession();
registerServiceWorker();
