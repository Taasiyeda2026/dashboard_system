/* Service worker at repository root so scope covers the whole GitHub Pages site. */
const CACHE_VERSION = 214;
const CACHE = `internal-dashboard-v${CACHE_VERSION}`;

const APP_SHELL = [
  './index.html',
  './frontend/src/main.js',
  './frontend/src/api.js',
  './frontend/src/state.js',
  './frontend/src/cache-persist.js',
  './frontend/src/config.js',
  './frontend/src/screens/dashboard.js',
  './frontend/src/screens/activities.js',
  './frontend/src/screens/week.js',
  './frontend/src/screens/month.js',
  './frontend/src/screens/operations.js',
  './frontend/src/screens/finance.js',
  './frontend/src/screens/exceptions.js',
  './frontend/src/screens/instructors.js',
  './frontend/src/screens/instructor-contacts.js',
  './frontend/src/screens/contacts.js',
  './frontend/src/screens/end-dates.js',
  './frontend/src/screens/my-data.js',
  './frontend/src/screens/edit-requests.js',
  './frontend/src/screens/permissions.js',
  './frontend/src/screens/login.js',
  './frontend/src/screens/shared/html.js',
  './frontend/src/screens/shared/format-date.js',
  './frontend/src/screens/shared/layout.js',
  './frontend/src/screens/shared/act-nav-grid.js',
  './frontend/src/screens/shared/activity-detail-html.js',
  './frontend/src/screens/shared/bind-activity-edit-form.js',
  './frontend/src/screens/shared/holidays.js',
  './frontend/src/screens/shared/page-list-tools.js',
  './frontend/src/screens/shared/responsive.js',
  './frontend/src/screens/shared/toast.js',
  './frontend/src/screens/shared/ui-hebrew.js',
  './frontend/src/screens/shared/interactions.js',
  './frontend/src/screens/shared/activity-list-filters.js',
  './frontend/src/styles/main.css',
  './frontend/public/manifest.json',
  './frontend/assets/logo1.png',
  './frontend/assets/logo2.png',
  './frontend/assets/apple-touch-icon.png',
  './frontend/assets/favicon-32.png',
  './frontend/assets/favicon-16.png',
  './frontend/assets/pwa/icon-192.png',
  './frontend/assets/pwa/icon-512.png',
  './frontend/assets/pwa/icon-maskable-512.png'
];

function sameOrigin(url) {
  return url.origin === self.location.origin;
}

function shouldHandleFetch(request, url) {
  if (request.mode === 'navigate') return true;
  const p = url.pathname;
  if (p.endsWith('.js') || p.endsWith('.css')) return true;
  if (p.endsWith('.png') || p.endsWith('.ico') || p.endsWith('.svg')) return true;
  if (p.endsWith('.json') && p.includes('manifest')) return true;
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

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      for (const url of APP_SHELL) {
        try {
          await cache.add(url);
        } catch (e) {
          console.warn('[SW] precache skip', url, e);
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

  event.respondWith(
    caches.open(CACHE).then((cache) => networkFirst(request, cache))
  );
});
