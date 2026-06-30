import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ROOT_SW_FILE = join(ROOT, 'sw.js');
const FRONTEND_SW_FILE = join(ROOT, 'frontend', 'sw.js');
const MANIFEST_FILE = join(ROOT, 'frontend', 'public', 'manifest.json');
const CATALOG_DIR = join(ROOT, 'frontend', 'public', 'catalog');

async function read(path) {
  return readFile(path, 'utf8');
}

async function collectCatalogPages(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'appendices') continue;
      files.push(...await collectCatalogPages(fullPath));
      continue;
    }
    if (/\.(?:html|js)$/i.test(entry.name)) files.push(fullPath);
  }

  return files;
}

test('service worker entry imports the implementation without a second manual version', async () => {
  const rootSw = await read(ROOT_SW_FILE);
  const frontendSw = await read(FRONTEND_SW_FILE);
  const cacheVersion = frontendSw.match(/const CACHE_VERSION = (\d+);/);

  assert.doesNotMatch(rootSw, /SW_ENTRY_VERSION/, 'root service worker should not require a second manual version');
  assert.ok(cacheVersion, 'frontend service worker should expose a cache version');
  assert.ok(Number(cacheVersion[1]) >= 355, 'cache version should be bumped past the previous v354 cache');
  assert.match(rootSw, /importScripts\(new URL\('frontend\/sw\.js', self\.location\)\.href\);/, 'root SW should import the central implementation directly');
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
  assert.match(frontendSw, /if \(isApiLikeUrl\(url\) \|\| isBlockedCachePath\(url\)\) \{[\s\S]*event\.respondWith\(fetch\(request\)\)/, 'API-like and blocked requests should remain network-only');
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


test('PWA guardrails keep cache versioning and catalog registration centralized', async () => {
  const rootSw = await read(ROOT_SW_FILE);
  const frontendSw = await read(FRONTEND_SW_FILE);
  const cacheVersionMatches = [...frontendSw.matchAll(/\bCACHE_VERSION\b/g)];

  assert.doesNotMatch(rootSw, /SW_ENTRY_VERSION/, 'root SW entry must not define SW_ENTRY_VERSION');
  assert.doesNotMatch(rootSw, /\bCACHE_VERSION\b\s*=/, 'root SW entry must not define a separate cache version');
  assert.equal([...frontendSw.matchAll(/const CACHE_VERSION\s*=\s*\d+;/g)].length, 1, 'frontend SW should define exactly one manual CACHE_VERSION constant');
  assert.ok(cacheVersionMatches.length >= 1, 'frontend SW should remain the manual cache version source');

  const catalogPages = await collectCatalogPages(CATALOG_DIR);
  assert.ok(catalogPages.length > 0, 'catalog page guardrail should inspect catalog HTML/JS files');
  for (const file of catalogPages) {
    const source = await read(file);
    assert.doesNotMatch(source, /register\(["']\.\/sw\.js\?v=210["']\)/, `${file} must not restore local catalog SW registration`);
  }
});

test('PWA guardrails prevent wholesale catalog and bulky-file precache', async () => {
  const frontendSw = await read(FRONTEND_SW_FILE);
  const precacheMatch = frontendSw.match(/const PRECACHE_URLS = \[([\s\S]*?)\];/);
  assert.ok(precacheMatch, 'frontend SW should declare an explicit PRECACHE_URLS list');

  const precacheBlock = precacheMatch[1];
  assert.doesNotMatch(precacheBlock, /catalog\/?["'`]/i, 'catalog should not be added wholesale to precache');
  assert.doesNotMatch(precacheBlock, /\.(?:pdf|csv|xlsx)(?:["'`?#]|$)/i, 'PDF/CSV/XLSX files should not be precached');
  assert.doesNotMatch(precacheBlock, /(?:attached_assets|dist|tests|docs\/prompts|archive|mock|debug)/i, 'bulky/generated/test/archive paths should not be precached');

  assert.match(frontendSw, /pdf\|csv\|xlsx/, 'SW should explicitly block PDF/CSV/XLSX cache writes');
  for (const blockedPath of [
    '/attached_assets/',
    '/dist/',
    '/tests/',
    '/docs/prompts/',
    '/archive',
    '/mock',
    '/debug'
  ]) {
    assert.match(frontendSw, new RegExp(blockedPath.replace(/[\/]/g, '\\/')), `SW should block cache writes for ${blockedPath}`);
  }
});
