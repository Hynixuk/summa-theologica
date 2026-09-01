// Service Worker for Summa Theologica PWA
// Enables offline reading, caching, and app-like experience

const CACHE_VERSION = 'summa-v1';
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
  '/alignment-data.js',
  '/manifest.json'
];

// Install: cache static assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      console.log('[SW] Caching static assets');
      return cache.addAll(STATIC_ASSETS).catch(() => {
        // If addAll fails (e.g., some resources don't exist), proceed anyway
        // We'll handle individual failures in fetch
        console.log('[SW] Some assets failed to cache, will retry on fetch');
        return Promise.resolve();
      });
    })
  );
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_VERSION) {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          }
        })
      );
    })
  );
});

// Fetch: network-first for dynamic content, cache-first for static
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Audio files: use cache-first strategy (large, infrequently updated)
  if (url.pathname.includes('/audio/')) {
    event.respondWith(
      caches
        .match(request)
        .then((response) => response || fetch(request))
        .catch(() => {
          console.log('[SW] Failed to fetch audio:', url.pathname);
          return new Response('Audio not available offline', { status: 503 });
        })
    );
    return;
  }

  // Static assets (JS, CSS): cache-first
  if (
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname === '/' ||
    url.pathname.endsWith('.json')
  ) {
    event.respondWith(
      caches
        .match(request)
        .then((response) => {
          if (response) return response;
          return fetch(request).then((fetchResponse) => {
            // Cache successful responses
            if (fetchResponse && fetchResponse.status === 200) {
              const responseToCache = fetchResponse.clone();
              caches.open(CACHE_VERSION).then((cache) => {
                cache.put(request, responseToCache);
              });
            }
            return fetchResponse;
          });
        })
        .catch(() => {
          console.log('[SW] Offline: serving cached version of', url.pathname);
          return caches.match(request);
        })
    );
    return;
  }

  // Default: network-first
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.status === 200) {
          const responseToCache = response.clone();
          caches.open(CACHE_VERSION).then((cache) => {
            cache.put(request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
