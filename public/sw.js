const CACHE_NAME = "promptpay-portals-v12";
const OFFLINE_URL = "/offline.html";
const STATIC_ASSETS = [
  OFFLINE_URL,
  "/dashboard",
  "/partner",
  "/admin",
  "/manifest.json",
  "/assets/portal.css",
  "/assets/dashboard.js",
  "/assets/partner-portal.js",
  "/assets/admin-portal.js",
  "/assets/site.css",
  "/assets/mobile-glass.css",
  "/assets/site.js",
  "/assets/console-core.js",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      ),
      self.registration.navigationPreload?.enable().catch(() => {})
    ]).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = request.url;
  if (url.includes("/api/") || url.includes("/ws") || url.includes("/health")) {
    return;
  }

  if (request.mode === "navigate" || url.endsWith(".html")) {
    event.respondWith(
      (async () => {
        try {
          const preload = await event.preloadResponse;
          if (preload) return preload;
        } catch {}

        try {
          const response = await fetch(request);
          if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
          }
          return response;
        } catch {
          return (await caches.match(request)) || (await caches.match(OFFLINE_URL));
        }
      })()
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(async (cached) => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, response.clone());
        }
        return response;
      } catch {
        return cached || new Response("", { status: 503 });
      }
    })
  );
});
