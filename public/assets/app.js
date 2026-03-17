const STORAGE_TOKEN = "promptpay_token";
const STORAGE_USER = "promptpay_user";

const state = {
  token: localStorage.getItem(STORAGE_TOKEN) || "",
  user: null,
  wallet: null,
  transactions: [],
  sales: [],
  carrier: null,
  bundles: [],
  selectedBundleIndex: -1,
  product: "airtime",
  deferredInstallPrompt: null,
  toastTimer: null
};

const COUNTRY_CODE_ALIASES = {
  nigeria: "NG",
  ng: "NG",
  ghana: "GH",
  gh: "GH",
  kenya: "KE",
  ke: "KE",
  uganda: "UG",
  ug: "UG",
  "south africa": "ZA",
  za: "ZA"
};

const authView = document.getElementById("auth-view");
const appShell = document.getElementById("app-shell");
const authStatus = document.getElementById("auth-status");
const airtimeStatus = document.getElementById("airtime-status");
const profileStatus = document.getElementById("profile-status");
const fundStatus = document.getElementById("fund-status");
const toast = document.getElementById("toast");

const loginForm = document.getElementById("login-form");
const loginEmail = document.getElementById("login-email");
const loginPassword = document.getElementById("login-password");
const loginSubmit = document.getElementById("login-submit");
const testUserAccess = document.getElementById("test-user-access");

const pages = [...document.querySelectorAll(".app-page")];
const navItems = [...document.querySelectorAll(".nav-item")];
const quickNavItems = [...document.querySelectorAll("[data-nav-target]")];
const segments = [...document.querySelectorAll(".segment")];

const headerName = document.getElementById("header-name");
const headerAvatar = document.getElementById("header-avatar");
const profileName = document.getElementById("profile-name");
const profileEmail = document.getElementById("profile-email");
const profileCountry = document.getElementById("profile-country");
const profileAvatarText = document.getElementById("profile-avatar-text");
const profileAvatarImage = document.getElementById("profile-avatar-image");
const profilePictureInput = document.getElementById("profile-picture-input");

const balanceAmount = document.getElementById("balance-amount");
const balanceSubtext = document.getElementById("balance-subtext");
const statFunded = document.getElementById("stat-funded");
const statSpent = document.getElementById("stat-spent");
const statEarned = document.getElementById("stat-earned");
const todaySalesCount = document.getElementById("today-sales-count");
const todaySalesAmount = document.getElementById("today-sales-amount");
const todayProfitAmount = document.getElementById("today-profit-amount");
const recentTransactions = document.getElementById("recent-transactions");
const transactionList = document.getElementById("transaction-list");
const salesList = document.getElementById("sales-list");

const refreshButton = document.getElementById("refresh-button");
const homeAirtimeButton = document.getElementById("home-airtime-button");
const fundWalletButton = document.getElementById("fund-wallet-button");
const installButton = document.getElementById("install-button");
const installCta = document.getElementById("install-cta");
const logoutButton = document.getElementById("logout-button");

const countrySelect = document.getElementById("country-select");
const phoneInput = document.getElementById("phone-input");
const carrierInput = document.getElementById("carrier-input");
const amountInput = document.getElementById("amount-input");
const detectButton = document.getElementById("detect-button");
const bundleList = document.getElementById("bundle-list");
const purchaseButton = document.getElementById("purchase-button");
const airtimeForm = document.getElementById("airtime-form");

const fundModal = document.getElementById("fund-modal");
const fundAmountInput = document.getElementById("fund-amount-input");
const fundSubmit = document.getElementById("fund-submit");
const closeFundButtons = [...document.querySelectorAll("[data-close-fund]")];

function setStatus(target, message, isError = false) {
  target.textContent = message || "";
  target.style.color = isError ? "#ff9f86" : "#97a7bf";
}

function showToast(message) {
  if (!message) return;
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => {
    toast.classList.remove("show");
  }, 2600);
}

