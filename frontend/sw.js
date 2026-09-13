/*
 * PWA static/API cache owner.
 * API-like requests: network only, never cached. Bump CACHE_VERSION after deploy to drop old caches.
 * CACHE_VERSION is the single manual SW/cache version source; /sw.js imports this file without its own version.
 */
const CACHE_VERSION = 1706;
const CACHE_PREFIX = 'dashboard-static-v';
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;
