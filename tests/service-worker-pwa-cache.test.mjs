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
  assert.ok(Number(cacheVersion[1]) > 1329, 'cache version should be bumped past the previous v1329 cache');
  assert.match(rootSw, /importScripts\(new URL\('frontend\/sw\.js', self\.location\)\.href\);/, 'root SW should import the central implementation directly');
});

test('service worker removes old dashboard caches during activate without interrupting open tabs', async () => {
  const frontendSw = await read(FRONTEND_SW_FILE);
  const installStart = frontendSw.indexOf("self.addEventListener('install'");
  const activateStart = frontendSw.indexOf("self.addEventListener('activate'");
  const installBlock = installStart >= 0 && activateStart > installStart
    ? frontendSw.slice(installStart, activateStart)
    : '';

  assert.ok(installBlock, 'service worker should define install before activate');
  assert.match(frontendSw, /const CACHE_PREFIX = 'dashboard-static-v';/);
  assert.match(frontendSw, /key\.startsWith\(CACHE_PREFIX\) && key !== CACHE_NAME/, 'cleanup should target old dashboard cache versions');
  assert.doesNotMatch(installBlock, /deleteOutdatedCaches/, 'install must not delete outdated caches before activate');
  assert.match(frontendSw, /self\.addEventListener\('activate'[\s\S]*await deleteOutdatedCaches\(\);[\s\S]*await self\.clients\.claim\(\);/, 'activate should clean old caches and claim clients silently');
  assert.doesNotMatch(frontendSw, /reloadClientsAfterCacheUpgrade/, 'service worker must not keep a forced client reload helper');
  assert.doesNotMatch(frontendSw, /client\.navigate\(/, 'service worker must not navigate or reload open dashboard tabs');
  assert.doesNotMatch(frontendSw, /SW_UPDATED/, 'service worker should not display an update message or request a manual refresh');
});

test('service worker fetches app shell and manifest fresh after deploy', async () => {
  const frontendSw = await read(FRONTEND_SW_FILE);

  assert.match(frontendSw, /new Request\(url, \{ cache: 'reload' \}\)/, 'precache should bypass the browser HTTP cache');
  assert.match(frontendSw, /new Request\(request, \{ cache: 'no-store' \}\)/, 'network-first requests should bypass stale browser cache');
  assert.match(frontendSw, /\|\| isManifestUrl\(url\)/, 'manifest should use the network-first path');
  assert.match(frontendSw, /if \(isApiLikeUrl\(url\) \|\| isBlockedCachePath\(url\)\) \{[\s\S]*event\.respondWith\(fetch\(request\)\)/, 'API-like and blocked requests should remain network-only');
  assert.doesNotMatch(frontendSw, /ignoreSearch\s*:\s*true/, 'cache-busting query strings must remain part of the cache key');
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
