import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ROOT_SW_FILE = join(ROOT, 'sw.js');
const FRONTEND_SW_FILE = join(ROOT, 'frontend', 'sw.js');
const MANIFEST_FILE = join(ROOT, 'frontend', 'public', 'manifest.json');

async function read(path) {
  return readFile(path, 'utf8');
}

test('service worker entry and implementation use the same bumped cache version', async () => {
  const rootSw = await read(ROOT_SW_FILE);
  const frontendSw = await read(FRONTEND_SW_FILE);
  const entryVersion = rootSw.match(/const SW_ENTRY_VERSION = (\d+);/);
  const cacheVersion = frontendSw.match(/const CACHE_VERSION = (\d+);/);

  assert.ok(entryVersion, 'root service worker should expose an entry version');
  assert.ok(cacheVersion, 'frontend service worker should expose a cache version');
  assert.equal(entryVersion[1], cacheVersion[1], 'entry import query should bust to the same SW version as the cache');
  assert.ok(Number(cacheVersion[1]) >= 355, 'cache version should be bumped past the previous v354 cache');
  assert.match(rootSw, /frontend\/sw\.js\?v=\$\{SW_ENTRY_VERSION\}/, 'root SW import should include a version query');
});

test('service worker removes old dashboard caches during install and activate', async () => {
  const frontendSw = await read(FRONTEND_SW_FILE);

  assert.match(frontendSw, /const CACHE_PREFIX = 'dashboard-static-v';/);
  assert.match(frontendSw, /key\.startsWith\(CACHE_PREFIX\) && key !== CACHE_NAME/, 'cleanup should target old dashboard cache versions');
  assert.match(frontendSw, /await deleteOutdatedCaches\(\);[\s\S]*self\.skipWaiting\(\);/, 'install should clean old caches before taking control');
  assert.match(frontendSw, /deleteOutdatedCaches\(\)\.then\(async \(deletedKeys\) => \{[\s\S]*await self\.clients\.claim\(\);[\s\S]*await reloadClientsAfterCacheUpgrade\(deletedKeys\);/, 'activate should clean old caches, claim clients, and reload windows after a cache upgrade');
});

test('service worker reloads open dashboard windows after deleting old cache versions', async () => {
  const frontendSw = await read(FRONTEND_SW_FILE);

  assert.match(frontendSw, /return outdatedKeys;/, 'cache cleanup should report deleted old cache names');
  assert.match(frontendSw, /async function reloadClientsAfterCacheUpgrade\(deletedKeys\)/, 'service worker should define forced client reload after cache upgrade');
  assert.match(frontendSw, /self\.clients\.matchAll\(\{ type: 'window', includeUncontrolled: true \}\)/, 'reload should include currently open dashboard windows');
  assert.match(frontendSw, /client\.navigate\(client\.url\)/, 'open clients should be navigated to fetch the fresh app shell and assets');
});

test('service worker fetches app shell and manifest fresh after deploy', async () => {
  const frontendSw = await read(FRONTEND_SW_FILE);

  assert.match(frontendSw, /new Request\(url, \{ cache: 'reload' \}\)/, 'precache should bypass the browser HTTP cache');
  assert.match(frontendSw, /new Request\(request, \{ cache: 'no-store' \}\)/, 'network-first requests should bypass stale browser cache');
  assert.match(frontendSw, /\|\| isManifestUrl\(url\)/, 'manifest should use the network-first path');
  assert.match(frontendSw, /if \(isApiLikeUrl\(url\)\) \{[\s\S]*event\.respondWith\(fetch\(request\)\)/, 'API-like requests should remain network-only');
});

test('PWA manifest and icon files still point to existing dashboard assets', async () => {
  const manifest = JSON.parse(await read(MANIFEST_FILE));

  assert.equal(manifest.name, 'Dashboard-Taasiyeda');
  assert.equal(manifest.display, 'standalone');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 4, 'manifest should include dashboard PWA icons');

  for (const icon of manifest.icons) {
    assert.ok(icon.src, 'manifest icon should have a src');
    const rel = icon.src.replace(/^\/dashboard_system\//, 'frontend/');
    assert.ok(existsSync(join(ROOT, rel)), `missing PWA icon asset: ${icon.src}`);
  }
});
