/**
 * Service worker implementation (loaded from /sw.js via importScripts so scope stays /).
 * App shell, JS and CSS: network-first so a normal reload can pick up a new deploy.
 * API-like requests: network only, never cached. Bump CACHE_VERSION after deploy to drop old caches.
 * CACHE_VERSION is the single manual SW/cache version source; /sw.js imports this file without its own version.
 */
const CACHE_VERSION = 1122;
const CACHE_PREFIX = 'dashboard-static-v';
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;

/** Relative paths from sw.js location — works on any origin/proxy (Replit, deploy, etc). */
const PRECACHE_URLS = [
  "./assets/apple-touch-icon-DZF9rhdV.png",
  "./assets/favicon-D0Y9bj5H.ico",
  "./assets/index-Bl-ZtaYz.js",
  "./assets/style-CmSQV2mB.css",
  "./index.html",
  "./manifest.json"
];

function resolveUrl(path) {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return new URL(path, self.location.href).href;
}

function sameOrigin(url) {
  return url.origin === self.location.origin;
}

/** Same-origin requests that look like API/RPC — never cache (network only). */
function isApiLikeUrl(url) {
  const p = url.pathname.toLowerCase();
  if (p.includes('/api')) return true;
  if (p.includes('/supabase')) return true;
  if (p.includes('/data/')) return true;
  const q = url.search || '';
  if (/[?&]action=/.test(q)) return true;
  return false;
}

function isBlockedCachePath(url) {
  const p = url.pathname.toLowerCase();
  if (p.includes('/attached_assets/')) return true;
  if (p.includes('/dist/')) return true;
  if (p.includes('/tests/')) return true;
  if (p.includes('/docs/prompts/')) return true;
  if (p.includes('/archive') || p.includes('/mock') || p.includes('/debug')) return true;
  if (p.includes('/reports/') || p.includes('/personal-reports')) return true;
  if (/\.(?:pdf|csv|xlsx)(?:$|[?#])/.test(p)) return true;
  return false;
}

function isStaticAssetUrl(url) {
  if (isBlockedCachePath(url)) return false;
  const p = url.pathname;
  if (p.endsWith('/index.html') || p === '/' || p.endsWith('.html')) return true;
  if (p.endsWith('.js') || p.endsWith('.css')) return true;
  if (p.endsWith('.png') || p.endsWith('.ico') || p.endsWith('.svg') || p.endsWith('.webp')) return true;
  if (isManifestUrl(url)) return true;
  if (p.endsWith('.woff2') || p.endsWith('.woff')) return true;
  return false;
}

function isManifestUrl(url) {
  return url.pathname.endsWith('/manifest.json') || (url.pathname.endsWith('.json') && url.pathname.includes('manifest'));
}

function isNavigationRequest(request) {
  return request.mode === 'navigate' || (request.destination && request.destination === 'document');
}

function shouldStoreResponse(response) {
  return response && response.ok && response.type === 'basic' && sameOrigin(new URL(response.url)) && !isBlockedCachePath(new URL(response.url));
}

async function deleteOutdatedCaches() {
  const keys = await caches.keys();
  const outdatedKeys = keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME);
  await Promise.all(outdatedKeys.map((key) => caches.delete(key)));
  return outdatedKeys;
}

async function reloadClientsAfterCacheUpgrade(deletedKeys) {
  if (!Array.isArray(deletedKeys) || !deletedKeys.length) return;
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  await Promise.all(clients.map(async (client) => {
    try {
      await client.navigate(client.url);
    } catch (e) {
      try { client.postMessage({ type: 'SW_UPDATED', version: CACHE_VERSION }); } catch (_) { /* ignore */ }
    }
  }));
}

function withNoStore(request) {
  return new Request(request, { cache: 'no-store' });
}

async function precacheFresh(cache, path) {
  const url = resolveUrl(path);
  const response = await fetch(new Request(url, { cache: 'reload' }));
  if (!shouldStoreResponse(response)) {
    throw new Error(`Unexpected precache response for ${path}: ${response.status}`);
  }
  await cache.put(url, response.clone());
}

async function cacheFirst(request, cache) {
  const matchOpts = { ignoreSearch: true };
  let cached = await cache.match(request, matchOpts);
  if (!cached && isNavigationRequest(request)) {
    cached = await cache.match(resolveUrl('./index.html'), matchOpts);
  }
  if (cached) return cached;

  const response = await fetch(request);
  if (shouldStoreResponse(response)) {
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

async function networkFirst(request, cache) {
  const matchOpts = { ignoreSearch: true };
  try {
    const response = await fetch(withNoStore(request));
    if (shouldStoreResponse(response)) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (err) {
    let cached = await cache.match(request, matchOpts);
    if (!cached && isNavigationRequest(request)) {
      cached = await cache.match(resolveUrl('./index.html'), matchOpts);
    }
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const path of PRECACHE_URLS) {
        try {
          await precacheFresh(cache, path);
        } catch (e) {
          console.warn('[SW] precache skip', path, e);
        }
      }
      // Delete stale caches immediately on install so activate sees a clean state.
      await deleteOutdatedCaches();
      // Take control immediately — don't wait for old SW to die.
      self.skipWaiting();
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    deleteOutdatedCaches().then(async (deletedKeys) => {
      // Claim all open tabs so this SW serves them right away.
      await self.clients.claim();
      await reloadClientsAfterCacheUpgrade(deletedKeys);
    })
  );
});

/** Allow the app to trigger skipWaiting via postMessage({ type: 'SKIP_WAITING' }). */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // External origins (Supabase, CDNs, etc.) — never intercept.
  if (!sameOrigin(url)) return;

  // API-like same-origin routes — always hit the network.
  if (isApiLikeUrl(url) || isBlockedCachePath(url)) {
    event.respondWith(fetch(request));
    return;
  }

  // Only handle navigation + static assets; let everything else pass through.
  if (!(isNavigationRequest(request) || isStaticAssetUrl(url))) return;

  // HTML / JS / CSS / manifest — network-first so a reload always gets the latest.
  const networkFresh = (
    isNavigationRequest(request) ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('/manifest.json') || isManifestUrl(url)
  );

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      networkFresh ? networkFirst(request, cache) : cacheFirst(request, cache)
    )
  );
});
