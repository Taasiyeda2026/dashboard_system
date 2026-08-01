import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const FIX_FILE = new URL('../frontend/src/proposal-recipient-search-row-fix.js', import.meta.url);
const CSS_FILE = new URL('../frontend/src/styles/proposal-editor-compact-fixes.css', import.meta.url);
const SCREEN_FILE = new URL('../frontend/src/screens/proposals-agreements.js', import.meta.url);
const CONFIG_FILE = new URL('../frontend/src/config.js', import.meta.url);
const SW_FILE = new URL('../frontend/sw.js', import.meta.url);

test('legacy recipient layout injector is neutralized and does not rearrange the DOM', async () => {
  const source = await readFile(FIX_FILE, 'utf8');
  assert.match(source, /ensureRecipientFinalLayoutStyles/);
  assert.match(source, /Retired layout injector/);
  assert.doesNotMatch(source, /appendChild|insertAdjacentElement|MutationObserver/);
  assert.doesNotMatch(source, /style\.setProperty/);
  assert.doesNotMatch(source, /addEventListener\(['"](?:input|change|click)/);
  assert.doesNotMatch(source, /grid-template-columns:\s*180px 130px 288px/);
});

test('single CSS source lays out date, domain, type and recipient flow in one row', async () => {
  const css = await readFile(CSS_FILE, 'utf8');
  assert.match(css, /\[data-pa-recipient-meta-row\]/);
  assert.match(css, /flex-flow:\s*row wrap/);
  assert.match(css, /--pa-recipient-control-height:\s*42px/);
  assert.match(css, /border:\s*1px solid var\(--pa-recipient-border\)/);
  assert.match(css, /border-radius:\s*10px/);
  assert.match(css, /grid-template-columns:\s*repeat\(3, var\(--pa-choice-width\)\)/);
  assert.match(css, /\[data-pa-step-panel="client"\]:not\(\[hidden\]\)/);
  assert.match(css, /display:\s*contents !important/);
  assert.doesNotMatch(css, /overflow-x:\s*auto !important/);
});

test('formHtml keeps one recipient-type label and compact locked recipient details', async () => {
  const screen = await readFile(SCREEN_FILE, 'utf8');
  assert.match(screen, /ds-pa-recipient-type-label">סוג נמען</);
  assert.doesNotMatch(screen, /ds-pa-client-locked-type/);
  assert.match(screen, /data-pa-unlock-client>החלף</);
  assert.match(screen, /data-pa-change-authority-step>החלף</);
  assert.match(screen, /data-pa-client-search-label>רשות</);
  assert.doesNotMatch(screen, /<h5>פרטי הלקוח<\/h5>/);
});

test('authority and school result lists remain attached to native inputs in CSS', async () => {
  const css = await readFile(CSS_FILE, 'utf8');
  assert.match(css, /data-pa-client-search-field-wrap/);
  assert.match(css, /data-pa-school-search-field-wrap/);
  assert.match(css, /position:\s*relative !important/);
  assert.match(css, /data-pa-client-results/);
  assert.match(css, /data-pa-school-results/);
  assert.match(css, /position:\s*absolute !important/);
  assert.match(css, /z-index:\s*2000 !important/);
});

test('final recipient asset and cache versions are bumped together', async () => {
  const [config, sw] = await Promise.all([
    readFile(CONFIG_FILE, 'utf8'),
    readFile(SW_FILE, 'utf8')
  ]);
  assert.match(config, /proposal-recipient-search-row-fix\.js\?v=20260801-v7/);
  assert.match(config, /proposal-recipient-single-source-20260801-v2/);
  assert.match(sw, /const CACHE_VERSION = 1346;/);
});
