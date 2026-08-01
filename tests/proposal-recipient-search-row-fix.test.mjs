import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const FIX_FILE = new URL('../frontend/src/proposal-recipient-search-row-fix.js', import.meta.url);
const CONFIG_FILE = new URL('../frontend/src/config.js', import.meta.url);
const SW_FILE = new URL('../frontend/sw.js', import.meta.url);

test('recipient search is moved into the same metadata row as date, domain and recipient type', async () => {
  const source = await readFile(FIX_FILE, 'utf8');
  assert.match(source, /data-pa-recipient-meta-row/);
  assert.match(source, /data-pa-client-search-row/);
  assert.match(source, /row\.appendChild\(searchBlock\)/);
  assert.match(source, /grid-template-columns', '160px 120px max-content 300px'/);
  assert.match(source, /searchBlock\.style\.setProperty\('grid-column', '4'/);
  assert.match(source, /searchBlock\.style\.setProperty\('grid-row', '1'/);
});

test('recipient row fix is loaded and cache versions are bumped together', async () => {
  const [config, sw] = await Promise.all([
    readFile(CONFIG_FILE, 'utf8'),
    readFile(SW_FILE, 'utf8')
  ]);
  assert.match(config, /import '\.\/proposal-recipient-search-row-fix\.js'/);
  assert.match(config, /proposal-recipient-search-same-row-20260801-v1/);
  assert.match(sw, /const CACHE_VERSION = 1337;/);
});
