import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const SW_FILE = new URL('../frontend/sw.js', import.meta.url);
const CONFIG_FILE = new URL('../frontend/src/config.js', import.meta.url);

test('service worker and client-file hotfix versions are current and structurally valid', async () => {
  const [sw, config] = await Promise.all([
    readFile(SW_FILE, 'utf8'),
    readFile(CONFIG_FILE, 'utf8')
  ]);

  const cacheVersion = Number(sw.match(/const CACHE_VERSION = (\d+);/)?.[1] || 0);
  assert.ok(Number.isInteger(cacheVersion) && cacheVersion >= 1245, 'CACHE_VERSION must remain at the current generation or newer');

  const hotfixVersion = config.match(/HOTFIX_VERSION:\s*'([^']+)'/)?.[1] || '';
  assert.ok(hotfixVersion.trim(), 'HOTFIX_VERSION must be defined');
  assert.match(hotfixVersion, /proposal-pdf-tainted-canvas/, 'HOTFIX_VERSION must describe the current PDF fix generation');

  const installBlock = sw.match(/self\.addEventListener\('install',[\s\S]*?\n\}\);/)?.[0] || '';
  assert.doesNotMatch(installBlock, /deleteOutdatedCaches\(/);
  assert.match(sw, /self\.addEventListener\('activate'[\s\S]*deleteOutdatedCaches\(/);
  assert.match(sw, /clients\.claim/);
  assert.match(sw, /isApiLikeUrl/);
});
