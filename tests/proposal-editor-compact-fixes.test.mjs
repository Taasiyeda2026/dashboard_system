import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const INDEX_FILE = new URL('../index.html', import.meta.url);
const CSS_FILE = new URL('../frontend/src/styles/proposal-editor-compact-fixes.css', import.meta.url);
const RUNTIME_FILE = new URL('../frontend/src/proposal-editor-compact-fixes.js', import.meta.url);
const CONFIG_FILE = new URL('../frontend/src/config.js', import.meta.url);
const SW_FILE = new URL('../frontend/sw.js', import.meta.url);

test('proposal editor compact assets are loaded after the shared dashboard styles', async () => {
  const html = await readFile(INDEX_FILE, 'utf8');
  const mainStyle = html.indexOf('./frontend/src/styles/main.css');
  const compactStyle = html.indexOf('./frontend/src/styles/proposal-editor-compact-fixes.css');
  assert.ok(mainStyle >= 0, 'main stylesheet should remain loaded');
  assert.ok(compactStyle > mainStyle, 'proposal editor overrides should load after main.css');
  assert.match(html, /frontend\/src\/proposal-editor-compact-fixes\.js/);
});

test('proposal editor CSS is scoped, flat and keeps the requested control sizes', async () => {
  const css = await readFile(CSS_FILE, 'utf8');
  assert.match(css, /#app \.pa-editor-workspace \.pa-editor-heading-actions \.ds-btn/);
  assert.match(css, /--pa-choice-width:\s*92px/);
  assert.match(css, /grid-template-columns:\s*repeat\(3, var\(--pa-choice-width\)\)/);
  assert.match(css, /grid-template-columns:\s*minmax\(300px, 400px\) 72px max-content 34px/);
  assert.match(css, /\.ds-pa-item-card[\s\S]*border-block-end:\s*1px solid/);
  assert.match(css, /\.ds-pa-items-total-row,[\s\S]*display:\s*none !important/);
  assert.match(css, /\.ds-pa-summary\.is-compact-relocated/);
  assert.doesNotMatch(css, /(?:^|\n)\s*(?:button|\.ds-btn)\s*\{/m, 'no unscoped global button rules are allowed');
});

test('runtime does not reparent live template controls during proposal type changes', async () => {
  const runtime = await readFile(RUNTIME_FILE, 'utf8');
  assert.match(runtime, /restoreLegacyMovedNodes/);
  assert.match(runtime, /markActivitiesLayout/);
  assert.match(runtime, /markSummaryLayout/);
  assert.match(runtime, /compactObserver\?\.takeRecords\(\)/);
  assert.match(runtime, /requestAnimationFrame\(run\)/);
  assert.doesNotMatch(runtime, /heading\.appendChild\(outsideButtons/);
  assert.doesNotMatch(runtime, /activitiesPanel\.appendChild\(summary\)/);
});

test('runtime observer is child-list only and avoids the previous mutation loop', async () => {
  const runtime = await readFile(RUNTIME_FILE, 'utf8');
  assert.match(runtime, /compactObserver\.observe\(app, \{[\s\S]*childList:\s*true,[\s\S]*subtree:\s*true/);
  assert.doesNotMatch(runtime, /attributeFilter:\s*\['hidden', 'open', 'value'\]/);
  assert.doesNotMatch(runtime, /document\.addEventListener\('click', \(event\) => \{\s*const form = event\.target\?\.closest\?\.\('\[data-pa-form\]'\)/);
  assert.doesNotMatch(runtime, /Supabase|fetch\(|localStorage|sessionStorage/);
});

test('contact channel editing restores the selected contact source and includes an explicit save button', async () => {
  const runtime = await readFile(RUNTIME_FILE, 'utf8');
  assert.match(runtime, /selectedContactPayload/);
  assert.match(runtime, /hydrateContactSourceFromPicker/);
  assert.match(runtime, /option:checked\[data-pa-contact-option\]/);
  assert.match(runtime, /sourceIdInput\.value = sourceId/);
  assert.match(runtime, /ensureContactSaveButton/);
  assert.match(runtime, /dataset\.paContactChannelsSave = 'true'/);
  assert.match(runtime, /שמירת פרטי קשר/);
  assert.match(runtime, /target\.dispatchEvent\(new Event\('change', \{ bubbles: true \}\)\)/);
});

test('next-year workshop editor rows stay on one compact line', async () => {
  const runtime = await readFile(RUNTIME_FILE, 'utf8');
  assert.match(runtime, /normalizeNextYearWorkshopRows/);
  assert.match(runtime, /data-pa-items-group="next_year_workshops"/);
  assert.match(runtime, /grid-template-columns', '400px 72px max-content 34px'/);
  assert.match(runtime, /grid-template-rows', '36px'/);
  assert.match(runtime, /grid-row', '1'/);
});

test('recipient label, proposal date and domain are arranged in one row without an empty contact section', async () => {
  const runtime = await readFile(RUNTIME_FILE, 'utf8');
  assert.match(runtime, /recipientTypeFieldForRow/);
  assert.match(runtime, /label\.textContent = 'סוג נמען'/);
  assert.match(runtime, /arrangeRecipientDateDomainRow/);
  assert.match(runtime, /data-pa-recipient-meta-row/);
  assert.match(runtime, /grid-template-columns', '160px 120px max-content'/);
  assert.match(runtime, /input\[name="proposal_date"\]/);
  assert.match(runtime, /select\[name="proposal_domain"\]/);
  assert.match(runtime, /recipientField\.hidden = form\.classList\.contains\('has-locked-client'\)/);
  assert.match(runtime, /searchBlock\.style\.setProperty\('grid-template-columns', '262px'/);
  assert.match(runtime, /recipientReadyState/);
  assert.match(runtime, /contactPanel\.hidden = !recipientReady/);
});

test('frontend hotfix and service worker cache versions are bumped together', async () => {
  const [config, sw] = await Promise.all([
    readFile(CONFIG_FILE, 'utf8'),
    readFile(SW_FILE, 'utf8')
  ]);
  assert.match(config, /proposal-recipient-meta-alignment-20260801-v2/);
  assert.match(sw, /const CACHE_VERSION = 1336;/);
});
