const CACHE_NAME = "summer-catalog-v2026-06-02-v100";
const ASSETS = [
  "./",
  "./index.html",
  "./activities.json",
  "./logo.png",
  "./image/001.png",
  "./image/002.png",
  "./image/003.png",
  "./image/004.png",
  "./image/005.png",
  "./image/006.png",
  "./image/007.png",
  "./image/008.png",
  "./image/009.png",
  "./image/009%20(2).png",
  "./image/010.png",
  "./image/011.png",
  "./image/012.png",
  "./image/013.png",
  "./image/014.png",
  "./image/015.png",
  "./image/016.png",
  "./image/017.png",
  "./image/018.png",
  "./image/019.png",
  "./image/020.png",
  "./image/021.png",
  "./image/022.png",
  "./image/023.png",
  "./image/024.png",
  "./image/025.png",
  "./image/026.png",
  "./image/027.png",
  "./image/028.png",
  "./image/029.png",
  "./image/030.png",
  "./image/031.png",
  "./image/032.png",
  "./image/033.png",
  "./image/034.png",
  "./image/035.png",
  "./image/036.png",
  "./image/037.png",
  "./image/038.png",
  "./image/039.png",
  "./image/26.png",
  "./image/ai.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate" || url.pathname.endsWith("/index.html") || url.pathname === "/") {
    event.respondWith(
      fetch(event.request, { cache: "no-store" }).then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        return response;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  if (url.pathname.endsWith("/activities.json")) {
    event.respondWith(fetch(event.request, { cache: "no-store" }).catch(() => caches.match(event.request)));
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        return response;
      });
    })
  );
});
