/**
 * Service worker implementation (loaded from /sw.js via importScripts so scope stays /).
 * App shell, JS and CSS: network-first so a normal reload can pick up a new deploy.
 * API-like requests: network only, never cached. Bump CACHE_VERSION after deploy to drop old caches.
 * CACHE_VERSION is the single manual SW/cache version source; /sw.js imports this file without its own version.
 */
const CACHE_VERSION = 1370;
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
  const q = url.search || '';
  if (/[?&]action=/.test(q)) return true;
  return false;
}

function isBlockedCachePath(url) {
  const p = url.pathname.toLowerCase();
  if (p.includes('/attached_assets/')) return true;
  if (p.includes('/dist/')) return true;
  if (p.includes('/tests/')) return true;
  if (p.includes('/node_modules/')) return true;
  if (p.endsWith('.md')) return true;
  if (p.endsWith('.map')) return true;
  return false;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS.map(resolveUrl)))
      .catch(() => undefined)
  );
  self.skipWaiting();
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

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!sameOrigin(url) || isApiLikeUrl(url) || isBlockedCachePath(url)) return;

  const destination = request.destination;
  const shouldHandle = request.mode === 'navigate'
    || ['script', 'style', 'image', 'font', 'manifest'].includes(destination)
    || /\.(?:js|css|png|jpe?g|gif|svg|webp|ico|woff2?|json)$/i.test(url.pathname);
  if (!shouldHandle) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(request);
      if (response?.ok) cache.put(request, response.clone()).catch(() => undefined);
      return response;
    } catch (error) {
      const cached = await cache.match(request);
      if (cached) return cached;
      if (request.mode === 'navigate') {
        const fallback = await cache.match(resolveUrl('./index.html'));
        if (fallback) return fallback;
      }
      throw error;
    }
  })());
});
