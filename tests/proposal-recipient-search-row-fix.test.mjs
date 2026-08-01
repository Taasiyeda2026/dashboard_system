import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const FIX_FILE = new URL('../frontend/src/proposal-recipient-search-row-fix.js', import.meta.url);
const CONFIG_FILE = new URL('../frontend/src/config.js', import.meta.url);
const SW_FILE = new URL('../frontend/sw.js', import.meta.url);

test('recipient layout keeps date, domain, type and recipient flow in one row', async () => {
  const source = await readFile(FIX_FILE, 'utf8');
  assert.match(source, /ensureRecipientFinalLayoutStyles/);
  assert.match(source, /grid-template-columns:\s*180px 130px 288px minmax\(360px, 430px\)/);
  assert.match(source, /data-pa-recipient-meta-row[\s\S]*display:\s*contents/);
  assert.match(source, /ds-pa-client-search[\s\S]*grid-column:\s*4/);
  assert.match(source, /inline-size:\s*100% !important/);
  assert.doesNotMatch(source, /overflow-x:\s*auto !important/);
});

test('duplicate recipient label is hidden and all controls share one frame height', async () => {
  const source = await readFile(FIX_FILE, 'utf8');
  assert.match(source, /ds-pa-client-search-block > \.ds-pa-recipient-type-field:not\(:has\(\.ds-pa-recipient-type\)\)/);
  assert.match(source, /proposal-recipient-control-height:\s*42px/);
  assert.match(source, /border:\s*1px solid var\(--pa-recipient-border\)/);
  assert.match(source, /border-radius:\s*10px/);
  assert.match(source, /grid-template-columns:\s*repeat\(3, 92px\)/);
});

test('choosing an authority replaces the search with selected authority and mini replace button', async () => {
  const source = await readFile(FIX_FILE, 'utf8');
  assert.match(source, /data-pa-school-search-panel\]:not\(\[hidden\]\)/);
  assert.match(source, /grid-template-columns:\s*150px 270px/);
  assert.match(source, /ds-pa-school-step-text[\s\S]*grid-template-columns:\s*90px 54px/);
  assert.match(source, /data-pa-change-authority-step[\s\S]*inline-size:\s*54px/);
  assert.match(source, /content:\s*'החלף'/);
  assert.match(source, /data-pa-school-search-input/);
});

test('authority and school result lists remain attached to native inputs', async () => {
  const source = await readFile(FIX_FILE, 'utf8');
  assert.match(source, /data-pa-client-search-field-wrap/);
  assert.match(source, /data-pa-school-search-field-wrap/);
  assert.match(source, /position:\s*relative !important/);
  assert.match(source, /data-pa-client-results/);
  assert.match(source, /data-pa-school-results/);
  assert.match(source, /position:\s*absolute !important/);
  assert.match(source, /z-index:\s*2000 !important/);
  assert.doesNotMatch(source, /appendChild|insertAdjacentElement|MutationObserver/);
  assert.doesNotMatch(source, /addEventListener\(['"](?:input|change|click)/);
});

test('final recipient asset and cache versions are bumped together', async () => {
  const [config, sw] = await Promise.all([
    readFile(CONFIG_FILE, 'utf8'),
    readFile(SW_FILE, 'utf8')
  ]);
  assert.match(config, /proposal-recipient-search-row-fix\.js\?v=20260801-v6/);
  assert.match(config, /proposal-recipient-final-ui-20260801-v1/);
  assert.match(config, /performance-continuation-20260801-v1/);
  assert.match(sw, /const CACHE_VERSION = 1344;/);
});
