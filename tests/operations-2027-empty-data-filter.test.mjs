import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.queueMicrotask = globalThis.queueMicrotask || ((fn) => Promise.resolve().then(fn));

const { filterOperations2027EmptyData } = await import('../frontend/src/screens/operations-2027-empty-data-filter.js');

function rootWith(html) {
  const root = document.createElement('div');
  root.innerHTML = `<div class="ds-ops-mgmt-content">${html}</div>`;
  document.body.appendChild(root);
  return root;
}

test('course training keeps trained and assigned-untrained cells and removes empty rows and columns', () => {
  const root = rootWith(`
    <div class="ops2027-view" data-ops-controller-tab="course_training_matrix">
      <div class="ops2027-table-shell"><table class="ops2027-table">
        <thead><tr><th>שם</th><th>קורס א</th><th>קורס ב</th><th>קורס ריק</th></tr></thead>
        <tbody>
          <tr><td>מדריך מוכשר</td><td><button class="ops2027-cell-button is-yes" data-trained="1">✓</button></td><td><button class="ops2027-cell-button is-empty"></button></td><td><button class="ops2027-cell-button is-empty"></button></td></tr>
          <tr><td>משובץ ללא הכשרה</td><td><button class="ops2027-cell-button is-empty"></button></td><td><button class="ops2027-cell-button is-no" data-assigned="1">✕</button></td><td><button class="ops2027-cell-button is-empty"></button></td></tr>
          <tr><td>מדריך ריק</td><td><button class="ops2027-cell-button is-empty"></button></td><td><button class="ops2027-cell-button is-empty"></button></td><td><button class="ops2027-cell-button is-empty"></button></td></tr>
        </tbody>
      </table></div>
    </div>`);

  filterOperations2027EmptyData(root);
  const table = root.querySelector('table');
  assert.deepEqual([...table.tBodies[0].rows].map((row) => row.cells[0].textContent), ['מדריך מוכשר', 'משובץ ללא הכשרה']);
  assert.deepEqual([...table.tHead.rows[0].cells].map((cell) => cell.textContent), ['שם', 'קורס א', 'קורס ב']);
});

test('workshop training removes workshops and instructors with no training or assignment data', () => {
  const root = rootWith(`
    <div class="ops2027-view" data-ops-controller-tab="summer_training_matrix">
      <div class="ops2027-table-shell"><table class="ops2027-table">
        <thead><tr><th>שם</th><th>מדריך פעיל</th><th>מדריך ריק</th></tr></thead>
        <tbody>
          <tr><td>סדנה עם נתון</td><td><span class="ops2027-status is-yes">✓</span></td><td></td></tr>
          <tr><td>סדנה ריקה</td><td></td><td></td></tr>
        </tbody>
      </table></div>
    </div>`);

  filterOperations2027EmptyData(root);
  const table = root.querySelector('table');
  assert.equal(table.tBodies[0].rows.length, 1);
  assert.equal(table.tBodies[0].rows[0].cells[0].textContent, 'סדנה עם נתון');
  assert.deepEqual([...table.tHead.rows[0].cells].map((cell) => cell.textContent), ['שם', 'מדריך פעיל']);
});

test('print kit view hides all-zero stock locations and empty instructor rows while preserving missing-kit alerts', () => {
  const root = rootWith(`
    <div class="ops2027-view" data-ops-controller-tab="course_print_kits">
      <section class="ops2027-section"><div class="ops2027-print-kit-stock"><table>
        <thead><tr><th>שם ערכה</th><th>מחסן</th><th>הילה</th><th>עידן</th><th>גיל</th><th>אצל פעילים</th><th>אצל לא פעילים</th><th>סה״כ</th></tr></thead>
        <tbody>
          <tr><td>ערכה א</td><td><input type="number" value="0"></td><td><input type="number" value="0"></td><td><input type="number" value="2"></td><td><input type="number" value="0"></td><td>1</td><td>0</td><td>3</td></tr>
          <tr><td>ערכה ריקה</td><td><input type="number" value="0"></td><td><input type="number" value="0"></td><td><input type="number" value="0"></td><td><input type="number" value="0"></td><td>0</td><td>0</td><td>0</td></tr>
        </tbody>
      </table></div></section>
      <section class="ops2027-section"><div class="ops2027-print-kit-matrix"><table>
        <thead><tr><th>שם</th><th>ערכה א</th><th>ערכה ריקה</th></tr></thead>
        <tbody>
          <tr><td>מדריך שחסרה לו ערכה</td><td><button class="ops2027-cell-button is-no" data-assigned="1">✕</button></td><td><button class="ops2027-cell-button is-empty"></button></td></tr>
          <tr><td>מדריך ריק</td><td><button class="ops2027-cell-button is-empty"></button></td><td><button class="ops2027-cell-button is-empty"></button></td></tr>
        </tbody>
      </table></div></section>
    </div>`);

  filterOperations2027EmptyData(root);
  const stockTable = root.querySelector('.ops2027-print-kit-stock table');
  assert.deepEqual([...stockTable.tHead.rows[0].cells].map((cell) => cell.textContent), ['שם ערכה', 'עידן', 'אצל פעילים', 'אצל לא פעילים', 'סה״כ']);
  assert.equal(stockTable.tBodies[0].rows.length, 1);
  assert.equal(stockTable.tBodies[0].rows[0].cells[0].textContent, 'ערכה א');

  const matrix = root.querySelector('.ops2027-print-kit-matrix table');
  assert.equal(matrix.tBodies[0].rows.length, 1);
  assert.equal(matrix.tBodies[0].rows[0].cells[0].textContent, 'מדריך שחסרה לו ערכה');
  assert.deepEqual([...matrix.tHead.rows[0].cells].map((cell) => cell.textContent), ['שם', 'ערכה א']);
});
