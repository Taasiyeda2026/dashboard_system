/**
 * Service worker implementation (loaded from /sw.js via importScripts so scope stays /).
 * App shell, JS and CSS: network-first so a normal reload can pick up a new deploy.
 * API-like requests: network only, never cached. Bump CACHE_VERSION after deploy to drop old caches.
 * CACHE_VERSION is the single manual SW/cache version source; /sw.js imports this file without its own version.
 */
const CACHE_VERSION = 1412;
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
