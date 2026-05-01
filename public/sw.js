/**
 * @file sw.js
 * @description Shared service worker for the Cassa and Sala PWAs.
 *
 * Strategy
 * ─────────
 * • Static assets (JS, CSS, images, fonts) — cache-first: served from cache;
 *   network is used only when the asset is not cached yet.
 * • HTML shells (cassa.html, sala.html, index.html, '/') — network-first:
 *   always try the network so the user gets fresh markup; fall back to cache
 *   when offline.
 * • Remote API / menu URLs and local JSON files — stale-while-revalidate: serve the cached
 *   response immediately, then update the cache in the background.
 *
 * Versioning: bump CACHE_VERSION whenever the app shell changes so that
 * the activate step can purge stale caches from previous installs.
 */

const CACHE_VERSION = 'v1';
const SHELL_CACHE  = `shell-${CACHE_VERSION}`;
const ASSET_CACHE  = `assets-${CACHE_VERSION}`;
const DATA_CACHE   = `data-${CACHE_VERSION}`;

/**
 * Maximum number of entries kept in the asset cache.
 * When a new hashed asset is stored and the total count exceeds this limit,
 * the oldest entries are evicted. This prevents unbounded growth between
 * CACHE_VERSION bumps (which wipe the whole cache on activate).
 */
const MAX_ASSET_ENTRIES = 60;

/** App-shell files pre-cached on install.
 *  Include both the explicit HTML files AND the root path ('./') so that
 *  navigations to '/' are served offline from the shell cache. */
const SHELL_URLS = [
  './',
  './cassa.html',
  './sala.html',
  './cucina.html',
  './index.html',
];

// ─── Install ───────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      // 1. Pre-cache HTML shells.
      const shellCache = await caches.open(SHELL_CACHE);
      await shellCache.addAll(SHELL_URLS);

      // 2. Discover and pre-cache hashed build assets (JS, CSS, module
      //    preloads) by parsing the shell HTML files.  This ensures the
      //    app works offline right after the first install without requiring
      //    a prior online reload to populate the asset cache.
      const assetCache = await caches.open(ASSET_CACHE);
      const assetUrls = await discoverBuildAssets(SHELL_URLS);
      await Promise.all(
        assetUrls.map((url) =>
          fetch(url)
            .then((res) => res.ok ? assetCache.put(url, res) : undefined)
            .catch(() => { /* non-fatal: skip assets missing in this build */ })
        )
      );
    })()
  );
  // Activate immediately — no need to wait for old tabs to close.
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

  // Heuristic: treat JSON/menu endpoints as data requests
  const isDataRequest =
    url.pathname.endsWith('.json') ||
    url.pathname === '/menu.json';

  // Data / API requests (JSON/menu paths) → stale-while-revalidate
  if (isDataRequest) {
    event.respondWith(staleWhileRevalidate(event, DATA_CACHE));
    return;
  }

  // HTML navigation requests → network-first (fresh shell when online)
  if (request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    event.respondWith(networkFirst(event, SHELL_CACHE));
    return;
  }

  // Static assets (JS, CSS, images, fonts, manifests) → cache-first
  event.respondWith(cacheFirst(event, ASSET_CACHE));
});

// ─── Background Sync ───────────────────────────────────────────────────────
/**
 * Background Sync tag used when the app enqueues an order while offline.
 *
 * When the device regains connectivity the browser fires this event, giving
 * the Service Worker an opportunity to wake the app (or notify it) so the
 * push queue can drain and pending orders are forwarded to Directus.
 *
 * Strategy:
 *   1. Prefer posting a message to any open app client — the Vue app's push
 *      loop then drains the queue normally through `forcePush()`.
 *   2. If no app client is reachable the SW cannot run Pinia/IDB logic
 *      directly (no DOM access), so it simply logs the event.  The queue
 *      will drain on the next page open or online reconnect.
 *
 * Note: Background Sync is currently a Chrome / Chromium-only feature.
 *       The registration in `enqueue()` is guarded by `'sync' in registration`,
 *       so the app degrades gracefully on browsers that don't support it.
 */
self.addEventListener('sync', (event) => {
  if (event.tag !== 'sync-orders') return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      if (clients.length > 0) {
        // Notify all open app windows to drain the push queue.
        clients.forEach((client) => {
          client.postMessage({ type: 'bg-sync:drain-queue', tag: event.tag });
        });
      } else {
        // No open client: log and let the push loop handle it on next startup.
        console.info('[SW] bg-sync: no client available — queue will drain on next app open.');
      }
    }).catch((err) => {
      // Swallow errors so the sync event resolves successfully and isn't retried
      // just because matchAll() or postMessage() threw (e.g., client closed mid-delivery).
      console.error('[SW] bg-sync: error notifying clients:', err);
    })
  );
});

