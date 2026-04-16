// ============================================================
// sw.js — Service Worker (PWA caching)
// ============================================================

const CACHE_NAME = "taasiyeda-v1";

const PRECACHE = [
  "/",
  "/index.html",
  "/manifest.json",
  "/frontend/styles/main.css",
  "/frontend/app.js",
  "/frontend/config/config.js",
  "/frontend/api/api.js",
  "/frontend/shared/toast.js",
  "/frontend/shared/utils.js",
  "/frontend/shared/filters.js",
  "/frontend/components/activity-drawer.js",
  "/frontend/screens/dashboard.js",
  "/frontend/screens/activities.js",
  "/frontend/screens/week.js",
  "/frontend/screens/month.js",
  "/frontend/screens/instructors.js",
  "/frontend/screens/exceptions.js",
  "/frontend/screens/my-data.js",
  "/frontend/screens/contacts.js",
  "/frontend/screens/finance.js",
  "/frontend/screens/permissions.js",
];

// ── Install: precache app shell ──────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

// ── Activate: remove old caches ──────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch: cache-first for app shell, network-first for API ──
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // API calls — always network, no cache
  if (url.hostname.includes("script.google.com")) {
    return; // let it pass through
  }

  // App shell — cache first, fallback to network
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok && event.request.method === "GET") {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
