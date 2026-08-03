import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// This test exercises the REAL installed document-level 'change' listener
// (not a direct call to hydrateNextYearPricingSelection), because the bug it
// guards against lives in the wiring between the listener and the screen's
// document-refresh path, not in the hydration function's own return value.
// jsdom globals must exist BEFORE the module is imported, since
// installNextYearSelectionHydration() attaches its listener as an import-time
// side effect keyed off globalThis.document.
//
// pretendToBeVisual is intentionally left off: it makes jsdom implement
// requestAnimationFrame via an internal MessagePort that jsdom never closes,
// which leaves the process alive after the test finishes. Nothing this test
// exercises needs it (scheduleTotals here uses setTimeout, not rAF).
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Element = dom.window.Element;
globalThis.Event = dom.window.Event;
globalThis.sessionStorage ||= { getItem: () => null, setItem() {}, removeItem() {}, clear() {} };
globalThis.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {}, clear() {} };

// api.js must be imported and stubbed BEFORE proposal-next-year-selection-hydration.js:
// installNextYearSelectionHydration() wraps whatever api.proposalsAgreementsEditorDeps
// happens to be at import time. Stubbing it afterward would replace that wrapper
// outright instead of chaining onto it, silently skipping the cache population.
const { api } = await import('../frontend/src/api.js');

const WORKSHOP = {
  activity_name: 'מערכת השמש תלת מימד', activity_no: '', pricing_key: 'solar_system_3d',
  proposal_group: 'next_year_workshops', item_type: 'סדנה', unit_duration: '45 דקות',
  unit_price: 650, sort_order: 30
};
api.proposalsAgreementsEditorDeps = async () => ({ proposalActivityPricing: [WORKSHOP] });

await import('../frontend/src/proposal-next-year-selection-hydration.js');
const {
  proposalPreviewBodyHtml,
  setProposalGroupLookups,
  extractItemsFromForm
} = await import('../frontend/src/screens/proposals-agreements.js');

// Matches the real "next_year" combined-group shape production Supabase data
// produces (verified indirectly: existing mixed-proposal E2E tests pass
// against real data, so this record must exist there with this shape).
setProposalGroupLookups({
  proposalActivityGroups: [
    { group_key: 'next_year', display_name: 'תשפ״ז', template_key: 'next_year', included_group_keys: ['next_year_courses', 'next_year_workshops'], is_active: true, sort_order: 200 },
    { group_key: 'next_year_courses', display_name: 'תשפ״ז (קורסים)', template_key: 'next_year', included_group_keys: [], is_active: true, show_gefen: true, is_internal: true, sort_order: 201 },
    { group_key: 'next_year_workshops', display_name: 'תשפ״ז (סדנאות)', template_key: 'next_year', included_group_keys: [], is_active: true, show_gefen: false, is_internal: true, sort_order: 202 }
  ]
}, [], []);

// Prime the pricing catalog cache through the now-wrapped API method (the
// same call the screen makes when the editor opens), so hydration resolves
// this workshop through the normal catalog match rather than the cache-miss
// fallback - that fallback path is covered separately in
// proposal-next-year-selection-hydration.test.mjs.
await api.proposalsAgreementsEditorDeps();

function optionKey(row) {
  return [row.activity_no, row.activity_name, row.item_type, row.proposal_group, row.unit_duration, row.unit_price, row.sort_order]
    .map((value) => String(value == null ? '' : value).trim()).join('||');
}

