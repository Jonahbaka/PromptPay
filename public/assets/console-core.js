export const STORAGE_TOKEN = "promptpay_token";
export const STORAGE_USER = "promptpay_user";
const INSTALL_DISMISS_KEY = "promptpay_install_dismissed_v22";
const INSTALL_DISMISS_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const PWA_RUNTIME_KEY = "__promptpayPwaRuntime";
const SW_RELOAD_PREFIX = "promptpay-sw-reloaded:";
const DEFAULT_THEME_COLOR = "#09121b";
const DEFAULT_MANIFEST_PATH = "/manifest.json";
const DEFAULT_APP_ICON = "/icons/icon-192.png";

function isStandaloneMode() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function wasInstallDismissedRecently() {
  const dismissedAt = Number(window.localStorage.getItem(INSTALL_DISMISS_KEY) || 0);
  return Boolean(dismissedAt && Date.now() - dismissedAt < INSTALL_DISMISS_TTL_MS);
}

function dismissInstallBanner() {
  window.localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now()));
  document.querySelector("[data-pwa-install-banner]")?.remove();
}

function syncDisplayModeState() {
  const standalone = isStandaloneMode();
  document.documentElement.classList.toggle("app-standalone", standalone);
  document.body.classList.toggle("app-standalone", standalone);
  if (standalone) {
    document.querySelector("[data-pwa-install-banner]")?.remove();
  }
}

function syncConnectivityState() {
  const offline = !window.navigator.onLine;
  document.documentElement.classList.toggle("app-offline", offline);
  document.body.classList.toggle("app-offline", offline);
}

function removeInstallBanner() {
  document.querySelector("[data-pwa-install-banner]")?.remove();
}

function getPwaRuntime() {
  if (!window[PWA_RUNTIME_KEY]) {
    window[PWA_RUNTIME_KEY] = {
      bootstrapped: false,
      hadControllerAtBoot: Boolean(window.navigator.serviceWorker?.controller),
      registration: null,
      registrationPromise: null,
      swListenersBound: false
    };
  }

  return window[PWA_RUNTIME_KEY];
}

function shouldReloadForVersion(version) {
  if (!version) return false;

  const storageKey = `${SW_RELOAD_PREFIX}${version}`;
  if (window.sessionStorage.getItem(storageKey)) {
    return false;
  }

  window.sessionStorage.setItem(storageKey, "1");
  return true;
}

function ensureHeadNode(selector, tagName, attributes) {
  const head = document.head || document.getElementsByTagName("head")[0];
  if (!head) return null;

  let node = head.querySelector(selector);
  if (!node) {
    node = document.createElement(tagName);
    head.appendChild(node);
  }

  Object.entries(attributes).forEach(([key, value]) => {
    node.setAttribute(key, value);
  });

  return node;
}

function syncSharedPwaHead(options = {}) {
  const appName = options.appName || "PromptPay";
  const themeColor = options.themeColor || DEFAULT_THEME_COLOR;
  const manifestPath = options.manifestPath || DEFAULT_MANIFEST_PATH;
  const iconPath = options.iconPath || DEFAULT_APP_ICON;

  ensureHeadNode('link[rel="manifest"]', "link", { rel: "manifest", href: manifestPath });
  ensureHeadNode('meta[name="theme-color"]', "meta", { name: "theme-color", content: themeColor });
  ensureHeadNode('meta[name="mobile-web-app-capable"]', "meta", {
    name: "mobile-web-app-capable",
    content: "yes"
  });
  ensureHeadNode('meta[name="apple-mobile-web-app-capable"]', "meta", {
    name: "apple-mobile-web-app-capable",
    content: "yes"
  });
  ensureHeadNode('meta[name="apple-mobile-web-app-status-bar-style"]', "meta", {
    name: "apple-mobile-web-app-status-bar-style",
    content: "black-translucent"
  });
  ensureHeadNode('meta[name="apple-mobile-web-app-title"]', "meta", {
    name: "apple-mobile-web-app-title",
    content: appName
  });
  ensureHeadNode('meta[name="format-detection"]', "meta", {
    name: "format-detection",
    content: "telephone=no"
  });
  ensureHeadNode('link[rel="apple-touch-icon"]', "link", {
    rel: "apple-touch-icon",
    href: iconPath
  });
}

