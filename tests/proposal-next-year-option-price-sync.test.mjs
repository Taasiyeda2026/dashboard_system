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

const { bridgeNextYearPricingSelection } = await import('../frontend/src/proposal-next-year-option-price-sync.js');

const optionValue = [
  '',
  'סדנאות STEM',
  'סדנה',
  'next_year_workshops',
  '45 דקות',
  '650',
  '30'
].join('||');

function formHtml() {
  return `<form data-pa-form>
    <input name="activity_type_group" value="next_year">
    <section data-pa-items-group="next_year_workshops">
      <article data-pa-item-row data-pa-row-group="next_year_workshops">
        <select data-pa-pricing-select>
          <option value="${optionValue}" data-bundle-parent="1" selected>סדנאות STEM — הגדרה כוללת — ₪ 650</option>
        </select>
        <input name="quantity" data-pa-item-qty value="1">
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
        <input name="proposal_group" value="next_year_workshops">
        <input name="item_display_mode" value="single">
        <input name="item_source_pricing_key" value="">
        <input name="bundle_pricing_key" value="">
        <input name="item_selected_bundle_items" value="[]">
      </article>
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

test('a dynamically injected bundle workshop reaches the native handler by activity name, then restores its exact option identity and price', () => {
  const dom = new JSDOM(formHtml(), { url: 'http://localhost/' });
  const previousEvent = globalThis.Event;
  globalThis.Event = dom.window.Event;
  try {
    const form = dom.window.document.querySelector('[data-pa-form]');
    const row = form.querySelector('[data-pa-item-row]');
    const select = row.querySelector('[data-pa-pricing-select]');
    let nativeValue = '';

    form.addEventListener('change', (event) => {
      nativeValue = event.target.value;
      row.querySelector('[name="item_name"]').value = nativeValue;
      row.querySelector('[name="item_type"]').value = 'סדנה';
      row.querySelector('[name="item_display_mode"]').value = 'bundle_parent';
      row.querySelector('[data-pa-item-price]').value = '500';
    });

    const restore = bridgeNextYearPricingSelection(row);
    assert.equal(typeof restore, 'function');
    assert.equal(select.value, 'סדנאות STEM');

    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.equal(nativeValue, 'סדנאות STEM');

    restore();
    assert.equal(select.value, optionValue);
    assert.equal(row.querySelector('[name="pricing_option_key"]').value, optionValue);
    assert.equal(row.querySelector('[name="item_name"]').value, 'סדנאות STEM');
    assert.equal(row.querySelector('[name="item_display_mode"]').value, 'bundle_parent');
    assert.equal(row.querySelector('[data-pa-item-price]').value, '650');
    assert.equal(form.querySelector('[data-pa-group-total="next_year_workshops"]').textContent, '₪ 650');
    assert.equal(form.querySelector('[data-pa-grand-total]').textContent, '₪ 650');
  } finally {
    globalThis.Event = previousEvent;
  }
});
