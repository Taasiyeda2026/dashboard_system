import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const INDEX_FILE = new URL('../index.html', import.meta.url);
const CSS_FILE = new URL('../frontend/src/styles/proposal-editor-compact-fixes.css', import.meta.url);
const RUNTIME_FILE = new URL('../frontend/src/proposal-editor-compact-fixes.js', import.meta.url);
const NEXT_YEAR_STABILITY_FILE = new URL('../frontend/src/proposal-next-year-editor-stability.js', import.meta.url);
const SCREEN_FILE = new URL('../frontend/src/screens/proposals-agreements.js', import.meta.url);
const CONFIG_FILE = new URL('../frontend/src/config.js', import.meta.url);
const SW_FILE = new URL('../frontend/sw.js', import.meta.url);
const FEATURE_LOADERS_FILE = new URL('../frontend/src/feature-loaders.js', import.meta.url);

test('proposal editor compact CSS uses a Vite-aware feature import', async () => {
  const [html, featureLoaders] = await Promise.all([
    readFile(INDEX_FILE, 'utf8'),
    readFile(FEATURE_LOADERS_FILE, 'utf8')
  ]);
  assert.match(html, /\.\/frontend\/src\/styles\/main\.css/);
  assert.doesNotMatch(html, /proposal-editor-compact-fixes\.css/);
  assert.match(featureLoaders, /import\('\.\/styles\/proposal-editor-compact-fixes\.css'\)/);
  assert.doesNotMatch(featureLoaders, /loadStylesheet\('\.\/styles\/proposal-editor-compact-fixes\.css/);
});

test('proposal editor CSS is scoped, flat and keeps the requested control sizes', async () => {
  const css = await readFile(CSS_FILE, 'utf8');
  assert.match(css, /#app \.pa-editor-workspace \.pa-editor-heading-actions \.ds-btn/);
  assert.match(css, /--pa-choice-width:\s*92px/);
  assert.match(css, /--recipient-control-height:\s*40px/);
  assert.match(css, /--recipient-border-color:\s*#cbd5e1/);
  assert.match(css, /--recipient-border-radius:\s*5px/);
  assert.match(css, /grid-template-columns:\s*150px 150px minmax\(300px, 1fr\)/);
  assert.match(css, /\.ds-pa-recipient-type[\s\S]*grid-template-columns:\s*1fr/);
  assert.match(css, /\.pa-editor-workspace \[hidden\] \{ display:\s*none !important; \}/);
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

test('runtime observer only schedules newly mounted editor roots', async () => {
  const runtime = await readFile(RUNTIME_FILE, 'utf8');
  assert.match(runtime, /function addedEditorRoots/);
  assert.match(runtime, /node\.matches\?\.\('\[data-pa-form\]'\)/);
  assert.match(runtime, /compactObserver\.observe\(app, \{[\s\S]*childList:\s*true,[\s\S]*subtree:\s*true/);
  assert.doesNotMatch(runtime, /scheduleCompact\(app\)/);
  assert.doesNotMatch(runtime, /attributeFilter:\s*\['hidden', 'open', 'value'\]/);
  assert.doesNotMatch(runtime, /Supabase|fetch\(|localStorage|sessionStorage/);
});

test('compact runtime loads the focused next-year editor stabilizer', async () => {
  const [runtime, stability] = await Promise.all([
    readFile(RUNTIME_FILE, 'utf8'),
    readFile(NEXT_YEAR_STABILITY_FILE, 'utf8')
  ]);
  assert.match(runtime, /import '\.\/proposal-next-year-editor-stability\.js'/);
  assert.match(stability, /stabilizeNextYearForm/);
  assert.match(stability, /paNextYearUserAdded/);
  assert.match(stability, /pricingRowsForNextYearGroup/);
  assert.doesNotMatch(stability, /document\.body\.innerHTML\s*=/);
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
  assert.match(css, /\.ds-pa-recipient-main-row/);
  assert.match(css, /grid-template-columns:\s*150px 150px minmax\(300px, 1fr\)/);
  assert.doesNotMatch(css, /overflow-x:\s*auto/);
});

test('frontend hotfix and service worker cache versions are bumped together', async () => {
  const [config, sw, featureLoaders] = await Promise.all([
    readFile(CONFIG_FILE, 'utf8'),
    readFile(SW_FILE, 'utf8'),
    readFile(FEATURE_LOADERS_FILE, 'utf8')
  ]);
  assert.match(config, /recipient-date-domain-130-20260801-v1/);
  assert.match(config, /proposal-recipient-search-row-fix\.js\?v=20260801-v10/);
  assert.match(config, /next-year-editor-stability-20260802-v1/);
  assert.match(config, /proposal-summer-list-complete-20260802-v1/);
  assert.match(config, /proposal-pdf-school-name-only-20260803-v1/);
  assert.match(featureLoaders, /proposal-summer-list-runtime\.js\?v=20260802-v1/);
  assert.match(featureLoaders, /proposal-pdf-school-filename-runtime\.js\?v=20260803-school-name-only-v2/);
  assert.match(sw, /const CACHE_VERSION = 1371;/);
});