function renderInstallBanner({ appName, description, mode, promptEvent }) {
  removeInstallBanner();

  const banner = document.createElement("aside");
  banner.className = "portal-install-banner";
  banner.setAttribute("data-pwa-install-banner", "true");
  banner.innerHTML = `
    <div class="portal-install-banner__eyebrow">Install ${escapeHtml(appName)}</div>
    <p class="portal-install-banner__copy">${escapeHtml(description)}</p>
    <div class="portal-install-banner__actions">
      ${
        mode === "prompt"
          ? '<button class="button button-primary portal-install-banner__primary" type="button" data-install-action>Install app</button>'
          : '<span class="portal-install-banner__hint">Tap Share, then Add to Home Screen.</span>'
      }
      <button class="button button-secondary portal-install-banner__secondary" type="button" data-dismiss-install>Not now</button>
    </div>
  `;

  banner.querySelector("[data-dismiss-install]")?.addEventListener("click", dismissInstallBanner);

  if (mode === "prompt") {
    banner.querySelector("[data-install-action]")?.addEventListener("click", async () => {
      if (!promptEvent) return;
      try {
        await promptEvent.prompt();
        const result = await promptEvent.userChoice;
        if (result?.outcome !== "accepted") {
          dismissInstallBanner();
        } else {
          removeInstallBanner();
        }
      } catch {
        dismissInstallBanner();
      }
    });
  }

  document.body.appendChild(banner);
}

function registerShellServiceWorker(runtime) {
  if (!("serviceWorker" in navigator) || runtime.swListenersBound) return;

  runtime.swListenersBound = true;

  const applyWaitingWorker = () => {
    if (runtime.registration?.waiting && navigator.serviceWorker.controller) {
      runtime.registration.waiting.postMessage({ type: "SKIP_WAITING" });
    }
  };

  runtime.handleWorkerMessage = (event) => {
    if (event.data?.type !== "APP_SHELL_ACTIVATED") {
      return;
    }

    if (runtime.hadControllerAtBoot && shouldReloadForVersion(event.data.version)) {
      window.location.reload();
    }
  };

  runtime.requestUpdate = () => {
    runtime.registration?.update().catch(() => {});
  };

  runtime.handleVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      runtime.requestUpdate();
    }
  };

  navigator.serviceWorker.addEventListener("message", runtime.handleWorkerMessage);
  document.addEventListener("visibilitychange", runtime.handleVisibilityChange);
  window.addEventListener("online", runtime.requestUpdate);

  const register = async () => {
    try {
      if (!runtime.registrationPromise) {
        runtime.registrationPromise = navigator.serviceWorker.register("/sw.js", { scope: "/" });
      }

      const registration = await runtime.registrationPromise;
      runtime.registration = registration;

      if (!runtime.updateListenerBound) {
        runtime.handleUpdateFound = () => {
          const installing = registration.installing;
          if (!installing) return;

          installing.addEventListener("statechange", () => {
            if (installing.state === "installed") {
              applyWaitingWorker();
            }
          });
        };

        registration.addEventListener("updatefound", runtime.handleUpdateFound);
        runtime.updateListenerBound = true;
      }

      applyWaitingWorker();
      await registration.update().catch(() => {});
    } catch {
      // Service worker setup should not interrupt the live portals.
    }
  };

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(register, { timeout: 1800 });
  } else if (document.readyState === "complete") {
    register();
  } else {
    window.addEventListener("load", register, { once: true });
  }
}

export function bootstrapPwaShell(options = {}) {
  if (typeof window === "undefined") return;

  const runtime = getPwaRuntime();
  syncSharedPwaHead(options);

  if (runtime.bootstrapped) return;
  runtime.bootstrapped = true;

  const appName = options.appName || "PromptPay";
  const installDescription =
    options.installDescription ||
    "Install PromptPay for faster launch, offline shell caching, and a standalone mobile workspace.";
  const iosDescription =
    options.iosDescription ||
    "Add PromptPay to your home screen from Safari so the dashboard opens like a native app.";

  syncDisplayModeState();
  syncConnectivityState();
  registerShellServiceWorker(runtime);

  const displayModeQuery = window.matchMedia("(display-mode: standalone)");
  const onDisplayModeChange = () => syncDisplayModeState();
  if (typeof displayModeQuery.addEventListener === "function") {
    displayModeQuery.addEventListener("change", onDisplayModeChange);
  } else if (typeof displayModeQuery.addListener === "function") {
    displayModeQuery.addListener(onDisplayModeChange);
  }
  window.addEventListener("online", syncConnectivityState);
  window.addEventListener("offline", syncConnectivityState);

  if (isStandaloneMode() || wasInstallDismissedRecently()) return;

  const userAgent = window.navigator.userAgent || "";
  const isIOS = /iphone|ipad|ipod/i.test(userAgent);
  const isSafari = /safari/i.test(userAgent) && !/crios|fxios|edgios|android/i.test(userAgent);

  if (isIOS && isSafari) {
    renderInstallBanner({
      appName,
      description: iosDescription,
      mode: "ios"
    });
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    renderInstallBanner({
      appName,
      description: installDescription,
      mode: "prompt",
      promptEvent: event
    });
  });

  window.addEventListener("appinstalled", () => {
    removeInstallBanner();
    window.localStorage.removeItem(INSTALL_DISMISS_KEY);
  });
}

