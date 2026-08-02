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
  hydrateGenericPricingSelection,
  installProposalWorkflowUiIntegrity,
  recalculateProposalEditorTotals
} = await import('../frontend/src/proposal-workflow-ui-integrity.js');

function optionKey(row) {
  return [
    row.activity_no,
    row.activity_name,
    row.item_type,
    row.proposal_group,
    row.unit_duration,
    row.unit_price,
    row.sort_order
  ].map((value) => String(value == null ? '' : value).trim()).join('||');
}

test('generic GEFEN selection hydrates its internal price and calculated total', () => {
  const pricing = {
    activity_no: '9545',
    activity_name: 'סודות ויסודות הבינה המלאכותית',
    item_type: 'תוכנית',
    proposal_group: 'גפן',
    unit_duration: '90 דקות',
    unit_price: 8000,
    sort_order: 1,
    gefen_number: '9545',
    meetings_count: 8,
    hours_count: 12,
    hourly_price: 666.67,
    pricing_key: 'gefen_9545',
    proposal_display_mode: 'single'
  };
  const selected = optionKey(pricing);
  const dom = new JSDOM(`<form data-pa-form>
    <article data-pa-item-row data-pa-row-group="גפן">
      <select data-pa-pricing-select><option value="${selected}" selected>סודות ויסודות הבינה המלאכותית — תוכנית — ₪ 8,000</option></select>
      <input data-pa-item-qty value="1">
      <input name="unit_price" data-pa-item-price value="">
      <input name="total_price" data-pa-item-total value="">
      <output data-pa-item-total-display>₪ 0</output>
      <input name="pricing_option_key" value="">
      <input name="activity_no" value="">
      <input name="item_name" value="">
      <input name="item_type" value="">
      <input name="gefen_number" value="">
      <input name="gefen_number_display" value="">
      <input name="meetings_count" value="">
      <input name="hours_count" value="">
      <input name="unit_duration" value="">
      <input name="hourly_price" value="">
      <input name="description" value="">
      <input name="proposal_group" value="גפן">
      <input name="item_display_mode" value="">
      <input name="item_source_pricing_key" value="">
      <input name="bundle_pricing_key" value="">
      <input name="item_selected_bundle_items" value="[]">
    </article>
    <select data-pa-discount-type><option value="amount" selected>₪</option></select>
    <input data-pa-discount-value value="0">
    <strong data-pa-grand-total>₪ 0</strong>
    <strong data-pa-summary-total>₪ 0</strong>
    <span data-pa-summary-subtotal>₪ 0</span>
    <span data-pa-summary-discount>₪ 0</span>
  </form>`, { url: 'http://localhost/' });
  const previousEvent = globalThis.Event;
  globalThis.Event = dom.window.Event;
  try {
    const form = dom.window.document.querySelector('form');
    const row = form.querySelector('[data-pa-item-row]');
    const result = hydrateGenericPricingSelection(row, [pricing], { notify: false });
    assert.equal(result.changed, true);
    assert.equal(row.querySelector('[data-pa-item-price]').value, '8000');
    assert.equal(row.querySelector('[name="item_name"]').value, pricing.activity_name);
    assert.equal(row.querySelector('[name="gefen_number"]').value, '9545');
    assert.equal(row.querySelector('[data-pa-item-total]').value, '8000.00');
    assert.match(row.querySelector('[data-pa-item-total-display]').textContent, /8,000/);
    assert.match(form.querySelector('[data-pa-grand-total]').textContent, /8,000/);
  } finally {
    globalThis.Event = previousEvent;
  }
});

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

test('direct signed approval schedules the existing PDF action once', async () => {
  const dom = new JSDOM(`
    <button data-pa-save-pending data-pa-target-status="approved">חתום ואשר</button>
    <button data-pa-print="proposal-1">PDF</button>
  `, { url: 'http://localhost/' });
  let pdfClicks = 0;
  dom.window.document.querySelector('[data-pa-print]').addEventListener('click', () => { pdfClicks += 1; });
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
  dom.window.document.querySelector('[data-pa-save-pending]').click();
  await fakeApi.updateProposalAgreementStatus('proposal-1', 'approved', '', { signature_data_url: 'data:image/png;base64,AA==' });
  await new Promise((resolve) => setTimeout(resolve, 450));
  assert.equal(pdfClicks, 1);
});