function formatMoney(value, currency = "NGN") {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return "Pending";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Pending";
  return date.toLocaleString("en-NG", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function initialFromUser(user) {
  const source = user?.displayName || user?.email || "PP";
  return source
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "PP";
}

function normalizeCountry(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return COUNTRY_CODE_ALIASES[normalized] || String(value || "").trim().toUpperCase();
}

function setLoadingState(button, idleLabel, loadingLabel) {
  button.disabled = true;
  button.textContent = loadingLabel;
  return () => {
    button.disabled = false;
    button.textContent = idleLabel;
  };
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
    if (response.status === 401 && !url.includes("/api/auth/login") && !url.includes("/api/auth/test-access")) {
      clearSession();
      showAuth("Your session expired. Sign in again.");
    }
    const error = new Error(payload.error || "Request failed");
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function authJson(url, options = {}) {
  return requestJson(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${state.token}`,
      ...(options.headers || {})
    }
  });
}

function saveSession(user, token) {
  state.user = user;
  state.token = token;
  localStorage.setItem(STORAGE_TOKEN, token);
  localStorage.setItem(STORAGE_USER, JSON.stringify(user));
}

function clearSession() {
  state.token = "";
  state.user = null;
  localStorage.removeItem(STORAGE_TOKEN);
  localStorage.removeItem(STORAGE_USER);
}

function redirectForRole(user) {
  if (!user?.role) return false;
  if (user.role === "owner") {
    window.location.assign("/secure/admin");
    return true;
  }
  if (user.role === "partner_admin") {
    window.location.assign("/secure/partners");
    return true;
  }
  return false;
}

function showAuth(message = "") {
  appShell.classList.add("hidden");
  authView.classList.remove("hidden");
  setStatus(authStatus, message);
}

function showApp() {
  authView.classList.add("hidden");
  appShell.classList.remove("hidden");
}

function switchPage(page) {
  pages.forEach((item) => item.classList.toggle("active", item.dataset.page === page));
  navItems.forEach((item) => item.classList.toggle("active", item.dataset.page === page));
}

function setProductMode(product) {
  state.product = product;
  segments.forEach((item) => item.classList.toggle("active", item.dataset.product === product));
  purchaseButton.textContent = product === "data" ? "Buy Data" : "Buy Airtime";
  bundleList.classList.toggle("hidden", product !== "data");

  if (product === "data" && state.carrier?.operatorId) {
    loadDataBundles(state.carrier.operatorId).catch((error) => {
      setStatus(airtimeStatus, error.message || "Unable to load data bundles.", true);
    });
  }
}

function renderUser() {
  if (!state.user) return;

  const initials = initialFromUser(state.user);
  headerName.textContent = state.user.displayName || state.user.email || "PromptPay user";
  headerAvatar.textContent = initials;
  profileName.textContent = state.user.displayName || state.user.email || "PromptPay user";
  profileEmail.textContent = state.user.email || "";
  const normalizedCountry = normalizeCountry(state.user.country);
  profileCountry.value = normalizedCountry;
  if (normalizedCountry) {
    countrySelect.value = normalizedCountry;
  }

  if (state.user.profilePicture) {
    profileAvatarImage.src = state.user.profilePicture;
    profileAvatarImage.hidden = false;
    profileAvatarText.hidden = true;
    headerAvatar.textContent = "";
    headerAvatar.style.backgroundImage = `url('${state.user.profilePicture}')`;
    headerAvatar.style.backgroundSize = "cover";
    headerAvatar.style.backgroundPosition = "center";
  } else {
    profileAvatarImage.hidden = true;
    profileAvatarText.hidden = false;
    profileAvatarText.textContent = initials;
    headerAvatar.textContent = initials;
    headerAvatar.style.backgroundImage = "";
  }
}

function renderWallet() {
  const wallet = state.wallet || {};
  const today = wallet.today || {};

  balanceAmount.textContent = formatMoney(wallet.balance || 0, wallet.currency || "NGN");
  balanceSubtext.textContent = wallet.isAgent
    ? "Use your wallet for airtime/data sales and track daily agent performance."
    : "Use your wallet for airtime, data, and PromptPay activity.";

  statFunded.textContent = formatMoney(wallet.totalFunded || 0, wallet.currency || "NGN");
  statSpent.textContent = formatMoney(wallet.totalSpent || 0, wallet.currency || "NGN");
  statEarned.textContent = formatMoney(wallet.totalEarned || 0, wallet.currency || "NGN");
  todaySalesCount.textContent = String(today.salesCount || 0);
  todaySalesAmount.textContent = formatMoney(today.totalSales || 0, wallet.currency || "NGN");
  todayProfitAmount.textContent = formatMoney(today.totalProfit || 0, wallet.currency || "NGN");
}

function renderTransactionItems(target, items, emptyText) {
  if (!items.length) {
    target.innerHTML = `<div class="empty-state">${emptyText}</div>`;
    return;
  }

  target.innerHTML = items.map((item) => {
    const type = String(item.type || item.product_type || "activity").replace(/_/g, " ");
    const amount = Number(item.amount ?? item.face_value ?? 0);
    const amountClass = item.type === "fund" || item.type === "refund" ? "positive" : "negative";

    return `
      <div class="list-item">
        <div>
          <strong>${type.charAt(0).toUpperCase() + type.slice(1)}</strong>
          <div class="list-meta">${item.description || item.carrier || "PromptPay activity"} • ${formatDate(item.created_at)}</div>
        </div>
        <div class="list-amount ${amountClass}">${formatMoney(amount, "NGN")}</div>
      </div>
    `;
  }).join("");
}

function renderTransactions() {
  renderTransactionItems(
    recentTransactions,
    state.transactions.slice(0, 5),
    "No wallet transactions yet. Fund your wallet or buy airtime to get started."
  );
  renderTransactionItems(
    transactionList,
    state.transactions,
    "No wallet transactions yet. Your activity will appear here."
  );
}

function renderSales() {
  const sales = state.sales || [];
  if (!sales.length) {
    salesList.innerHTML = '<div class="empty-state">No airtime or data sales yet.</div>';
    return;
  }

  salesList.innerHTML = sales.map((sale) => `
    <div class="list-item">
      <div>
        <strong>${sale.product_type === "data" ? "Data" : "Airtime"} • ${sale.carrier || "Carrier"}</strong>
        <div class="list-meta">${sale.customer_phone || "Phone unavailable"} • ${formatDate(sale.created_at)}</div>
      </div>
      <div class="list-amount">${formatMoney(sale.face_value || 0, "NGN")}</div>
    </div>
  `).join("");
}

function renderBundles() {
  if (state.product !== "data") {
    bundleList.innerHTML = "";
    return;
  }

  if (!state.bundles.length) {
    bundleList.innerHTML = '<div class="empty-state">Detect a carrier to load data bundles.</div>';
    return;
  }

  bundleList.innerHTML = state.bundles.map((bundle, index) => `
    <div class="bundle-item">
      <label>
        <input type="radio" name="bundle" value="${index}" ${index === state.selectedBundleIndex ? "checked" : ""}>
        <div>
          <strong>${bundle.name || "Data bundle"}</strong>
          <div class="list-meta">${formatMoney(bundle.price || 0, bundle.currency || "NGN")} • ${bundle.validity || "Duration not set"} ${bundle.validityUnit || ""}</div>
        </div>
      </label>
    </div>
  `).join("");

  bundleList.querySelectorAll('input[name="bundle"]').forEach((input) => {
    input.addEventListener("change", () => {
      state.selectedBundleIndex = Number(input.value);
      const bundle = state.bundles[state.selectedBundleIndex];
      amountInput.value = String(bundle?.price || "");
    });
  });
}

async function refreshData() {
  setStatus(airtimeStatus, "");
  setStatus(profileStatus, "");
  await Promise.all([
    loadWallet(),
    loadTransactions(),
    loadPosDashboard()
  ]);
}

async function loadWallet() {
  state.wallet = await authJson("/api/wallet/balance");
  renderWallet();
}

async function loadTransactions() {
  const payload = await authJson("/api/wallet/transactions?limit=30");
  state.transactions = payload.transactions || [];
  renderTransactions();
}

async function loadPosDashboard() {
  const payload = await authJson("/api/pos/dashboard");
  state.sales = payload.recentSales || [];
  renderSales();
}

async function detectCarrier() {
  const phone = phoneInput.value.trim();
  const country = countrySelect.value;

  if (!phone) {
    throw new Error("Enter a phone number first.");
  }

  setStatus(airtimeStatus, "Detecting carrier...");
  const payload = await authJson(`/api/pos/detect-carrier?phone=${encodeURIComponent(phone)}&country=${encodeURIComponent(country)}`);
  state.carrier = payload;
  carrierInput.value = payload.carrier || "";
  setStatus(airtimeStatus, `Detected ${payload.carrier || "carrier"}.`);

  if (state.product === "data" && payload.operatorId) {
    await loadDataBundles(payload.operatorId);
  }
}

async function loadDataBundles(operatorId) {
  setStatus(airtimeStatus, "Loading data bundles...");
  const payload = await authJson(`/api/pos/data-bundles?operatorId=${encodeURIComponent(operatorId)}`);
  state.bundles = payload.bundles || [];
  state.selectedBundleIndex = state.bundles.length ? 0 : -1;

  if (state.bundles[0]) {
    amountInput.value = String(state.bundles[0].price || "");
  }

  renderBundles();
  setStatus(airtimeStatus, state.bundles.length ? "Choose a bundle and complete the purchase." : "No bundles available for this carrier.");
}

async function handlePurchase(event) {
  event.preventDefault();
  const resetButton = setLoadingState(purchaseButton, state.product === "data" ? "Buy Data" : "Buy Airtime", "Processing...");
  const phoneNumber = phoneInput.value.trim();
  const countryCode = countrySelect.value;

  try {
    if (!state.carrier?.operatorId || !carrierInput.value) {
      await detectCarrier();
    }

    if (state.product === "data") {
      const bundle = state.bundles[state.selectedBundleIndex];
      if (!bundle) {
        throw new Error("Select a data bundle first.");
      }

      const payload = await authJson("/api/pos/sell-data", {
        method: "POST",
        body: JSON.stringify({
          phoneNumber,
          amount: Number(bundle.price || 0),
          countryCode,
          operatorId: state.carrier.operatorId,
          dataBundleId: bundle.id,
          bundleName: bundle.name
        })
      });

      setStatus(airtimeStatus, "Data purchase completed.");
      showToast(`Data sent to ${payload.phoneNumber || phoneNumber}`);
    } else {
      const amount = Number(amountInput.value || 0);
      if (!amount || amount <= 0) {
        throw new Error("Enter a valid airtime amount.");
      }

      const payload = await authJson("/api/pos/sell", {
        method: "POST",
        body: JSON.stringify({
          phoneNumber,
          amount,
          countryCode,
          productType: "airtime"
        })
      });

      setStatus(airtimeStatus, "Airtime purchase completed.");
      showToast(`Airtime sent to ${payload.phoneNumber || phoneNumber}`);
    }

    await refreshData();
  } catch (error) {
    setStatus(airtimeStatus, error.message || "Purchase failed.", true);
  } finally {
    resetButton();
  }
}

function openFundModal() {
  fundModal.classList.remove("hidden");
  fundModal.setAttribute("aria-hidden", "false");
  setStatus(fundStatus, "");
}

function closeFundModal() {
  fundModal.classList.add("hidden");
  fundModal.setAttribute("aria-hidden", "true");
}

async function loadPaystackScript() {
  if (window.PaystackPop) return;

  await new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-paystack="true"]');
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://js.paystack.co/v2/inline.js";
    script.async = true;
    script.dataset.paystack = "true";
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener("error", reject, { once: true });
    document.head.appendChild(script);
  });
}

async function handleFundWallet() {
  const resetButton = setLoadingState(fundSubmit, "Continue to Paystack", "Opening...");
  const amount = Number(fundAmountInput.value || 0);

  try {
    if (!amount || amount < 100) {
      throw new Error("Minimum wallet funding amount is N100.");
    }

    setStatus(fundStatus, "Loading payment window...");
    const config = await requestJson("/api/config/paystack-key");
    await loadPaystackScript();

    const reference = `pp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    window.PaystackPop.setup({
      key: config.publicKey,
      email: state.user.email,
      amount: Math.round(amount * 100),
      currency: "NGN",
      ref: reference,
      onClose: () => {
        setStatus(fundStatus, "Funding window closed.");
        resetButton();
      },
      callback: async (response) => {
        try {
          setStatus(fundStatus, "Verifying payment...");
          await authJson("/api/wallet/fund-paystack", {
            method: "POST",
            body: JSON.stringify({
              reference: response.reference,
              amount
            })
          });
          closeFundModal();
          await refreshData();
          showToast("Wallet funded successfully.");
        } catch (error) {
          setStatus(fundStatus, error.message || "Funding verification failed.", true);
        } finally {
          resetButton();
        }
      }
    }).openIframe();
  } catch (error) {
    setStatus(fundStatus, error.message || "Unable to open Paystack.", true);
    resetButton();
  }
}

async function updateCountry(country) {
  try {
    await authJson("/api/user/settings", {
      method: "PUT",
      body: JSON.stringify({ country })
    });
    state.user.country = country;
    setStatus(profileStatus, "Country updated.");
    showToast("Country updated.");
  } catch (error) {
    setStatus(profileStatus, error.message || "Unable to update country.", true);
  }
}

async function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Unable to read image."));
    reader.readAsDataURL(file);
  });
}

