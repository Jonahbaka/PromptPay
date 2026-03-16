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

const STORAGE_TOKEN = "promptpay_token";
const STORAGE_USER = "promptpay_user";

function setStatus(message, isError = false) {
  authStatus.textContent = message;
  authStatus.style.color = isError ? "#ff9d67" : "#8da0b3";
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
  if (user.role === "owner") return "/secure/admin";
  if (user.role === "partner_admin") return "/secure/partners";
  return "/api/v1/docs";
}

function shouldRedirectAfterAuth(user) {
  return user.role === "owner" || user.role === "partner_admin";
}

function renderLoggedOut() {
  sessionTitle.textContent = "Use your operator credentials";
  sessionCopy.textContent =
    "Sign in to existing admin or partner environments, or create access to start a new network rollout.";
  sessionActions.innerHTML = `
    <button class="button button-primary" type="button" data-open-auth="signin">Sign In</button>
    <button class="button button-secondary" type="button" data-open-auth="register">Start Network</button>
  `;
  bindAuthTriggers(sessionActions);
}

function renderLoggedIn(user) {
  sessionTitle.textContent = `Welcome back, ${user.displayName || user.email}`;
  sessionCopy.textContent =
    user.role === "user"
      ? "Starter access is active. Open the docs, review integration flows, and continue onboarding with PromptPay."
      : "Your operator console is ready. Open the workspace to manage network operations and access controls.";
  sessionActions.innerHTML = `
    <a class="button button-primary" href="${getConsoleHref(user)}">Open Console</a>
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
    return;
  }
  renderLoggedIn(user);
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
    persistSession(payload.user, payload.token);
    hideAuth();
    document.getElementById("access").scrollIntoView({ behavior: "smooth", block: "start" });
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
    setStatus("Enter team name, email, and password.", true);
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
    persistSession(payload.user, payload.token);
    hideAuth();
    document.getElementById("access").scrollIntoView({ behavior: "smooth", block: "start" });
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
setupDialogDismissal();
setupMenu();
document.getElementById("signin-submit").addEventListener("click", handleSignIn);
document.getElementById("register-submit").addEventListener("click", handleRegister);
authTabs.forEach((tab) => tab.addEventListener("click", () => setTab(tab.dataset.authTab)));
hydrateSession();
registerServiceWorker();
