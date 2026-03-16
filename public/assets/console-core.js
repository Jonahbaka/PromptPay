export const STORAGE_TOKEN = "promptpay_token";
export const STORAGE_USER = "promptpay_user";

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
  if (role === "owner") return "/secure/admin";
  if (role === "partner_admin") return "/secure/partners";
  return "/";
}

export function redirectForRole(user, fallback = "/") {
  const next = consolePathForRole(user.role);
  window.location.assign(next || fallback);
}

export function ensureRole(user, allowedRoles, fallback = "/") {
  if (!allowedRoles.includes(user.role)) {
    window.location.assign(consolePathForRole(user.role) || fallback);
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

export function wireNavigation(items, sections) {
  items.forEach((item) => {
    item.addEventListener("click", () => {
      const page = item.dataset.page;
      items.forEach((node) => node.classList.toggle("active", node === item));
      sections.forEach((section) => section.classList.toggle("active", section.dataset.page === page));
    });
  });
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

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}
