import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const FIX_FILE = new URL('../frontend/src/proposal-recipient-search-row-fix.js', import.meta.url);
const CONFIG_FILE = new URL('../frontend/src/config.js', import.meta.url);
const SW_FILE = new URL('../frontend/sw.js', import.meta.url);

test('recipient layout is CSS-only and does not move or replace live search controls', async () => {
  const source = await readFile(FIX_FILE, 'utf8');
  assert.match(source, /ensureRecipientNativeFlowStyles/);
  assert.match(source, /proposal-recipient-native-flow-style/);
  assert.match(source, /data-pa-step-panel="client"/);
  assert.match(source, /data-pa-client-search-row/);
  assert.match(source, /data-pa-client-card/);
  assert.doesNotMatch(source, /appendChild|insertAdjacentElement|MutationObserver/);
  assert.doesNotMatch(source, /\.hidden\s*=|removeAttribute\(['"]hidden/);
  assert.doesNotMatch(source, /addEventListener\(['"](?:input|change|click)/);
});

test('recipient controls share one visible row without a horizontal scroll container', async () => {
  const source = await readFile(FIX_FILE, 'utf8');
  assert.match(source, /grid-template-columns:\s*max-content minmax\(360px, 430px\) !important/);
  assert.match(source, /data-pa-recipient-meta-row[\s\S]*grid-column:\s*1 !important/);
  assert.match(source, /data-pa-client-search-row\]:not\(\[hidden\]\)[\s\S]*grid-column:\s*2 !important/);
  assert.match(source, /overflow:\s*visible !important/);
  assert.doesNotMatch(source, /overflow-x:\s*auto !important/);
  assert.doesNotMatch(source, /inline-size:\s*max-content !important/);
});

test('authority and school result lists open below the original inputs', async () => {
  const source = await readFile(FIX_FILE, 'utf8');
  assert.match(source, /data-pa-client-search-field-wrap/);
  assert.match(source, /data-pa-school-search-field-wrap/);
  assert.match(source, /position:\s*relative !important/);
  assert.match(source, /data-pa-client-results/);
  assert.match(source, /data-pa-school-results/);
  assert.match(source, /position:\s*absolute !important/);
  assert.match(source, /inset-block-start:\s*calc\(100% \+ 4px\) !important/);
  assert.match(source, /z-index:\s*2000 !important/);
  assert.match(source, /overflow-y:\s*auto !important/);
});

test('native recipient flow asset and cache versions are bumped together', async () => {
  const [config, sw] = await Promise.all([
    readFile(CONFIG_FILE, 'utf8'),
    readFile(SW_FILE, 'utf8')
  ]);
  assert.match(config, /proposal-recipient-search-row-fix\.js\?v=20260801-v5/);
  assert.match(config, /proposal-recipient-native-flow-20260801-v1/);
  assert.match(sw, /const CACHE_VERSION = 1342;/);
});