export function getStoredToken() {
  return localStorage.getItem(STORAGE_TOKEN);
}

export function saveSession(user, token) {
  localStorage.setItem(STORAGE_TOKEN, token);
  localStorage.setItem(STORAGE_USER, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(STORAGE_TOKEN);
  localStorage.removeItem(STORAGE_USER);
}

export async function requestJson(url, options = {}) {
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

export async function authJson(url, token, options = {}) {
  return requestJson(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });
}

export async function getCurrentUser(token) {
  return authJson("/api/auth/me", token);
}

export function consolePathForRole(role) {
  if (role === "owner") return "/admin";
  if (role === "partner_admin") return "/partner";
  return "/dashboard";
}

export function redirectForRole(user, fallback = "/") {
  window.location.assign(consolePathForRole(user?.role) || fallback);
}

export function ensureRole(user, allowedRoles, fallback = "/") {
  if (!allowedRoles.includes(user.role)) {
    redirectForRole(user, fallback);
    return false;
  }
  return true;
}

export function formatNumber(value) {
  const num = Number(value || 0);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(num);
}

export function formatCurrency(value, currency = "USD") {
  const num = Number(value || 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0
  }).format(num);
}

export function formatDate(value) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

export function relativeTime(value) {
  if (!value) return "No recent activity";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No recent activity";
  const deltaSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const ranges = [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60]
  ];

  for (const [unit, seconds] of ranges) {
    if (Math.abs(deltaSeconds) >= seconds || unit === "minute") {
      return rtf.format(Math.round(deltaSeconds / seconds), unit);
    }
  }

  return "just now";
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function setLoadingState(button, label, busyLabel) {
  if (!button) return () => {};
  button.disabled = true;
  button.textContent = busyLabel;
  return () => {
    button.disabled = false;
    button.textContent = label;
  };
}

export function wireNavigation(items, sections, onChange) {
  items.forEach((item) => {
    item.addEventListener("click", () => {
      const page = item.dataset.page;
      items.forEach((node) => node.classList.toggle("active", node.dataset.page === page));
      sections.forEach((section) => section.classList.toggle("active", section.dataset.page === page));
      onChange?.(page);
    });
  });
}

export function renderSparkBars(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return '<div class="empty-inline">No trend data</div>';
  }

  const numeric = values.map((entry) => Number(entry || 0));
  const max = Math.max(...numeric, 1);
  return `<div class="sparkbars">${numeric
    .map((entry) => `<span style="height:${Math.max(12, Math.round((entry / max) * 100))}%"></span>`)
    .join("")}</div>`;
}

export async function copyText(value) {
  if (!navigator.clipboard?.writeText) {
    throw new Error("Clipboard access is not available on this device.");
  }
  await navigator.clipboard.writeText(value);
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

/* ─── Mobile Drawer ─── */

export function wireMobileDrawer() {
  const drawer = document.getElementById("mobile-drawer");
  if (!drawer) return;

  const toggle = document.querySelector("[data-drawer-toggle]");
  const closeBtn = drawer.querySelector("[data-drawer-close]");

  function openDrawer() {
    drawer.classList.add("open");
    document.body.style.overflow = "hidden";
  }

  function closeDrawer() {
    drawer.classList.remove("open");
    document.body.style.overflow = "";
  }

  toggle?.addEventListener("click", openDrawer);
  closeBtn?.addEventListener("click", closeDrawer);

  // Close on escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && drawer.classList.contains("open")) closeDrawer();
  });

  // Wire drawer action buttons to their desktop counterparts
  const drawerRefresh = drawer.querySelector("#drawer-refresh");
  const drawerLogout = drawer.querySelector("#drawer-logout");

  if (drawerRefresh) {
    drawerRefresh.addEventListener("click", () => {
      closeDrawer();
      const desktopRefresh = document.querySelector("[id$='-refresh']:not(#drawer-refresh)");
      desktopRefresh?.click();
    });
  }

  if (drawerLogout) {
    drawerLogout.addEventListener("click", () => {
      closeDrawer();
      const desktopLogout = document.querySelector("[id$='-logout']:not(#drawer-logout)");
      desktopLogout?.click();
    });
  }

  return { openDrawer, closeDrawer };
}
