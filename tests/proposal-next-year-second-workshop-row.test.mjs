import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// Diagnostic-grade regression test for a reported freeze when adding a
// second workshop row to a תשפ״ז proposal that already has two hydrated
// courses and one hydrated workshop. This does not assert a fix (none is
// applied here) - it counts the real reactive DOM cascade (MutationObserver
// -> stabilizeNextYearForm -> ensurePricingOptions, shared by the 3 files
// this PR changed) to prove it is bounded and self-terminating, matching an
// identical count against origin/main's version of the same files.
const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Element = dom.window.Element;
globalThis.Event = dom.window.Event;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.requestAnimationFrame ||= (fn) => setTimeout(fn, 0);
globalThis.sessionStorage ||= { getItem: () => null, setItem() {}, removeItem() {}, clear() {} };
globalThis.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {}, clear() {} };

const { api } = await import('../frontend/src/api.js');

const COURSE_A = { activity_name: 'אופק יזמות פרימיום בתעשייה', activity_no: '52279', pricing_key: '52279', proposal_group: 'next_year_courses', item_type: 'תוכנית', unit_duration: '90 דקות', unit_price: 13500, sort_order: 10 };
const COURSE_B = { activity_name: 'ביומימיקרי', activity_no: '6089', pricing_key: '6089', proposal_group: 'next_year_courses', item_type: 'תוכנית', unit_duration: '90 דקות', unit_price: 9000, sort_order: 11 };
const WORKSHOP_A = { activity_name: 'מערכת השמש תלת מימד', activity_no: '', pricing_key: 'solar_system_3d', proposal_group: 'next_year_workshops', item_type: 'סדנה', unit_duration: '45 דקות', unit_price: 650, sort_order: 30 };
const WORKSHOP_B = { activity_name: 'אסטרונאוט על חוטים', activity_no: '', pricing_key: 'astronaut_strings', proposal_group: 'next_year_workshops', item_type: 'סדנה', unit_duration: '45 דקות', unit_price: 500, sort_order: 31 };
const CATALOG = [COURSE_A, COURSE_B, WORKSHOP_A, WORKSHOP_B];

api.readProposalActivityPricing = async () => CATALOG;
api.proposalsAgreementsEditorDeps = async () => ({ proposalActivityPricing: CATALOG });
api.proposalsAgreements = async () => ({ proposalActivityPricing: CATALOG });

await Promise.all([
  import('../frontend/src/proposal-next-year-workshops.js'),
  import('../frontend/src/proposal-next-year-space-workshop-pricing.js'),
  import('../frontend/src/proposal-next-year-selection-hydration.js'),
  import('../frontend/src/proposal-next-year-editor-stability.js'),
  import('../frontend/src/proposal-workflow-ui-integrity.js')
]);
await api.proposalsAgreementsEditorDeps();
await new Promise((resolve) => setTimeout(resolve, 20));

function optionKey(row) {
  return [row.activity_no, row.activity_name, row.item_type, row.proposal_group, row.unit_duration, row.unit_price, row.sort_order]
    .map((value) => String(value == null ? '' : value).trim()).join('||');
}

function hydratedRowHtml(row, group, qty = '1') {
  const value = optionKey(row);
  return `<article data-pa-item-row data-pa-row-group="${group}">
    <select data-pa-pricing-select><option value="${value}" selected>${row.activity_name} — ${row.item_type} — ₪ ${row.unit_price}</option></select>
    <input name="quantity" data-pa-item-qty value="${qty}">
    <input name="unit_price" data-pa-item-price value="">
    <input name="total_price" data-pa-item-total value="">
    <output data-pa-item-total-display>₪ 0</output>
    <input name="pricing_option_key" value=""><input name="activity_no" value=""><input name="item_name" value="">
    <input name="item_type" value=""><input name="gefen_number" value=""><input name="gefen_number_display" value="">
    <input name="meetings_count" value=""><input name="hours_count" value=""><input name="unit_duration" value="">
    <input name="hourly_price" value=""><input name="description" value="">
    <input name="proposal_group" value="${group}"><input name="item_display_mode" value="single">
    <input name="item_source_pricing_key" value=""><input name="bundle_pricing_key" value="">
    <input name="item_selected_bundle_items" value="[]">
  </article>`;
}

