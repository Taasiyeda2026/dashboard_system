/**
 * Attendance V2 service worker.
 * Registered with an explicit scope of "attendance/" (see src/services/sw-registration.service.js),
 * so it never controls pages outside this app. Independent cache namespace from the dashboard's sw.js.
 */
const CACHE_VERSION = 71;
const CACHE_PREFIX = 'attendance-static-v';
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;

const PRECACHE_URLS = ['./index.html'];

function resolveUrl(path) {
  return new URL(path, self.location.href).href;
}

function sameOrigin(url) {
  return url.origin === self.location.origin;
}

function isNavigationRequest(request) {
  return request.mode === 'navigate' || (request.destination && request.destination === 'document');
}

function isCacheableAssetUrl(url) {
  return /\.(?:js|css|png|svg|webp|ico|woff2?|json)$/i.test(url.pathname);
}

async function deleteOutdatedCaches() {
  const keys = await caches.keys();
  const outdated = keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME);
  await Promise.all(outdated.map((key) => caches.delete(key)));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const path of PRECACHE_URLS) {
        try {
          const response = await fetch(new Request(resolveUrl(path), { cache: 'reload' }));
          if (response.ok) await cache.put(resolveUrl(path), response.clone());
        } catch (err) {
          console.warn('[attendance-sw] precache failed:', path, err);
        }
      }
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(deleteOutdatedCaches().then(() => self.clients.claim()));
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!sameOrigin(url)) return;

  if (isNavigationRequest(request)) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { cache: 'no-store' });
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(resolveUrl('./index.html'), response.clone());
        }
        return response;
      } catch {
        const cached = await caches.match(resolveUrl('./index.html'));
        return cached || Response.error();
      }
    })());
    return;
  }

  if (!isCacheableAssetUrl(url)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;

    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  })());
});
