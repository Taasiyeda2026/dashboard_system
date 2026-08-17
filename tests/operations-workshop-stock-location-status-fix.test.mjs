import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const {
  isWorkshopStockLocationHolder,
  workshopHolderStatus,
  applyWorkshopHolderStatusLabels
} = await import('../frontend/src/screens/operations-inventory-polish.js');

test('stock locations are not classified as instructors', () => {
  for (const name of ['מלאי עידן', 'מלאי הילה', 'מלאי גיל']) {
    assert.equal(isWorkshopStockLocationHolder(name), true, `${name} must be a stock location`);
  }
  assert.equal(isWorkshopStockLocationHolder('אלכס זפקה'), false);
});

test('holder status wording distinguishes stock locations from instructors', () => {
  assert.deepEqual(workshopHolderStatus('מלאי עידן', 200), { label: 'יתרה במלאי', tone: 'info' });
  assert.deepEqual(workshopHolderStatus('מלאי הילה', 0), { label: 'אזל מהמלאי', tone: 'muted' });
  assert.deepEqual(workshopHolderStatus('מלאי גיל', -4), { label: 'חוסר במלאי', tone: 'danger' });
  assert.deepEqual(workshopHolderStatus('אלכס זפקה', 12), { label: 'יתרה אצל מדריך', tone: 'info' });
  assert.deepEqual(workshopHolderStatus('אלכס זפקה', 0), { label: 'אין יתרה אצל מדריך', tone: 'muted' });
  assert.deepEqual(workshopHolderStatus('אלכס זפקה', -2), { label: 'חוסר אצל מדריך', tone: 'danger' });
});

test('detail table status labels are corrected without changing quantities', () => {
  const dom = new JSDOM(`
    <table class="ds-ops-dist-table--instructors"><tbody>
      <tr data-row="idan">
        <td class="ds-ops-dist-col--instructor">מלאי עידן</td>
        <td class="ds-ops-dist-col--number">200</td>
        <td class="ds-ops-dist-col--number">0</td>
        <td class="ds-ops-dist-col--number">0</td>
        <td class="ds-ops-dist-col--number">200</td>
        <td class="ds-ops-dist-col--status"><span class="ds-ops-workshop-status-text">עודף אצל מדריך</span></td>
      </tr>
      <tr data-row="gil">
        <td class="ds-ops-dist-col--instructor">מלאי גיל</td>
        <td class="ds-ops-dist-col--number">10</td>
        <td class="ds-ops-dist-col--number">5</td>
        <td class="ds-ops-dist-col--number">5</td>
        <td class="ds-ops-dist-col--number">0</td>
        <td class="ds-ops-dist-col--status"><span class="ds-ops-workshop-status-text">תקין</span></td>
      </tr>
      <tr data-row="instructor">
        <td class="ds-ops-dist-col--instructor">אלכס זפקה</td>
        <td class="ds-ops-dist-col--number">30</td>
        <td class="ds-ops-dist-col--number">10</td>
        <td class="ds-ops-dist-col--number">5</td>
        <td class="ds-ops-dist-col--number">15</td>
        <td class="ds-ops-dist-col--status"><span class="ds-ops-workshop-status-text">עודף אצל מדריך</span></td>
      </tr>
    </tbody></table>
  `);

  const beforeNumbers = Array.from(dom.window.document.querySelectorAll('.ds-ops-dist-col--number'))
    .map((cell) => cell.textContent);

  applyWorkshopHolderStatusLabels(dom.window.document);

  assert.equal(dom.window.document.querySelector('[data-row="idan"] .ds-ops-dist-col--status').textContent, 'יתרה במלאי');
  assert.equal(dom.window.document.querySelector('[data-row="gil"] .ds-ops-dist-col--status').textContent, 'אזל מהמלאי');
  assert.equal(dom.window.document.querySelector('[data-row="instructor"] .ds-ops-dist-col--status').textContent, 'יתרה אצל מדריך');

  const afterNumbers = Array.from(dom.window.document.querySelectorAll('.ds-ops-dist-col--number'))
    .map((cell) => cell.textContent);
  assert.deepEqual(afterNumbers, beforeNumbers, 'status fix must not change inventory quantities');
});
