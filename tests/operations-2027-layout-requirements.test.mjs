import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const {
  orientWorkshopTrainingTable,
  cleanupPrintKitView
} = await import('../frontend/src/screens/operations-2027-table-layout-fix.js');

function withDom(html, run) {
  const dom = new JSDOM(html);
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  try {
    return run(dom.window.document);
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
}

test('workshop training layout places workshop names in rows and instructor names in columns', () => {
  withDom(`
    <table class="ops2027-table" data-ops-matrix-transposed="1">
      <thead><tr>
        <th>שם מדריך</th>
        <th><span class="ops2027-instructor-name">סדנה א</span></th>
        <th><span class="ops2027-instructor-name">סדנה ב</span></th>
      </tr></thead>
      <tbody>
        <tr><td>מדריך א</td><td>✓</td><td></td></tr>
        <tr><td>מדריך ב</td><td>✕</td><td>✓</td></tr>
      </tbody>
    </table>
  `, (document) => {
    const table = document.querySelector('table');
    orientWorkshopTrainingTable(table);

    assert.deepEqual(
      Array.from(table.querySelectorAll('thead th')).map((cell) => cell.textContent.trim()),
      ['שם סדנה', 'מדריך א', 'מדריך ב']
    );
    assert.deepEqual(
      Array.from(table.querySelectorAll('tbody tr > td:first-child')).map((cell) => cell.textContent.trim()),
      ['סדנה א', 'סדנה ב']
    );
    assert.equal(table.classList.contains('ops2027-workshop-training-table'), true);
    assert.equal(table.querySelector('tbody tr:nth-child(1) td:nth-child(2)').textContent.trim(), '✓');
    assert.equal(table.querySelector('tbody tr:nth-child(1) td:nth-child(3)').textContent.trim(), '✕');
  });
});

test('print kit layout removes the page title and need summary while retaining stock and instructor tables', () => {
  withDom(`
    <div class="ops2027-view" data-ops-history-fix="course_print_kits">
      <div class="ops2027-header"><h2 class="ops2027-title">ערכות דפוס</h2></div>
      <section class="ops2027-section"><h3 class="ops2027-history-group-title">מלאי ערכות</h3><div class="ops2027-table-shell"><table></table></div></section>
      <section class="ops2027-section"><h3 class="ops2027-history-group-title">סיכום צורך בערכות</h3><div class="ops2027-table-shell"><table></table></div></section>
      <section class="ops2027-section"><h3 class="ops2027-history-group-title">מדריכים פעילים</h3><div class="ops2027-table-shell"><table></table></div></section>
      <section class="ops2027-section"><h3 class="ops2027-history-group-title">מדריכים לא פעילים שמחזיקים ערכה</h3><div class="ops2027-table-shell"><table></table></div></section>
    </div>
  `, (document) => {
    cleanupPrintKitView(document);
    const view = document.querySelector('.ops2027-view');
    assert.equal(view.querySelector(':scope > .ops2027-header'), null);
    assert.equal(view.textContent.includes('סיכום צורך בערכות'), false);
    assert.equal(view.querySelectorAll('.ops2027-print-kit-stock').length, 1);
    assert.equal(view.querySelectorAll('.ops2027-print-kit-matrix').length, 2);
  });
});

test('layout source enforces equal stock summary widths, narrow kit columns and centered symbols', async () => {
  const source = await readFile(new URL('../frontend/src/screens/operations-2027-table-layout-fix.js', import.meta.url), 'utf8');
  assert.match(source, /nth-last-child\(-n\+3\)/);
  assert.match(source, /width: 118px !important/);
  assert.match(source, /ops2027-print-kit-matrix[\s\S]*width: 72px !important/);
  assert.match(source, /ops2027-print-kit-matrix[\s\S]*text-align: center !important/);
  assert.match(source, /ops2027-print-kit-matrix[\s\S]*margin-inline: auto !important/);
});
