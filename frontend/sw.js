/**
 * Service worker implementation (loaded from /sw.js via importScripts so scope stays /).
 * App shell, JS and CSS: network-first so a normal reload can pick up a new deploy.
 * API-like requests: network only, never cached. Bump CACHE_VERSION after deploy to drop old caches.
 * CACHE_VERSION is the single manual SW/cache version source; /sw.js imports this file without its own version.
 */
const CACHE_VERSION = 1488;
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

function withNoStore(request) {
  return new Request(request, { cache: 'no-store' });
}

async function refreshPrecache(request) {
  const url = request instanceof Request ? request.url : resolveUrl(request);
  const freshRequest = new Request(url, { cache: 'reload' });
  const response = await fetch(freshRequest);
  if (shouldStoreResponse(response)) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(freshRequest, response.clone());
  }
  return response;
}

async function networkFirst(request) {
  try {
    const freshRequest = withNoStore(request);
    const response = await fetch(freshRequest);
    if (shouldStoreResponse(response)) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    await Promise.all(PRECACHE_URLS.map((url) => refreshPrecache(url).catch(() => null)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await deleteOutdatedCaches();
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (!sameOrigin(url)) return;

  if (isApiLikeUrl(url) || isBlockedCachePath(url)) {
    event.respondWith(fetch(request));
    return;
  }

  if (isNavigationRequest(request) || isStaticAssetUrl(url) || isManifestUrl(url)) {
    event.respondWith(networkFirst(request));
  }
});
