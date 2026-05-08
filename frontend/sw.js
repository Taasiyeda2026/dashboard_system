/**
 * Service worker implementation (loaded from /sw.js via importScripts so scope stays /).
 * App shell, JS and CSS: network-first so a normal reload can pick up a new deploy.
 * API-like requests: network only, never cached. Bump CACHE_VERSION after deploy to drop old caches.
 */
const CACHE_VERSION = 347;
const CACHE_NAME = `dashboard-static-v${CACHE_VERSION}`;

/** Relative paths from sw.js location — works on any origin/proxy (Replit, deploy, etc). */
const PRECACHE_URLS = [
  './index.html'
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
  const q = url.search || '';
  if (/[?&]action=/.test(q)) return true;
  return false;
}

function isStaticAssetUrl(url) {
  const p = url.pathname;
  if (p.endsWith('/index.html') || p === '/' || p.endsWith('.html')) return true;
  if (p.endsWith('.js') || p.endsWith('.css')) return true;
  if (p.endsWith('.png') || p.endsWith('.ico') || p.endsWith('.svg') || p.endsWith('.webp')) return true;
  if (p.endsWith('.json') && p.includes('manifest')) return true;
  if (p.endsWith('.woff2') || p.endsWith('.woff')) return true;
  return false;
}

function isNavigationRequest(request) {
  return request.mode === 'navigate' || (request.destination && request.destination === 'document');
}

function shouldStoreResponse(response) {
  return response && response.ok && response.type === 'basic' && sameOrigin(new URL(response.url));
}

function withNoStore(request) {
  if (request.cache === 'no-store') return request;
  return new Request(request, { cache: 'no-store' });
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
          await cache.add(resolveUrl(path));
        } catch (e) {
          console.warn('[SW] precache skip', path, e);
        }
      }
      self.skipWaiting();
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!sameOrigin(url)) return;

  if (isApiLikeUrl(url)) {
    event.respondWith(fetch(request));
    return;
  }

  if (!(isNavigationRequest(request) || isStaticAssetUrl(url))) return;

  const networkFresh = isNavigationRequest(request) || url.pathname.endsWith('.html') || url.pathname.endsWith('.js') || url.pathname.endsWith('.css');
  event.respondWith(caches.open(CACHE_NAME).then((cache) => networkFresh ? networkFirst(request, cache) : cacheFirst(request, cache)));
});