async function handleProfilePicture(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const image = await readFileAsDataUrl(file);
    await authJson("/api/auth/profile-picture", {
      method: "POST",
      body: JSON.stringify({ image })
    });

    state.user.profilePicture = image;
    renderUser();
    setStatus(profileStatus, "Profile picture updated.");
    showToast("Profile picture updated.");
  } catch (error) {
    setStatus(profileStatus, error.message || "Unable to upload picture.", true);
  } finally {
    profilePictureInput.value = "";
  }
}

async function requestTestAccess(account) {
  return requestJson("/api/auth/test-access", {
    method: "POST",
    body: JSON.stringify({ account })
  });
}

async function handleLogin(event) {
  event.preventDefault();
  const resetButton = setLoadingState(loginSubmit, "Sign In", "Signing In...");
  setStatus(authStatus, "Authenticating...");

  try {
    const payload = await requestJson("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: loginEmail.value.trim(),
        password: loginPassword.value
      })
    });

    saveSession(payload.user, payload.token);
    if (redirectForRole(payload.user)) return;
    renderUser();
    showApp();
    await refreshData();
  } catch (error) {
    setStatus(authStatus, error.message || "Unable to sign in.", true);
  } finally {
    resetButton();
  }
}

async function handleTestUser() {
  const resetButton = setLoadingState(testUserAccess, "Use Test User", "Opening...");
  setStatus(authStatus, "Opening test user access...");

  try {
    const payload = await requestTestAccess("user");
    saveSession(payload.user, payload.token);
    if (redirectForRole(payload.user)) return;
    renderUser();
    showApp();
    await refreshData();
  } catch (error) {
    setStatus(authStatus, error.message || "Unable to open test access.", true);
  } finally {
    resetButton();
  }
}

