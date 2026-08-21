/**
 * Service worker implementation (loaded from /sw.js via importScripts so scope stays /).
 * App shell, JS and CSS: network-first so a normal reload can pick up a new deploy.
 * API-like requests: network only, never cached. Bump CACHE_VERSION after deploy to drop old caches.
 * CACHE_VERSION is the single manual SW/cache version source; /sw.js imports this file without its own version.
 */
const CACHE_VERSION = 1583;
const CACHE_PREFIX = 'dashboard-static-v';
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;

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
  if (p.includes('/supabase')) return true;
  if (p.includes('/data/')) return true;
  return false;
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).catch(() => undefined)
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (!request || request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (!sameOrigin(url) || isApiLikeUrl(url)) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response && response.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone()).catch(() => undefined);
      }
      return response;
    } catch {
      const cached = await caches.match(request);
      if (cached) return cached;
      throw new Error('network_unavailable');
    }
  })());
});
