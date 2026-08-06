import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const INDEX_FILE = new URL('../index.html', import.meta.url);

test('proposal detail header keeps the saved PDF icon after the sending card is removed', async () => {
  const index = await readFile(INDEX_FILE, 'utf8');

  assert.match(index, /function updateSavedPdfIndicator\(detail, hasSavedPdf\)/);
  assert.match(index, /data-pa-saved-pdf-indicator/);
  assert.match(index, /cellLabel\(cell\) === 'סטטוס PDF'/);
  assert.match(index, /if \(sendingCard\) \{[\s\S]*updateSavedPdfIndicator\(detail, cellValue\(pdfStatusCell\) === 'נשמר'\);[\s\S]*\}/);
  assert.doesNotMatch(index, /const sendingGrid = sendingCard\?\.querySelector\('\.ds-pa-info-grid'\);\s*const pdfStatusCell/);
  assert.match(index, /title = 'קיים PDF שמור'/);
  assert.match(index, /\.ds-pa-drawer-meta-item--status/);
});
