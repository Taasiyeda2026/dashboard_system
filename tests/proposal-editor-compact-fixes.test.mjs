import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const INDEX_FILE = new URL('../index.html', import.meta.url);
const CSS_FILE = new URL('../frontend/src/styles/proposal-editor-compact-fixes.css', import.meta.url);
const RUNTIME_FILE = new URL('../frontend/src/proposal-editor-compact-fixes.js', import.meta.url);
const SCREEN_FILE = new URL('../frontend/src/screens/proposals-agreements.js', import.meta.url);
const CONFIG_FILE = new URL('../frontend/src/config.js', import.meta.url);
const SW_FILE = new URL('../frontend/sw.js', import.meta.url);

test('proposal editor compact assets are loaded after the shared dashboard styles', async () => {
  const html = await readFile(INDEX_FILE, 'utf8');
  const mainStyle = html.indexOf('./frontend/src/styles/main.css');
  const compactStyle = html.indexOf('./frontend/src/styles/proposal-editor-compact-fixes.css');
  assert.ok(mainStyle >= 0, 'main stylesheet should remain loaded');
  assert.ok(compactStyle > mainStyle, 'proposal editor overrides should load after main.css');
  assert.match(html, /frontend\/src\/proposal-editor-compact-fixes\.js\?v=20260801-v6/);
  assert.match(html, /proposal-editor-compact-fixes\.css\?v=20260801-v6/);
});

test('proposal editor CSS is scoped, flat and keeps the requested control sizes', async () => {
  const css = await readFile(CSS_FILE, 'utf8');
  assert.match(css, /#app \.pa-editor-workspace \.pa-editor-heading-actions \.ds-btn/);
  assert.match(css, /--pa-choice-width:\s*92px/);
  assert.match(css, /--recipient-control-height:\s*40px/);
  assert.match(css, /--recipient-border-color:\s*#cbd5e1/);
  assert.match(css, /--recipient-border-radius:\s*8px/);
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
  const [runtime, css] = await Promise.all([
    readFile(RUNTIME_FILE, 'utf8'),
    readFile(CSS_FILE, 'utf8')
  ]);
  assert.match(runtime, /normalizeNextYearWorkshopRows/);
  assert.match(runtime, /Workshop one-line layout is owned by proposal-editor-compact-fixes\.css/);
  assert.doesNotMatch(runtime, /style\.setProperty\('grid-template-columns', '400px 72px max-content 34px'/);
  assert.match(css, /\[data-pa-items-group="next_year_workshops"\] \.ds-pa-item-quick-row/);
  assert.match(css, /grid-template-columns:\s*400px 72px max-content 34px/);
  assert.match(css, /grid-template-rows:\s*36px/);
});

test('recipient date, domain and type are owned by formHtml with no runtime rearrange', async () => {
  const [runtime, screen, css] = await Promise.all([
    readFile(RUNTIME_FILE, 'utf8'),
    readFile(SCREEN_FILE, 'utf8'),
    readFile(CSS_FILE, 'utf8')
  ]);
  assert.match(screen, /data-pa-recipient-meta-row/);
  assert.match(screen, /ds-pa-recipient-date-field/);
  assert.match(screen, /ds-pa-recipient-domain-field/);
  assert.match(screen, /clientTypeSelectorHtml\(initClientType\)/);
  assert.match(screen, /name="proposal_date"/);
  assert.match(screen, /name="proposal_domain"/);
  assert.equal((screen.match(/סוג נמען/g) || []).filter((value, index, arr) => arr.indexOf(value) === index).length >= 1, true);
  assert.match(runtime, /Recipient type is rendered in formHtml/);
  assert.match(runtime, /no runtime reparenting/);
  assert.doesNotMatch(runtime, /row\.appendChild\(element\)/);
  assert.doesNotMatch(runtime, /data-pa-recipient-meta-row[\s\S]*style\.setProperty|style\.setProperty[\s\S]*data-pa-recipient-meta-row/);
  assert.doesNotMatch(runtime, /recipientField\.hidden = form\.classList\.contains\('has-locked-client'\)/);
  assert.doesNotMatch(runtime, /contactPanel\.hidden = !recipientReady/);
  assert.match(css, /\[data-pa-recipient-meta-row\]/);
  assert.match(css, /grid-template-columns:\s*130px 130px 300px 320px/);
  assert.doesNotMatch(css, /overflow-x:\s*auto/);
});

test('frontend hotfix and service worker cache versions are bumped together', async () => {
  const [config, sw] = await Promise.all([
    readFile(CONFIG_FILE, 'utf8'),
    readFile(SW_FILE, 'utf8')
  ]);
  assert.match(config, /recipient-date-domain-130-20260801-v1/);
  assert.match(config, /proposal-recipient-search-row-fix\.js\?v=20260801-v10/);
  assert.match(sw, /const CACHE_VERSION = 1351;/);
});