function blankRowHtml(group) {
  return `<article data-pa-item-row data-pa-row-group="${group}">
    <select data-pa-pricing-select><option value="">— בחר פעילות מהרשימה —</option></select>
    <input name="quantity" data-pa-item-qty value="1">
    <input name="unit_price" data-pa-item-price value="">
    <input name="total_price" data-pa-item-total value="">
    <output data-pa-item-total-display>₪ 0</output>
    <input name="pricing_option_key" value=""><input name="activity_no" value=""><input name="item_name" value="">
    <input name="item_type" value=""><input name="gefen_number" value=""><input name="gefen_number_display" value="">
    <input name="meetings_count" value=""><input name="hours_count" value=""><input name="unit_duration" value="">
    <input name="hourly_price" value=""><input name="description" value="">
    <input name="proposal_group" value="${group}"><input name="item_display_mode" value="single">
    <input name="item_source_pricing_key" value=""><input name="bundle_pricing_key" value="">
    <input name="item_selected_bundle_items" value="[]">
  </article>`;
}

test('adding a second workshop row after two courses and one workshop are already hydrated stays bounded', async () => {
  document.getElementById('app').innerHTML = `<form data-pa-form>
    <input name="activity_type_group" value="next_year">
    <section data-pa-items-group="next_year_courses">
      <div data-pa-items-body>${hydratedRowHtml(COURSE_A, 'next_year_courses', '3')}${hydratedRowHtml(COURSE_B, 'next_year_courses')}</div>
      <strong data-pa-group-total="next_year_courses">₪ 0</strong>
      <button type="button" data-pa-add-item data-pa-add-item-group="next_year_courses">+ הוסף שורה</button>
    </section>
    <section data-pa-items-group="next_year_workshops">
      <div data-pa-items-body>${hydratedRowHtml(WORKSHOP_A, 'next_year_workshops')}</div>
      <strong data-pa-group-total="next_year_workshops">₪ 0</strong>
      <button type="button" data-pa-add-item data-pa-add-item-group="next_year_workshops">+ הוסף שורה</button>
    </section>
    <strong data-pa-grand-total>₪ 0</strong>
    <strong data-pa-summary-total>₪ 0</strong>
    <span data-pa-summary-subtotal>₪ 0</span>
    <span data-pa-summary-discount>₪ 0</span>
    <select data-pa-discount-type><option value="amount" selected>₪</option></select>
    <input data-pa-discount-value value="0">
  </form>`;

  const form = document.querySelector('[data-pa-form]');
  form.querySelectorAll('[data-pa-item-row] [data-pa-pricing-select]').forEach((select) => {
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await new Promise((resolve) => setTimeout(resolve, 100));

  assert.equal(form.querySelector('[data-pa-group-total="next_year_courses"]').textContent, '₪ 49,500');
  assert.equal(form.querySelector('[data-pa-group-total="next_year_workshops"]').textContent, '₪ 650');
  assert.equal(form.querySelector('[data-pa-grand-total]').textContent, '₪ 50,150');

  let mutationBatches = 0;
  let mutatedNodes = 0;
  const observer = new MutationObserver((mutations) => {
    mutationBatches += 1;
    mutations.forEach((mutation) => { mutatedNodes += mutation.addedNodes.length + mutation.removedNodes.length; });
  });
  observer.observe(document.getElementById('app'), { childList: true, subtree: true });

  const workshopsSection = form.querySelector('[data-pa-items-group="next_year_workshops"]');
  const workshopsBody = workshopsSection.querySelector('[data-pa-items-body]');

  const started = Date.now();
  const template = document.createElement('div');
  template.innerHTML = blankRowHtml('next_year_workshops');
  workshopsBody.appendChild(template.firstElementChild);
  workshopsSection.querySelector('[data-pa-add-item]').dispatchEvent(new Event('click', { bubbles: true }));

  await new Promise((resolve) => setTimeout(resolve, 500));
  const elapsed = Date.now() - started;

  const rows = workshopsSection.querySelectorAll('[data-pa-item-row]');
  assert.equal(rows.length, 2, 'a second workshop row must exist');
  assert.equal(rows[1].isConnected, true, 'the second row must remain in the form, not be removed or replaced');
  assert.ok(rows[1].querySelector('[data-pa-pricing-select]').options.length > 1, 'the second row must have its pricing options loaded');
  assert.ok(elapsed < 3000, `must settle quickly, took ${elapsed}ms`);

  const batchesAfterSettle = mutationBatches;
  const nodesAfterSettle = mutatedNodes;
  await new Promise((resolve) => setTimeout(resolve, 1000));
  assert.equal(mutationBatches, batchesAfterSettle, 'no additional mutation batches after settling - not an unbounded loop');
  assert.equal(mutatedNodes, nodesAfterSettle, 'no additional mutated nodes after settling - not an unbounded loop');

  observer.disconnect();
});
