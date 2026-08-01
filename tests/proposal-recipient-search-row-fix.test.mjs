import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const FIX_FILE = new URL('../frontend/src/proposal-recipient-search-row-fix.js', import.meta.url);
const CONFIG_FILE = new URL('../frontend/src/config.js', import.meta.url);
const SW_FILE = new URL('../frontend/sw.js', import.meta.url);

test('recipient date, domain, type and authority search stay in one four-column row', async () => {
  const source = await readFile(FIX_FILE, 'utf8');
  assert.match(source, /ensureRecipientSingleBoxStyles/);
  assert.match(source, /enforceRecipientRowStyles/);
  assert.match(source, /data-pa-recipient-meta-row/);
  assert.match(source, /data-pa-client-search-row/);
  assert.match(source, /row\.appendChild\(searchBlock\)/);
  assert.match(source, /row\.appendChild\(clientCard\)/);
  assert.match(source, /grid-template-columns:\s*160px 120px max-content max-content !important/);
  assert.match(source, /setImportant\(row, 'grid-template-columns', '160px 120px max-content max-content'\)/);
  assert.match(source, /setImportant\(searchBlock, 'grid-column', '4'\)/);
  assert.match(source, /setImportant\(searchBlock, 'grid-row', '1'\)/);
  assert.match(source, /changeAuthorityButton\.textContent = 'שינוי'/);
  assert.match(source, /ds-pa-client-locked-type[\s\S]*display:\s*none !important/);
});

test('recipient layout reapplies after the compact editor rewrites inline styles', async () => {
  const source = await readFile(FIX_FILE, 'utf8');
  assert.match(source, /requestAnimationFrame\(\(\) => requestAnimationFrame\(\(\) => requestAnimationFrame\(run\)\)\)/);
  assert.match(source, /function mutationNeedsRecipientAlignment/);
  assert.match(source, /attributes:\s*true/);
  assert.match(source, /attributeFilter:\s*\['style', 'hidden', 'class'\]/);
  assert.match(source, /element\.style\.getPropertyPriority\(property\) === 'important'/);
});

test('contact section stays hidden until the selected recipient type is complete', async () => {
  const source = await readFile(FIX_FILE, 'utf8');
  assert.match(source, /function recipientSelectionReady/);
  assert.match(source, /type === 'authority'[\s\S]*Boolean\(authorityId\)/);
  assert.match(source, /type === 'other'[\s\S]*Boolean\(authorityId && otherName\)/);
  assert.match(source, /Boolean\(authorityId && schoolId\)/);
  assert.match(source, /data-pa-step-panel="contact"\]\[hidden\][\s\S]*display:\s*none !important/);
  assert.match(source, /contactPanel\.hidden = !ready/);
});

test('recipient row conflict asset and cache versions are bumped together', async () => {
  const [config, sw] = await Promise.all([
    readFile(CONFIG_FILE, 'utf8'),
    readFile(SW_FILE, 'utf8')
  ]);
  assert.match(config, /proposal-recipient-search-row-fix\.js\?v=20260801-v3/);
  assert.match(config, /proposal-recipient-row-conflict-20260801-v1/);
  assert.match(sw, /const CACHE_VERSION = 1340;/);
});
