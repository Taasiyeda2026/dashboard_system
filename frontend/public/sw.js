const CACHE_NAME = 'new-system-v1';
const ASSETS = [
  './',
  './index.html',
  './src/main.js',
  './src/styles/main.css'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('fetch', (event) => {
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
