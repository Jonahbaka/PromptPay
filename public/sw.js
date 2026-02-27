// ═══════════════════════════════════════════════════════════════
// PromptPay Service Worker — PWA + Offline Support
// v4.1 — HTML pages always fetched fresh (never cached)
// ═══════════════════════════════════════════════════════════════

const CACHE_NAME = 'promptpay-v4.1';
const STATIC_ASSETS = [
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// Install — cache only static assets (NOT HTML pages)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate — purge ALL old caches immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch handler
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Skip non-GET
  if (request.method !== 'GET') return;

  // Skip API, WebSocket, health, SSE streams
  if (request.url.includes('/api/') || request.url.includes('/ws') ||
      request.url.includes('/health') || request.url.includes('/stream')) {
    return;
  }

  // HTML pages (navigation) — ALWAYS go to network, never serve from cache
  // This ensures users always see the latest version
  if (request.mode === 'navigate' || request.url.endsWith('.html')) {
    event.respondWith(
      fetch(request).catch(() => {
        // Only use cache as offline fallback
        return caches.match(request).then((cached) => {
          return cached || new Response('Offline — please check your connection', {
            status: 503,
            headers: { 'Content-Type': 'text/html' },
          });
        });
      })
    );
    return;
  }

  // Static assets (CSS, JS, images, fonts) — network first with cache fallback
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => {
        return caches.match(request).then((cached) => {
          return cached || new Response('Offline', { status: 503 });
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
