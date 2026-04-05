const CACHE_NAME = "promptpay-app-shell-v2";
const NAVIGATION_CACHE = `${CACHE_NAME}-pages`;
const ASSET_CACHE = `${CACHE_NAME}-assets`;
const ICON_CACHE = `${CACHE_NAME}-icons`;
const OFFLINE_URL = "/offline.html";
const TRACKING_PARAMS = ["source", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
const ICON_PATHS = new Set(["/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable.png"]);
const INSTALL_ASSETS = [OFFLINE_URL, "/manifest.json", ...ICON_PATHS];
const LEGACY_CACHE_PREFIXES = ["promptpay-app-shell-", "promptpay-portals-v"];

function buildCacheKey(url) {
  const cacheUrl = new URL(url.toString());
  for (const param of TRACKING_PARAMS) {
    cacheUrl.searchParams.delete(param);
  }
  return `${cacheUrl.pathname}${cacheUrl.search}`;
}

function isNavigationRequest(request) {
  return request.mode === "navigate" || request.destination === "document";
}

function shouldBypassRequest(request, url) {
  return (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/ws") ||
    url.pathname.startsWith("/health")
  );
}

function isIconRequest(url) {
  return ICON_PATHS.has(url.pathname);
}

function isScriptRequest(request, url) {
  return request.destination === "script" || /\.js$/i.test(url.pathname);
}

function isStaticAssetRequest(request, url) {
  if (isIconRequest(url)) return false;
  if (url.pathname === "/manifest.json") return true;

  return (
    ["font", "image", "style", "audio", "video"].includes(request.destination) ||
    /\.(?:css|gif|ico|jpe?g|json|mp4|otf|png|svg|ttf|webm|webp|woff2?)$/i.test(url.pathname)
  );
}

function isCacheableResponse(response) {
  return response?.ok && response.type === "basic";
}

async function warmInstallCaches() {
  const assetCache = await caches.open(ASSET_CACHE);
  const iconCache = await caches.open(ICON_CACHE);

  await Promise.allSettled(
    INSTALL_ASSETS.map(async (asset) => {
      const targetCache = ICON_PATHS.has(asset) ? iconCache : assetCache;
      await targetCache.add(asset);
    })
  );
}

async function deleteLegacyCaches() {
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter(
        (key) =>
          LEGACY_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix)) &&
          ![NAVIGATION_CACHE, ASSET_CACHE, ICON_CACHE].includes(key)
      )
      .map((key) => caches.delete(key))
  );
}

async function notifyClientsActivated() {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: "window" });
  for (const client of clients) {
    client.postMessage({ type: "APP_SHELL_ACTIVATED", version: CACHE_NAME });
  }
}

async function enableNavigationPreload() {
  if (!self.registration.navigationPreload) {
    return;
  }

  try {
    await self.registration.navigationPreload.enable();
  } catch {
    // Navigation preload is optional.
  }
}

async function networkFirst(request, cacheName, options = {}) {
  const { cacheKey = request.url, fallbackUrl, preloadResponse, shouldCache } = options;
  const cache = await caches.open(cacheName);

  try {
    const preload = await preloadResponse;
    if (isCacheableResponse(preload)) {
      if (shouldCache?.(preload) !== false) {
        await cache.put(cacheKey, preload.clone());
      }
      return preload;
    }

    const response = await fetch(request);
    if (isCacheableResponse(response) && shouldCache?.(response) !== false) {
      await cache.put(cacheKey, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(cacheKey);
    if (cached) {
      return cached;
    }

    if (fallbackUrl) {
      return (await caches.match(fallbackUrl)) || Response.error();
    }

    return Response.error();
  }
}

async function staleWhileRevalidate(request, cacheName, cacheKey = request.url) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(cacheKey);

  const networkPromise = fetch(request)
    .then(async (response) => {
      if (isCacheableResponse(response)) {
        await cache.put(cacheKey, response.clone());
      }
      return response;
    })
    .catch(() => cached || Response.error());

  return cached || networkPromise;
}

async function cacheFirst(request, cacheName, cacheKey = request.url) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(request);
    if (isCacheableResponse(response)) {
      await cache.put(cacheKey, response.clone());
    }
    return response;
  } catch {
    return Response.error();
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(warmInstallCaches().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    deleteLegacyCaches()
      .then(() => enableNavigationPreload())
      .then(() => self.clients.claim())
      .then(() => notifyClientsActivated())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (shouldBypassRequest(request, url)) {
    return;
  }

  if (isNavigationRequest(request)) {
    event.respondWith(
      networkFirst(request, NAVIGATION_CACHE, {
        cacheKey: buildCacheKey(url),
        fallbackUrl: OFFLINE_URL,
        preloadResponse: event.preloadResponse,
        shouldCache: (response) =>
          isCacheableResponse(response) && response.headers.get("content-type")?.includes("text/html")
      })
    );
    return;
  }

  if (isIconRequest(url)) {
    event.respondWith(cacheFirst(request, ICON_CACHE, url.pathname));
    return;
  }

  if (isScriptRequest(request, url)) {
    event.respondWith(networkFirst(request, ASSET_CACHE, { cacheKey: buildCacheKey(url) }));
    return;
  }

  if (isStaticAssetRequest(request, url)) {
    event.respondWith(staleWhileRevalidate(request, ASSET_CACHE, buildCacheKey(url)));
  }
});
