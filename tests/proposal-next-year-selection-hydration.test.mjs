import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

if (!globalThis.sessionStorage) {
  const store = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear()
  };
}

if (!globalThis.localStorage) {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear()
  };
}

const { hydrateNextYearPricingSelection } = await import('../frontend/src/proposal-next-year-selection-hydration.js');
const { proposalItemGroupForEditorRow } = await import('../frontend/src/screens/proposals-agreements.js');

const rawSpaceWorkshop = {
  activity_name: 'אסטרונאוט על חוטים',
  activity_no: '',
  pricing_key: 'workshop_001',
  parent_pricing_key: 'space_workshop',
  proposal_group: 'פעילויות קיץ',
  item_type: 'סדנה',
  unit_duration: '45 דקות',
  unit_price: 450,
  sort_order: 1,
  proposal_display_mode: 'bundle_child',
  meetings_count: 1,
  hours_count: 0.75,
  is_active_for_proposals: true
};

const displayedSpaceWorkshop = {
  ...rawSpaceWorkshop,
  proposal_group: 'next_year_workshops',
  unit_price: 500
};

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

function formHtml(stalePrice = '') {
  const value = optionKey(displayedSpaceWorkshop);
  return `<form data-pa-form>
    <input name="activity_type_group" value="next_year">
    <section data-pa-items-group="next_year_courses">
      <div data-pa-items-body></div>
      <strong data-pa-group-total="next_year_courses">₪ 0</strong>
    </section>
    <section data-pa-items-group="next_year_workshops">
      <div data-pa-items-body>
        <article data-pa-item-row data-pa-row-group="next_year_workshops">
          <select data-pa-pricing-select><option value="${value}" selected>אסטרונאוט על חוטים — סדנה — ₪ 500</option></select>
          <input name="quantity" data-pa-item-qty value="2">
          <input name="unit_price" data-pa-item-price value="${stalePrice}">
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
          <input name="proposal_group" value="next_year_workshops">
          <input name="item_display_mode" value="single">
          <input name="item_source_pricing_key" value="">
          <input name="bundle_pricing_key" value="">
          <input name="item_selected_bundle_items" value="[]">
        </article>
      </div>
      <strong data-pa-group-total="next_year_workshops">₪ 0</strong>
    </section>
    <strong data-pa-grand-total>₪ 0</strong>
    <strong data-pa-summary-total>₪ 0</strong>
    <span data-pa-summary-subtotal>₪ 0</span>
    <span data-pa-summary-discount>₪ 0</span>
    <select data-pa-discount-type><option value="amount" selected>₪</option></select>
    <input data-pa-discount-value value="0">
  </form>`;
}

function withDom(stalePrice, fn) {
  const dom = new JSDOM(formHtml(stalePrice), { url: 'http://localhost/' });
  const previousEvent = globalThis.Event;
  globalThis.Event = dom.window.Event;
  try {
    const form = dom.window.document.querySelector('[data-pa-form]');
    const row = form.querySelector('[data-pa-item-row]');
    return fn(form, row);
  } finally {
    globalThis.Event = previousEvent;
  }
}

test('direct space-workshop selection applies the displayed 500 ₪ price and all totals', () => {
  withDom('', (form, row) => {
    const result = hydrateNextYearPricingSelection(row, [rawSpaceWorkshop], { notify: false });
    assert.equal(result.changed, true);
    assert.equal(row.querySelector('[data-pa-item-price]').value, '500');
    assert.equal(row.querySelector('[name="item_name"]').value, 'אסטרונאוט על חוטים');
    assert.equal(row.querySelector('[name="item_type"]').value, 'סדנה');
    assert.equal(row.querySelector('[name="item_source_pricing_key"]').value, 'workshop_001');
    assert.equal(row.querySelector('[data-pa-item-total]').value, '1000.00');
    assert.equal(row.querySelector('[data-pa-item-total-display]').textContent, '₪ 1,000');
    assert.equal(form.querySelector('[data-pa-group-total="next_year_workshops"]').textContent, '₪ 1,000');
    assert.equal(form.querySelector('[data-pa-grand-total]').textContent, '₪ 1,000');
  });
});

test('an explicit workshop selection replaces a stale price from the previous activity', () => {
  withDom('13500', (form, row) => {
    hydrateNextYearPricingSelection(row, [rawSpaceWorkshop], { notify: false });
    assert.equal(row.querySelector('[data-pa-item-price]').value, '500');
    assert.equal(row.querySelector('[data-pa-item-total]').value, '1000.00');
    assert.equal(form.querySelector('[data-pa-summary-total]').textContent, '₪ 1,000');
  });
});

test('direct selection dispatches one input notification after complete hydration', () => {
  withDom('', (_form, row) => {
    let events = 0;
    row.querySelector('[data-pa-item-price]').addEventListener('input', () => { events += 1; });
    hydrateNextYearPricingSelection(row, [rawSpaceWorkshop], { notify: true });
    assert.equal(events, 1);
    hydrateNextYearPricingSelection(row, [rawSpaceWorkshop], { notify: true });
    assert.equal(events, 1);
  });
});

test('editor section keeps a selected summer-catalog workshop in the next-year workshop payload', () => {
  withDom('', (_form, row) => {
    assert.equal(proposalItemGroupForEditorRow(row, 'פעילויות קיץ'), 'next_year_workshops');
    assert.equal(proposalItemGroupForEditorRow(row, 'summer'), 'next_year_workshops');
  });
});