async function installApp() {
  if (state.deferredInstallPrompt) {
    state.deferredInstallPrompt.prompt();
    await state.deferredInstallPrompt.userChoice.catch(() => {});
    state.deferredInstallPrompt = null;
    installButton.hidden = true;
    showToast("PromptPay install prompt opened.");
    return;
  }

  showToast("Use your browser menu and choose Add to Home Screen.");
}

async function hydrate() {
  if (!state.token) {
    showAuth();
    return;
  }

  try {
    const user = await authJson("/api/auth/me");
    saveSession(user, state.token);
    if (redirectForRole(user)) return;
    renderUser();
    showApp();
    await refreshData();
  } catch {
    clearSession();
    showAuth("Your session expired. Sign in again.");
  }
}

function bindEvents() {
  loginForm.addEventListener("submit", handleLogin);
  testUserAccess.addEventListener("click", handleTestUser);

  navItems.forEach((item) => {
    item.addEventListener("click", () => switchPage(item.dataset.page));
  });

  quickNavItems.forEach((item) => {
    item.addEventListener("click", () => {
      const page = item.dataset.navTarget;
      if (!page) return;
      switchPage(page);

      const productTarget = item.dataset.productTarget;
      if (page === "airtime" && productTarget) {
        setProductMode(productTarget);
      }
    });
  });

  segments.forEach((item) => {
    item.addEventListener("click", () => setProductMode(item.dataset.product || "airtime"));
  });

  detectButton.addEventListener("click", () => {
    detectCarrier().catch((error) => setStatus(airtimeStatus, error.message || "Unable to detect carrier.", true));
  });
  phoneInput.addEventListener("blur", () => {
    if (phoneInput.value.trim().length >= 7) {
      detectCarrier().catch(() => {});
    }
  });
  airtimeForm.addEventListener("submit", handlePurchase);

  refreshButton.addEventListener("click", () => {
    refreshData()
      .then(() => showToast("PromptPay refreshed."))
      .catch((error) => showToast(error.message || "Refresh failed."));
  });

  homeAirtimeButton.addEventListener("click", () => switchPage("airtime"));
  fundWalletButton.addEventListener("click", openFundModal);
  fundSubmit.addEventListener("click", handleFundWallet);
  closeFundButtons.forEach((button) => button.addEventListener("click", closeFundModal));

  profileCountry.addEventListener("change", () => updateCountry(profileCountry.value));
  profilePictureInput.addEventListener("change", handleProfilePicture);
  logoutButton.addEventListener("click", () => {
    clearSession();
    showAuth("Signed out.");
  });

  installButton.addEventListener("click", installApp);
  installCta.addEventListener("click", installApp);

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    installButton.hidden = false;
  });
}

bindEvents();
hydrate().catch(() => showAuth("Unable to load PromptPay right now."));
