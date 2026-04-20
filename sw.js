/* Service worker at repository root so scope covers the whole GitHub Pages site. */
const CACHE_VERSION = 15;
const CACHE = `internal-dashboard-v${CACHE_VERSION}`;

const APP_SHELL = [
  './index.html',
  './frontend/src/styles/main.css',
  './frontend/src/main.js',
  './frontend/public/manifest.json',
  './frontend/assets/logo1.png',
  './frontend/assets/apple-touch-icon.png',
  './frontend/assets/favicon.ico',
  './frontend/assets/pwa/icon-192.png',
  './frontend/assets/pwa/icon-512.png',
  './frontend/assets/pwa/icon-maskable-512.png'
];

function sameOrigin(url) {
  return url.origin === self.location.origin;
}

function shouldHandleFetch(request, url) {
  if (request.mode === 'navigate') return true;
  const dest = request.destination;
  if (dest === 'script' || dest === 'style' || dest === 'image') return true;
  const p = url.pathname.toLowerCase();
  if (dest === 'manifest' || (p.endsWith('.json') && p.includes('manifest'))) return true;
  if (p.endsWith('index.html')) return true;
  return false;
}

async function networkFirst(request, cache) {
  try {
    const response = await fetch(request);
    if (response && response.ok && response.type === 'basic' && sameOrigin(new URL(request.url))) {
      const copy = response.clone();
      cache.put(request, copy).catch(() => {});
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const fallback = await cache.match('./index.html');
      if (fallback) return fallback;
    }
    throw new Error('offline');
  }
}

async function cacheFirst(request, cache) {
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok && response.type === 'basic' && sameOrigin(new URL(request.url))) {
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      for (const url of APP_SHELL) {
        try {
          await cache.add(url);
        } catch (e) {}
      }
      self.skipWaiting();
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!sameOrigin(url)) return;

  if (!shouldHandleFetch(request, url)) return;

  if (request.mode !== 'navigate' && url.pathname.includes('/api/')) return;

  event.respondWith(
    caches.open(CACHE).then((cache) => {
      if (request.mode === 'navigate') {
        return networkFirst(request, cache);
      }
      return cacheFirst(request, cache);
    })
  );
});
