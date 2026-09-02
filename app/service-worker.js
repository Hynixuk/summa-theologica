// Service Worker for Summa Theologica PWA
// Enables offline reading, caching, and app-like experience.
//
// Cache strategy: audio files (large, essentially immutable once published) stay
// cache-first. Everything else — app code and all the data-*.js / *.json content
// files — is network-first, so a fresh deploy is picked up on the next successful
// load instead of being masked by a stale cache indefinitely. The cache is kept
// only as an offline fallback for those files, not as the primary source.
//
// Bump CACHE_VERSION whenever the caching *strategy* changes (as here) so old
// clients drop their stale cache promptly; content updates don't need a bump
// since network-first already picks them up.
const CACHE_VERSION = 'summa-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/data.js',
  '/data-scg.js',
  '/data-metaphysics.js',
  '/data-aquinas-commentary.js',
  '/data-topics.js',
  '/data-summaries.js',
  '/data-quizzes.js',
  '/alignment-data.js',
  '/manifest.json'
];

// Install: warm the cache with static assets, then activate immediately —
// don't make users wait for every tab to close before getting the new worker.
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {
        // Some resources may not exist yet (e.g. audio-urls.json) — proceed anyway,
        // individual fetches are still handled at request time.
        return Promise.resolve();
      });
    })
  );
});

// Activate: clean up old caches and take control of open tabs right away.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_VERSION) return caches.delete(name);
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  // Audio files: cache-first. Large and effectively immutable once published,
  // so serving from cache (and filling it on first listen) is the right trade-off.
  if (url.pathname.includes('/audio/')) {
    event.respondWith(
      caches
        .match(request)
        .then((response) => response || fetch(request))
        .catch(() => new Response('Audio not available offline', { status: 503 }))
    );
    return;
  }

  // Everything else (app shell, styles, and all data-*.js / *.json content files):
  // network-first, falling back to cache only when offline. This is what makes a
  // new deploy actually show up for returning visitors instead of being stuck
  // behind a stale cache-first copy.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.status === 200) {
          const responseToCache = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, responseToCache));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
