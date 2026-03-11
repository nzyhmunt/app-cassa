/**
 * @file sw.js
 * @description Shared service worker for the Cassa and Sala PWAs.
 *
 * Strategy
 * ─────────
 * • Static assets (JS, CSS, images, fonts) — cache-first: served from cache;
 *   network is used only when the asset is not cached yet.
 * • HTML shells (cassa.html, sala.html) — network-first: always try the
 *   network so the user gets fresh markup; fall back to cache when offline.
 * • Remote API / menu URLs — stale-while-revalidate: serve the cached
 *   response immediately, then update the cache in the background.
 *
 * Versioning: bump CACHE_VERSION whenever the app shell changes so that
 * the activate step can purge stale caches from previous installs.
 */

const CACHE_VERSION = 'v1';
const SHELL_CACHE  = `shell-${CACHE_VERSION}`;
const ASSET_CACHE  = `assets-${CACHE_VERSION}`;
const DATA_CACHE   = `data-${CACHE_VERSION}`;

/** App-shell files pre-cached on install */
const SHELL_URLS = [
  './cassa.html',
  './sala.html',
  './index.html',
];

// ─── Install ───────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS))
  );
  // Activate immediately — no need to wait for old tabs to close
  self.skipWaiting();
});

// ─── Activate ──────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  const validCaches = new Set([SHELL_CACHE, ASSET_CACHE, DATA_CACHE]);
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => !validCaches.has(key))
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ─── Fetch ─────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // Heuristic: treat JSON/menu endpoints as data requests regardless of origin
  const isDataRequest =
    url.pathname.endsWith('.json') ||
    url.pathname === '/menu.json';

  // Data / API requests (remote origin or JSON/menu paths) → stale-while-revalidate
  if (url.origin !== self.location.origin || isDataRequest) {
    event.respondWith(staleWhileRevalidate(request, DATA_CACHE));
    return;
  }

  // HTML navigation requests → network-first (fresh shell when online)
  if (request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    event.respondWith(networkFirst(request, SHELL_CACHE));
    return;
  }

  // Static assets (JS, CSS, images, fonts, manifests) → cache-first
  event.respondWith(cacheFirst(request, ASSET_CACHE));
});

// ─── Strategies ────────────────────────────────────────────────────────────

/** Cache-first: serve from cache; populate cache on first miss. */
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    console.warn('[SW] cacheFirst: fetch failed, resource unavailable offline.', err);
    return new Response('Risorsa non disponibile offline.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

/** Network-first: try network; fall back to cache when offline. */
async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    console.warn('[SW] networkFirst: network unavailable, falling back to cache.', err);
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response('App non disponibile offline.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

/** Stale-while-revalidate: serve cached immediately; refresh cache in background. */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch((err) => {
      // Network unavailable — warn and return null so the cached response takes priority
      console.warn('[SW] staleWhileRevalidate: background fetch failed.', err);
      return null;
    });
  // Return the cached version immediately if available, else wait for the network
  if (cached) return cached;
  const networkResponse = await fetchPromise;
  if (networkResponse) return networkResponse;
  return new Response('Risorsa non disponibile offline.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
