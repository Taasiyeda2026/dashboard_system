/**
 * Attendance V2 service worker.
 * Registered with an explicit scope of "attendance/" (see src/services/sw-registration.service.js),
 * so it never controls pages outside this app. Independent cache namespace from the dashboard's sw.js.
 */
const CACHE_VERSION = 41;
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
        } catch (error) {
          console.warn('[Attendance SW] precache skip', path, error);
        }
      }
      self.skipWaiting();
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await deleteOutdatedCaches();
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!sameOrigin(url)) return;
  if (!isNavigationRequest(request) && !isCacheableAssetUrl(url)) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      try {
        const response = await fetch(new Request(request, { cache: 'no-store' }));
        if (response && response.ok && response.type === 'basic') {
          cache.put(request, response.clone()).catch(() => {});
        }
        return response;
      } catch (error) {
        const cached = (await cache.match(request)) || (isNavigationRequest(request) ? await cache.match(resolveUrl('./index.html')) : undefined);
        if (cached) return cached;
        throw error;
      }
    })
  );
});
