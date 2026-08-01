import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const FIX_FILE = new URL('../frontend/src/proposal-recipient-search-row-fix.js', import.meta.url);
const CONFIG_FILE = new URL('../frontend/src/config.js', import.meta.url);
const SW_FILE = new URL('../frontend/sw.js', import.meta.url);

test('recipient flow uses one outer box and keeps every selection stage in the metadata row', async () => {
  const source = await readFile(FIX_FILE, 'utf8');
  assert.match(source, /ensureRecipientSingleBoxStyles/);
  assert.match(source, /proposal-recipient-single-box-style/);
  assert.match(source, /data-pa-recipient-meta-row/);
  assert.match(source, /data-pa-client-search-row/);
  assert.match(source, /row\.appendChild\(searchBlock\)/);
  assert.match(source, /row\.appendChild\(clientCard\)/);
  assert.match(source, /flex-flow:\s*row nowrap/);
  assert.match(source, /ds-pa-school-step-text/);
  assert.match(source, /changeAuthorityButton\.textContent = 'שינוי'/);
  assert.match(source, /ds-pa-client-locked-type[\s\S]*display:\s*none !important/);
  assert.match(source, /border:\s*0 !important/);
  assert.match(source, /background:\s*transparent !important/);
  assert.match(source, /box-shadow:\s*none !important/);
});

test('contact section stays hidden until the selected recipient type is complete', async () => {
  const source = await readFile(FIX_FILE, 'utf8');
  assert.match(source, /function recipientSelectionReady/);
  assert.match(source, /type === 'authority'[\s\S]*Boolean\(authorityId\)/);
  assert.match(source, /type === 'other'[\s\S]*Boolean\(authorityId && otherName\)/);
  assert.match(source, /Boolean\(authorityId && schoolId\)/);
  assert.match(source, /data-pa-step-panel=\\?"contact\\?"\]\[hidden\][\s\S]*display:\s*none !important/);
  assert.match(source, /contactPanel\.hidden = !ready/);
});

test('recipient flow asset and cache versions are bumped together', async () => {
  const [config, sw] = await Promise.all([
    readFile(CONFIG_FILE, 'utf8'),
    readFile(SW_FILE, 'utf8')
  ]);
  assert.match(config, /proposal-recipient-search-row-fix\.js\?v=20260801-v2/);
  assert.match(config, /proposal-recipient-single-box-flow-20260801-v1/);
  assert.match(sw, /const CACHE_VERSION = 1338;/);
});
