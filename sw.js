// Service Worker — cache-first for shell assets, network-first for everything else
const CACHE_NAME = 'expense-tracker-v28.9';
// Use relative paths so this works on GitHub Pages (e.g. /expense-tracker/index.html)
const BASE = self.registration.scope;
const SHELL_ASSETS = [
  BASE,
  BASE + 'index.html',
  BASE + 'style.css?v=28.4',
  BASE + 'app.js?v=28.4',
  BASE + 'features.js?v=28.4',
  BASE + 'loans.js?v=28.4',
  BASE + 'savings.js?v=28.4',
  BASE + 'manifest.json',
];

// Install: pre-cache app shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

// Activate: remove old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: cache-first for shell, passthrough for everything else
self.addEventListener('fetch', event => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Cache successful same-origin responses
        if (response.ok && event.request.url.startsWith(self.location.origin)) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback: serve index.html for navigation requests
        if (event.request.mode === 'navigate') {
          return caches.match(self.registration.scope + 'index.html');
        }
      });
    })
  );
});
