import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const INDEX_FILE = new URL('../index.html', import.meta.url);

test('proposal details pricing section stays content-sized and compact', async () => {
  const indexHtml = await readFile(INDEX_FILE, 'utf8');

  assert.match(indexHtml, /\[data-pa-proposal-detail\] \.ds-pa-activities-wide\s*\{[^}]*height:\s*auto\s*!important;[^}]*min-height:\s*0\s*!important;/s);
  assert.match(indexHtml, /\[data-pa-proposal-detail\] \[data-pa-drawer-items\]\s*\{[^}]*height:\s*auto\s*!important;[^}]*min-height:\s*0\s*!important;/s);
  assert.match(indexHtml, /\.ds-pa-info-card--financial-summary\s*\{[^}]*display:\s*flex\s*!important;[^}]*border-top:\s*1px solid var\(--ds-border\)\s*!important;[^}]*box-shadow:\s*none\s*!important;/s);
  assert.match(indexHtml, /\.ds-pa-info-card--financial-summary \.ds-pa-card-title\s*\{[^}]*margin:\s*0\s*!important;/s);
  assert.match(indexHtml, /\.ds-pa-info-card--financial-summary \.ds-pa-total-amount\s*\{[^}]*margin:\s*0\s*!important;/s);
});
