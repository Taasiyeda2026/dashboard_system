/**
 * Service worker implementation (loaded from /sw.js via importScripts so scope stays /).
 * App shell, JS and CSS: network-first so a normal reload can pick up a new deploy.
 * API-like requests: network only, never cached. Bump CACHE_VERSION after deploy to drop old caches.
 */
const CACHE_VERSION = 1034;
const CACHE_PREFIX = 'dashboard-static-v';
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;

/** Relative paths from sw.js location — works on any origin/proxy (Replit, deploy, etc). */
const PRECACHE_URLS = [
  "./assets/apple-touch-icon-DZF9rhdV.png",
  "./assets/apple-touch-icon.png",
  "./assets/catalog/27342.pdf",
  "./assets/catalog/46091.pdf",
  "./assets/catalog/52279.pdf",
  "./assets/catalog/53819.pdf",
  "./assets/catalog/53828.pdf",
  "./assets/catalog/57646.pdf",
  "./assets/catalog/57651.pdf",
  "./assets/catalog/6089.pdf",
  "./assets/catalog/67861.pdf",
  "./assets/catalog/67867.pdf",
  "./assets/catalog/9545.pdf",
  "./assets/catalog/960.pdf",
  "./assets/certificates/logos/ministry-of-education.png",
  "./assets/certificates/logos/taasiyeda1.png",
  "./assets/certificates/logos/taasiyeda2.png",
  "./assets/certificates/previews/ai.png",
  "./assets/certificates/previews/biomimicry1.png",
  "./assets/certificates/previews/biomimicry2.png",
  "./assets/certificates/previews/rokhim.png",
  "./assets/certificates/previews/sky.png",
  "./assets/certificates/previews/techspace.png",
  "./assets/certificates/templates/ai.pdf",
  "./assets/certificates/templates/biomimicry1.pdf",
  "./assets/certificates/templates/biomimicry2.pdf",
  "./assets/certificates/templates/rokhim.pdf",
  "./assets/certificates/templates/sky.pdf",
  "./assets/certificates/templates/techspace.pdf",
  "./assets/favicon-16.png",
  "./assets/favicon-32.png",
  "./assets/favicon-D0Y9bj5H.ico",
  "./assets/favicon.ico",
  "./assets/index-meJrPyio.js",
  "./assets/invitations/backgrounds/.gitkeep",
  "./assets/invitations/backgrounds/background-1.png",
  "./assets/invitations/backgrounds/background-2.png",
  "./assets/invitations/backgrounds/background-3.png",
  "./assets/invitations/backgrounds/background-4.png",
  "./assets/invitations/backgrounds/background-5.png",
  "./assets/invitations/backgrounds/background-6.png",
  "./assets/invitations/logos/.gitkeep",
  "./assets/invitations/logos/education-logo.png",
  "./assets/invitations/logos/taasiyeda-logo.png",
  "./assets/logo1-sNrSbLi9.png",
  "./assets/logo1.png",
  "./assets/logo2.png",
  "./assets/logo_system-koyfqh2I.png",
  "./assets/logo_system.png",
  "./assets/pwa/icon-128.png",
  "./assets/pwa/icon-144.png",
  "./assets/pwa/icon-152.png",
  "./assets/pwa/icon-192.png",
  "./assets/pwa/icon-384.png",
  "./assets/pwa/icon-512.png",
  "./assets/pwa/icon-72.png",
  "./assets/pwa/icon-96.png",
  "./assets/pwa/icon-maskable-512.png",
  "./assets/style-OHYM42uZ.css",
  "./catalog/appendices/27342.pdf",
  "./catalog/appendices/46091.pdf",
  "./catalog/appendices/52279.pdf",
  "./catalog/appendices/53819.pdf",
  "./catalog/appendices/53828.pdf",
  "./catalog/appendices/57646.pdf",
  "./catalog/appendices/57651.pdf",
  "./catalog/appendices/6089.pdf",
  "./catalog/appendices/67861.pdf",
  "./catalog/appendices/67867.pdf",
  "./catalog/appendices/9545.pdf",
  "./catalog/appendices/960.pdf",
  "./catalog/appendices/tour.pdf",
  "./catalog/appendices/workshop.pdf",
  "./catalog/catalog_programs_tashpaz.json",
  "./catalog/logo-catalog.png",
  "./catalog/summercatalog/activities.json",
  "./catalog/summercatalog/catalog-admin-data.json",
  "./catalog/summercatalog/catalog-data-updated-biomimicry.json",
  "./catalog/summercatalog/catalog-data.json",
  "./catalog/summercatalog/catalog-generator.html",
  "./catalog/summercatalog/course-page.html",
  "./catalog/summercatalog/image/001.png",
  "./catalog/summercatalog/image/001.webp",
  "./catalog/summercatalog/image/002.png",
  "./catalog/summercatalog/image/002.webp",
  "./catalog/summercatalog/image/003.png",
  "./catalog/summercatalog/image/003.webp",
  "./catalog/summercatalog/image/004.png",
  "./catalog/summercatalog/image/004.webp",
  "./catalog/summercatalog/image/005.png",
  "./catalog/summercatalog/image/005.webp",
  "./catalog/summercatalog/image/006.png",
  "./catalog/summercatalog/image/006.webp",
  "./catalog/summercatalog/image/007.png",
  "./catalog/summercatalog/image/007.webp",
  "./catalog/summercatalog/image/008.png",
  "./catalog/summercatalog/image/008.webp",
  "./catalog/summercatalog/image/009.png",
  "./catalog/summercatalog/image/009.webp",
  "./catalog/summercatalog/image/010.png",
  "./catalog/summercatalog/image/010.webp",
  "./catalog/summercatalog/image/011.png",
  "./catalog/summercatalog/image/011.webp",
  "./catalog/summercatalog/image/012.png",
  "./catalog/summercatalog/image/012.webp",
  "./catalog/summercatalog/image/013.png",
  "./catalog/summercatalog/image/013.webp",
  "./catalog/summercatalog/image/014.png",
  "./catalog/summercatalog/image/014.webp",
  "./catalog/summercatalog/image/015.png",
  "./catalog/summercatalog/image/015.webp",
  "./catalog/summercatalog/image/016.png",
  "./catalog/summercatalog/image/016.webp",
  "./catalog/summercatalog/image/017.png",
  "./catalog/summercatalog/image/017.webp",
  "./catalog/summercatalog/image/018.png",
  "./catalog/summercatalog/image/018.webp",
  "./catalog/summercatalog/image/019.png",
  "./catalog/summercatalog/image/019.webp",
  "./catalog/summercatalog/image/020.png",
  "./catalog/summercatalog/image/020.webp",
  "./catalog/summercatalog/image/021.png",
  "./catalog/summercatalog/image/021.webp",
  "./catalog/summercatalog/image/022.png",
  "./catalog/summercatalog/image/022.webp",
  "./catalog/summercatalog/image/023.png",
  "./catalog/summercatalog/image/023.webp",
  "./catalog/summercatalog/image/024.png",
  "./catalog/summercatalog/image/024.webp",
  "./catalog/summercatalog/image/025.png",
  "./catalog/summercatalog/image/025.webp",
  "./catalog/summercatalog/image/026.png",
  "./catalog/summercatalog/image/026.webp",
  "./catalog/summercatalog/image/027.png",
  "./catalog/summercatalog/image/027.webp",
  "./catalog/summercatalog/image/028.png",
  "./catalog/summercatalog/image/028.webp",
  "./catalog/summercatalog/image/029.png",
  "./catalog/summercatalog/image/029.webp",
  "./catalog/summercatalog/image/030.png",
  "./catalog/summercatalog/image/030.webp",
  "./catalog/summercatalog/image/031.png",
  "./catalog/summercatalog/image/031.webp",
  "./catalog/summercatalog/image/032.png",
  "./catalog/summercatalog/image/032.webp",
  "./catalog/summercatalog/image/033.png",
  "./catalog/summercatalog/image/033.webp",
  "./catalog/summercatalog/image/034.png",
  "./catalog/summercatalog/image/034.webp",
  "./catalog/summercatalog/image/035.png",
  "./catalog/summercatalog/image/035.webp",
  "./catalog/summercatalog/image/036.png",
  "./catalog/summercatalog/image/036.webp",
  "./catalog/summercatalog/image/037.png",
  "./catalog/summercatalog/image/037.webp",
  "./catalog/summercatalog/image/038.png",
  "./catalog/summercatalog/image/038.webp",
  "./catalog/summercatalog/image/039.png",
  "./catalog/summercatalog/image/039.webp",
  "./catalog/summercatalog/image/ai.png",
  "./catalog/summercatalog/image/ai.webp",
  "./catalog/summercatalog/image/course-page-tech-bg.png",
  "./catalog/summercatalog/image/course-page-tech-bg.webp",
  "./catalog/summercatalog/index.html",
  "./catalog/summercatalog/logo.png",
  "./catalog/summercatalog/opening.html",
  "./catalog/summercatalog/signature-logo.png",
  "./catalog/summercatalog/tour.html",
  "./catalog/summercatalog/workshops.html",
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
  const q = url.search || '';
  if (/[?&]action=/.test(q)) return true;
  return false;
}

function isStaticAssetUrl(url) {
  const p = url.pathname;
  if (p.endsWith('/index.html') || p === '/' || p.endsWith('.html')) return true;
  if (p.endsWith('.js') || p.endsWith('.css')) return true;
  if (p.endsWith('.png') || p.endsWith('.ico') || p.endsWith('.svg') || p.endsWith('.webp') || p.endsWith('.pdf')) return true;
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
  return response && response.ok && response.type === 'basic' && sameOrigin(new URL(response.url));
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
  if (isApiLikeUrl(url)) {
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