function formHtml() {
  const value = optionKey(WORKSHOP);
  return `<form data-pa-form>
    <input name="activity_type_group" value="next_year">
    <section data-pa-items-group="next_year_courses">
      <div data-pa-items-body></div>
      <strong data-pa-group-total="next_year_courses">₪ 0</strong>
    </section>
    <section data-pa-items-group="next_year_workshops">
      <div data-pa-items-body>
        <article data-pa-item-row data-pa-row-group="next_year_workshops">
          <select data-pa-pricing-select>
            <option value="">— בחר פעילות מהרשימה —</option>
            <option value="${value}">${WORKSHOP.activity_name} — סדנה — ₪ 650</option>
          </select>
          <input name="quantity" data-pa-item-qty value="1">
          <input name="unit_price" data-pa-item-price value="">
          <input name="total_price" data-pa-item-total value="">
          <output data-pa-item-total-display>₪ 0</output>
          <input name="pricing_option_key" value=""><input name="activity_no" value=""><input name="item_name" value="">
          <input name="item_type" value=""><input name="gefen_number" value=""><input name="gefen_number_display" value="">
          <input name="meetings_count" value=""><input name="hours_count" value=""><input name="unit_duration" value="">
          <input name="hourly_price" value=""><input name="description" value="">
          <input name="proposal_group" value="next_year_workshops"><input name="item_display_mode" value="single">
          <input name="item_source_pricing_key" value=""><input name="bundle_pricing_key" value="">
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
    <div data-pa-live-preview></div>
  </form>`;
}

test('selecting a 650 ₪ workshop rebuilds the live document preview exactly once, through the real event path', async () => {
  document.body.innerHTML = formHtml();
  const form = document.querySelector('[data-pa-form]');
  const select = form.querySelector('[data-pa-pricing-select]');
  const value = optionKey(WORKSHOP);

  // Stand-in for the screen's own generic form 'input' listener
  // (screens/proposals-agreements.js calcGrandTotal -> updateLivePreview ->
  // renderLivePreview), built from the SAME real, exported extraction and
  // rendering functions the screen itself uses - not hand-fed data.
  let refreshCount = 0;
  form.addEventListener('input', () => {
    refreshCount += 1;
    const items = extractItemsFromForm(form);
    const row = { id: '', activity_type_group: 'next_year', client_authority: 'x', client_name: 'y', proposal_date: '2026-08-03', status: 'draft' };
    form.querySelector('[data-pa-live-preview]').innerHTML = proposalPreviewBodyHtml(row, items, []);
  });

  assert.equal(form.querySelector('[data-pa-live-preview]').innerHTML, '', 'preview starts empty');

  // The real event path: a genuine 'change' dispatch through the actually
  // installed document-level listener (installNextYearSelectionHydration),
  // not a direct call to hydrateNextYearPricingSelection.
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));

  // Required fields must already be hydrated synchronously, before any
  // refresh fires: activity name, activity identifier (source pricing key),
  // unit price, quantity, and the row's own computed total.
  assert.equal(form.querySelector('[name="item_name"]').value, WORKSHOP.activity_name);
  assert.equal(form.querySelector('[name="item_source_pricing_key"]').value, WORKSHOP.pricing_key);
  assert.equal(form.querySelector('[data-pa-item-price]').value, '650');
  assert.equal(form.querySelector('[data-pa-item-qty]').value, '1');
  assert.equal(form.querySelector('[data-pa-item-total]').value, '650.00');
  assert.equal(form.querySelector('[data-pa-item-total-display]').textContent, '₪ 650');
  assert.equal(form.querySelector('[data-pa-group-total="next_year_workshops"]').textContent, '₪ 650');
  assert.equal(form.querySelector('[data-pa-grand-total]').textContent, '₪ 650');

  await new Promise((resolve) => setTimeout(resolve, 300));

  assert.equal(refreshCount, 1, 'the preview must rebuild exactly once, not repeatedly');
  const preview = form.querySelector('[data-pa-live-preview]');
  assert.match(preview.innerHTML, /pa-next-year-workshop-table/);
  assert.doesNotMatch(preview.innerHTML, /pa-next-year-course-table/);
  assert.match(preview.innerHTML, /מערכת השמש תלת מימד/);
  assert.match(preview.innerHTML, /650/);

  // Settling further must not trigger any additional, unbounded refresh cycle.
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(refreshCount, 1, 'no runaway refresh/calculation loop after settling');
});