// ─── Strategies ────────────────────────────────────────────────────────────

/** Cache-first: serve from cache; populate cache on first miss.
 *  Cache writes happen in the background via event.waitUntil so the
 *  network response is returned to the page immediately. */
async function cacheFirst(event, cacheName) {
  const { request } = event;
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      // Write and optionally trim in the background — don't delay the response
      event.waitUntil(
        cache.put(request, response.clone())
          .then(() => {
            if (cacheName === ASSET_CACHE) {
              return trimCache(cache, MAX_ASSET_ENTRIES).catch((err) => {
                console.warn('[SW] cacheFirst: trimCache failed.', err);
              });
            }
          })
          .catch((err) => {
            console.warn('[SW] cacheFirst: cache.put failed.', err);
          })
      );
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

/** Network-first: try network; fall back to cache when offline.
 *  Cache writes happen in the background via event.waitUntil so the
 *  network response is returned to the page immediately. */
async function networkFirst(event, cacheName) {
  const { request } = event;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      // Write to cache in the background — don't delay the response
      event.waitUntil(
        cache.put(request, response.clone())
          .catch((err) => {
            console.warn('[SW] networkFirst: cache write failed.', err);
          })
      );
    }
    return response;
  } catch (err) {
    console.warn('[SW] networkFirst: network unavailable, falling back to cache.', err);
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response('App non disponibile offline.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

/**
 * Trim a cache to at most `maxEntries` entries by deleting the first keys
 * returned by `cache.keys()` (insertion order per the SW spec). Awaited
 * after each asset cache write to keep the cache size bounded.
 */
async function trimCache(cache, maxEntries) {
  const keys = await cache.keys();
  if (keys.length > maxEntries) {
    const toDelete = keys.slice(0, keys.length - maxEntries);
    await Promise.all(toDelete.map((key) => cache.delete(key)));
  }
}

/**
 * Fetch each HTML shell and extract the hashed JS/CSS build-asset URLs
 * referenced by `src="…"` or `href="…"` attributes that point into
 * Vite's `assets/` directory.  Paths are resolved to absolute URLs so
 * that `cache.put()` keys match the browser's request URLs.
 * Returns a de-duplicated array of absolute URL strings.
 */
async function discoverBuildAssets(shellUrls) {
  const assetSet = new Set();
  await Promise.all(
    shellUrls.map(async (shellUrl) => {
      try {
        // Resolve to absolute so relative asset paths can be anchored correctly.
        const absoluteShellUrl = new URL(shellUrl, self.location.href).href;
        const response = await fetch(absoluteShellUrl);
        if (!response.ok) return;
        const html = await response.text();
        for (const [, path] of html.matchAll(/(?:src|href)=["']([^"']*assets\/[^"']+)["']/gi)) {
          assetSet.add(new URL(path, absoluteShellUrl).href);
        }
      } catch {
        // Ignore fetch errors for individual shells; asset caching is best-effort.
      }
    })
  );
  return [...assetSet];
}

/**
 * Stale-while-revalidate: serve cached immediately; refresh cache in the
 * background.
 *
 * `event.waitUntil` is called synchronously (before any await) so the SW
 * is kept alive until the background revalidation finishes, even when a
 * cached response is returned immediately.
 */
function staleWhileRevalidate(event, cacheName) {
  const { request } = event;
  const cachePromise = caches.open(cacheName);

  // Start the network fetch; store the result in cache when it lands.
  const networkPromise = fetch(request.clone())
    .then((response) => {
      if (response.ok) {
        return cachePromise
          .then((cache) => cache.put(request, response.clone()))
          .catch((err) => {
            console.warn('[SW] staleWhileRevalidate: cache.put failed.', err);
          })
          .then(() => response);
      }
      return response;
    })
    .catch((err) => {
      // Network unavailable — warn and return null so the cached response takes priority
      console.warn('[SW] staleWhileRevalidate: background fetch failed.', err);
      return null;
    });

  // Extend the SW lifetime to ensure the background cache update completes
  // even when a cached response is returned immediately below.
  event.waitUntil(networkPromise);

  // Respond with the cached version immediately if available, else wait for network.
  return cachePromise.then((cache) =>
    cache.match(request).then((cached) => {
      if (cached) return cached;
      return networkPromise.then((response) => {
        if (response) return response;
        return new Response('Risorsa non disponibile offline.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      });
    })
  );
}
