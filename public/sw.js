// ═══════════════════════════════════════════════════════════════
// PromptPay Service Worker — PWA + Offline Support
// v5.0 — Network-first with timeout fallback, proper offline page
// ═══════════════════════════════════════════════════════════════

const CACHE_NAME = 'promptpay-v5.0';
const OFFLINE_URL = '/offline.html';
const STATIC_ASSETS = [
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  OFFLINE_URL,
];

// Install — cache static assets + offline page
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate — purge ALL old caches, enable navigation preload
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      // Delete old caches
      caches.keys().then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        )
      ),
      // Enable navigation preload for faster page loads
      self.registration.navigationPreload?.enable().catch(() => {}),
    ]).then(() => self.clients.claim())
  );
});

// Message handler for skip waiting
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Fetch with timeout helper
function fetchWithTimeout(request, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(request, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

// Fetch handler
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Skip non-GET
  if (request.method !== 'GET') return;

  // Skip API, WebSocket, health, SSE streams, chrome-extension
  const url = request.url;
  if (url.includes('/api/') || url.includes('/ws') ||
      url.includes('/health') || url.includes('/stream') ||
      url.startsWith('chrome-extension://')) {
    return;
  }

  // HTML pages (navigation) — network-first with 8s timeout + offline fallback
  if (request.mode === 'navigate' || url.endsWith('.html')) {
    event.respondWith(
      (async () => {
        // Try navigation preload first (faster on supported browsers)
        try {
          const preloadResponse = await event.preloadResponse;
          if (preloadResponse) return preloadResponse;
        } catch {}

        // Network with timeout
        try {
          const response = await fetchWithTimeout(request, 8000);
          if (response.ok) {
            // Cache the successful HTML response for offline use
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
          }
          return response;
        } catch {
          // Network failed or timed out — try cache, then offline page
          const cached = await caches.match(request);
          if (cached) return cached;
          const offlinePage = await caches.match(OFFLINE_URL);
          if (offlinePage) return offlinePage;
          return new Response(
            '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PromptPay — Offline</title></head><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0d1117;color:#fff;text-align:center"><div><h2>You\'re offline</h2><p>Check your internet connection and try again.</p><button onclick="location.reload()" style="padding:12px 24px;background:#7c3aed;color:#fff;border:none;border-radius:8px;font-size:16px;cursor:pointer;margin-top:16px">Retry</button></div></body></html>',
            { status: 503, headers: { 'Content-Type': 'text/html' } }
          );
        }
      })()
    );
    return;
  }

  // Static assets — network-first with cache fallback
  event.respondWith(
    fetchWithTimeout(request, 10000)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => {
        return caches.match(request).then((cached) => {
          return cached || new Response('', { status: 503 });
        });
      })
  );
});

// Push notifications
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: 'PromptPay', body: event.data.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'PromptPay', {
      body: data.body || 'You have a new notification',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      vibrate: [100, 50, 100],
      data: data.url ? { url: data.url } : { url: '/' },
      actions: data.actions || [],
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.registration.scope) && 'focus' in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
