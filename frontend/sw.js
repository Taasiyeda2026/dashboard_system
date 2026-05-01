/**
 * Service worker implementation (loaded from /sw.js via importScripts so scope stays /).
 * Static assets + app shell: cache-first. API-like requests: network only, never cached.
 * Bump CACHE_VERSION after deploy to drop old caches.
 */
const CACHE_VERSION = 300;
const CACHE_NAME = `dashboard-static-v${CACHE_VERSION}`;

/** Root-absolute paths on the deployed origin (same paths as index.html uses). */
const PRECACHE_URLS = [
  '/index.html',
  '/frontend/src/main.js',
  '/frontend/src/api.js',
  '/frontend/src/state.js',
  '/frontend/src/cache-persist.js',
  '/frontend/src/config.js',
  '/frontend/src/screens/dashboard.js',
  '/frontend/src/screens/activities.js',
  '/frontend/src/screens/week.js',
  '/frontend/src/screens/month.js',
  '/frontend/src/screens/operations.js',
  '/frontend/src/screens/finance.js',
  '/frontend/src/screens/exceptions.js',
  '/frontend/src/screens/instructors.js',
  '/frontend/src/screens/instructor-contacts.js',
  '/frontend/src/screens/contacts.js',
  '/frontend/src/screens/end-dates.js',
  '/frontend/src/screens/my-data.js',
  '/frontend/src/screens/edit-requests.js',
  '/frontend/src/screens/permissions.js',
  '/frontend/src/screens/login.js',
  '/frontend/src/screens/shared/html.js',
  '/frontend/src/screens/shared/format-date.js',
  '/frontend/src/screens/shared/layout.js',
  '/frontend/src/screens/shared/act-nav-grid.js',
  '/frontend/src/screens/shared/activity-detail-html.js',
  '/frontend/src/screens/shared/bind-activity-edit-form.js',
  '/frontend/src/screens/shared/holidays.js',
  '/frontend/src/screens/shared/page-list-tools.js',
  '/frontend/src/screens/shared/responsive.js',
  '/frontend/src/screens/shared/toast.js',
  '/frontend/src/screens/shared/ui-hebrew.js',
  '/frontend/src/screens/shared/interactions.js',
  '/frontend/src/screens/shared/activity-list-filters.js',
  '/frontend/src/screens/shared/activity-options.js',
  '/frontend/src/styles/main.css',
  '/frontend/public/manifest.json',
  '/frontend/assets/favicon.ico',
  '/frontend/assets/logo1.png',
  '/frontend/assets/logo2.png',
  '/frontend/assets/logo_system.png',
  '/frontend/assets/apple-touch-icon.png',
  '/frontend/assets/favicon-32.png',
  '/frontend/assets/favicon-16.png',
  '/frontend/assets/pwa/icon-192.png',
  '/frontend/assets/pwa/icon-512.png',
  '/frontend/assets/pwa/icon-maskable-512.png'
];

function workerOrigin() {
  return self.location.origin;
}

function absoluteUrl(path) {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${workerOrigin()}${p}`;
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

async function cacheFirst(request, cache) {
  const matchOpts = { ignoreSearch: true };
  let cached = await cache.match(request, matchOpts);
  if (!cached && isNavigationRequest(request)) {
    cached = await cache.match(absoluteUrl('/index.html'), matchOpts);
  }
  if (cached) return cached;

  const response = await fetch(request);
  if (
    response &&
    response.ok &&
    response.type === 'basic' &&
    sameOrigin(new URL(response.url))
  ) {
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const path of PRECACHE_URLS) {
        try {
          await cache.add(absoluteUrl(path));
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

  event.respondWith(caches.open(CACHE_NAME).then((cache) => cacheFirst(request, cache)));
});
