import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const INDEX_FILE = new URL('../index.html', import.meta.url);

test('proposal detail header shows a file icon only when a saved PDF exists', async () => {
  const index = await readFile(INDEX_FILE, 'utf8');

  assert.match(index, /function updateSavedPdfIndicator\(detail, hasSavedPdf\)/);
  assert.match(index, /data-pa-saved-pdf-indicator/);
  assert.match(index, /cellLabel\(cell\) === 'סטטוס PDF'/);
  assert.match(index, /updateSavedPdfIndicator\(detail, cellValue\(pdfStatusCell\) === 'נשמר'\)/);
  assert.match(index, /title = 'קיים PDF שמור'/);
  assert.match(index, /\.ds-pa-drawer-meta-item--status/);
});
