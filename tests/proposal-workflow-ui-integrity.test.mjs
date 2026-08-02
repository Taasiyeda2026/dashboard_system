import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

if (!globalThis.sessionStorage) {
  const store = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear()
  };
}
if (!globalThis.localStorage) {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear()
  };
}

const {
  finalizeSummerTab,
  installProposalWorkflowUiIntegrity,
  recalculateProposalEditorTotals
} = await import('../frontend/src/proposal-workflow-ui-integrity.js');

test('generic GEFEN rows outside grouped sections update the editor total', () => {
  const dom = new JSDOM(`<form data-pa-form>
    <div data-pa-item-row>
      <input data-pa-item-qty value="2">
      <input data-pa-item-price value="8000">
      <input data-pa-item-total>
      <output data-pa-item-total-display>₪ 0</output>
    </div>
    <select data-pa-discount-type><option value="amount" selected>₪</option></select>
    <input data-pa-discount-value value="0">
    <strong data-pa-grand-total>₪ 0</strong>
    <strong data-pa-summary-total>₪ 0</strong>
    <span data-pa-summary-subtotal>₪ 0</span>
    <span data-pa-summary-discount>₪ 0</span>
  </form>`);
  const form = dom.window.document.querySelector('form');
  assert.equal(recalculateProposalEditorTotals(form), 16000);
  assert.equal(form.querySelector('[data-pa-item-total]').value, '16000.00');
  assert.match(form.querySelector('[data-pa-grand-total]').textContent, /16,000/);
});

test('grouped rows are counted once while group totals stay independent', () => {
  const dom = new JSDOM(`<form data-pa-form>
    <section data-pa-items-group="next_year_courses">
      <div data-pa-item-row><input data-pa-item-qty value="1"><input data-pa-item-price value="13500"><input data-pa-item-total><output data-pa-item-total-display></output></div>
      <strong data-pa-group-total="next_year_courses">₪ 0</strong>
    </section>
    <section data-pa-items-group="next_year_workshops">
      <div data-pa-item-row><input data-pa-item-qty value="2"><input data-pa-item-price value="500"><input data-pa-item-total><output data-pa-item-total-display></output></div>
      <strong data-pa-group-total="next_year_workshops">₪ 0</strong>
    </section>
    <select data-pa-discount-type><option value="amount" selected>₪</option></select><input data-pa-discount-value value="0">
    <strong data-pa-grand-total>₪ 0</strong><strong data-pa-summary-total>₪ 0</strong><span data-pa-summary-subtotal>₪ 0</span><span data-pa-summary-discount>₪ 0</span>
  </form>`);
  const form = dom.window.document.querySelector('form');
  assert.equal(recalculateProposalEditorTotals(form), 14500);
  assert.match(form.querySelector('[data-pa-group-total="next_year_courses"]').textContent, /13,500/);
  assert.match(form.querySelector('[data-pa-group-total="next_year_workshops"]').textContent, /1,000/);
  assert.match(form.querySelector('[data-pa-grand-total]').textContent, /14,500/);
});

test('summer tab replaces the earlier listener and filters locally without a backend change event', () => {
  const dom = new JSDOM(`<div class="ds-pa-screen">
    <button data-pa-tab="records">הצעות</button>
    <button data-pa-summer-tab>הצעות מחיר קיץ</button>
    <select data-pa-filter="activity_type_group"><option value=""></option><option value="summer">קיץ</option></select>
    <table data-pa-table><tbody>
      <tr data-pa-row-id="1"><td>פעילויות קיץ</td></tr>
      <tr data-pa-row-id="2"><td>תשפ״ז</td></tr>
    </tbody></table>
  </div>`);
  const screen = dom.window.document.querySelector('.ds-pa-screen');
  let filterChanges = 0;
  screen.querySelector('[data-pa-filter]').addEventListener('change', () => { filterChanges += 1; });
  const button = finalizeSummerTab(screen);
  button.click();
  assert.equal(filterChanges, 0);
  assert.equal(screen.querySelector('[data-pa-filter]').value, 'summer');
  assert.equal(screen.querySelector('tr[data-pa-row-id="1"]').hidden, false);
  assert.equal(screen.querySelector('tr[data-pa-row-id="2"]').hidden, true);
});

test('approved status response schedules the existing PDF action', async () => {
  const dom = new JSDOM('<button data-pa-print="proposal-1"></button>', { url: 'http://localhost/' });
  let clicks = 0;
  dom.window.document.querySelector('button').addEventListener('click', () => { clicks += 1; });
  const fakeApi = {
    updateProposalAgreementStatus: async () => ({ row: { id: 'proposal-1', status: 'approved' } })
  };
  installProposalWorkflowUiIntegrity(fakeApi, {
    document: dom.window.document,
    MutationObserver: dom.window.MutationObserver,
    Element: dom.window.Element,
    CSS: dom.window.CSS,
    setInterval,
    clearInterval,
    setTimeout,
    requestAnimationFrame: (callback) => setTimeout(callback, 0)
  });
  await fakeApi.updateProposalAgreementStatus('proposal-1', 'approved', '', { signature_data_url: 'data:image/png;base64,AA==' });
  await new Promise((resolve) => setTimeout(resolve, 450));
  assert.equal(clicks, 1);
});
