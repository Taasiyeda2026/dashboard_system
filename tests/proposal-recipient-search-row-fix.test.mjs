import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const FIX_FILE = new URL('../frontend/src/proposal-recipient-search-row-fix.js', import.meta.url);
const CONFIG_FILE = new URL('../frontend/src/config.js', import.meta.url);
const SW_FILE = new URL('../frontend/sw.js', import.meta.url);

test('recipient row uses one compact grid without a horizontal scroll container', async () => {
  const source = await readFile(FIX_FILE, 'utf8');
  assert.match(source, /ensureRecipientLayoutStyles/);
  assert.match(source, /grid-template-columns:\s*150px 100px 250px auto !important/);
  assert.match(source, /data-pa-recipient-flow-slot/);
  assert.match(source, /ensureFlowSlot/);
  assert.match(source, /moveIntoSlot\(slot, searchWrap\)/);
  assert.match(source, /moveIntoSlot\(slot, clientCard\)/);
  assert.match(source, /overflow:\s*visible !important/);
  assert.doesNotMatch(source, /overflow-x:\s*auto !important/);
  assert.doesNotMatch(source, /inline-size:\s*max-content !important;[\s\S]*data-pa-recipient-meta-row/);
});

test('authority and school result lists open as overlays below their fields', async () => {
  const source = await readFile(FIX_FILE, 'utf8');
  assert.match(source, /data-pa-client-search-field-wrap[\s\S]*position:\s*relative !important/);
  assert.match(source, /data-pa-client-results/);
  assert.match(source, /data-pa-school-results/);
  assert.match(source, /position:\s*absolute !important/);
  assert.match(source, /inset-block-start:\s*calc\(100% \+ 4px\) !important/);
  assert.match(source, /z-index:\s*1000 !important/);
  assert.match(source, /overflow-x:\s*hidden !important/);
  assert.match(source, /overflow-y:\s*auto !important/);
});

test('contact section stays hidden until the selected recipient is complete', async () => {
  const source = await readFile(FIX_FILE, 'utf8');
  assert.match(source, /function recipientSelectionReady/);
  assert.match(source, /type === 'authority'[\s\S]*Boolean\(authorityId\)/);
  assert.match(source, /type === 'other'[\s\S]*Boolean\(otherName\)/);
  assert.match(source, /Boolean\(authorityId && schoolId\)/);
  assert.match(source, /contactPanel\.hidden = !ready/);
});

test('recipient dropdown asset and cache versions are bumped together', async () => {
  const [config, sw] = await Promise.all([
    readFile(CONFIG_FILE, 'utf8'),
    readFile(SW_FILE, 'utf8')
  ]);
  assert.match(config, /proposal-recipient-search-row-fix\.js\?v=20260801-v4/);
  assert.match(config, /proposal-recipient-dropdown-overflow-20260801-v1/);
  assert.match(sw, /const CACHE_VERSION = 1341;/);
});
