import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { extractItemsFromForm, proposalsAgreementsScreen, runProposalApprovalSubmission } =
  await import('../frontend/src/screens/proposals-agreements.js');

const state = { user: { role: 'operation_manager', manage_proposals_agreements: true } };
const pricing = [
  { activity_no: '6089', activity_name: 'ביומימיקרי', item_type: 'קורס', proposal_group: 'gefen', unit_price: 9900, gefen_number: '6089' },
  { activity_no: '53828', activity_name: 'ביומימיקרי לחטיבה', item_type: 'קורס', proposal_group: 'gefen', unit_price: 9900, gefen_number: '53828' },
  { activity_no: '7000', activity_name: 'רובוטיקה', item_type: 'קורס', proposal_group: 'gefen', unit_price: 8500, gefen_number: '7000' }
];

function optionKey(row) {
  return [row.activity_no, row.activity_name, row.item_type, row.proposal_group, row.unit_duration, row.unit_price, row.sort_order]
    .map((value) => String(value ?? '').trim()).join('||');
}

function initializePricingLookup() {
  proposalsAgreementsScreen.render({ rows: [], proposalActivityPricing: pricing }, { state });
}

function proposalForm({ selected = '', hiddenKey = '', activityNo = '', itemName = '', manual = false } = {}) {
  const options = ['<option value="">— בחר פעילות מהרשימה —</option>', ...pricing.map((row) =>
    `<option value="${optionKey(row)}"${selected === optionKey(row) ? ' selected' : ''}>${row.activity_name}</option>`
  )].join('');
  const dom = new JSDOM(`<form data-pa-form>
    <select name="activity_type_group"><option value="gefen" selected>gefen</option></select>
    <article data-pa-item-row data-pa-row-group="gefen"${manual ? ' data-pa-manual-course="yes"' : ''}>
      <select name="pricing_activity_name" data-pa-pricing-select>${options}</select>
      <input name="pricing_option_key" value="${hiddenKey}"><input name="activity_no" value="${activityNo}">
      <input name="item_name" value="${itemName}"><input name="gefen_number" value="${activityNo}">
      <input name="proposal_group" value="gefen"><input name="quantity" value="1">
      <input name="unit_price" value="9900"><input data-pa-item-total name="total_price" value="9900">
      <input name="item_selected_bundle_items" value="[]">
    </article>
  </form>`);
  return { dom, form: dom.window.document.querySelector('form') };
}

test('new GEFEN proposal resolves Biomimicry from the selected catalog option before RPC persistence', async () => {
  initializePricingLookup();
  const { dom, form } = proposalForm({ selected: optionKey(pricing[0]) });
  const payload = { activity_type_group: 'gefen', gefen_number: '6089', _items: extractItemsFromForm(form) };
  const calls = [];
  await runProposalApprovalSubmission({
    items: payload._items,
    saveProposal: async () => ({ ok: true, row: { id: 'proposal-1' } }),
    saveItems: async (id, items) => { calls.push({ id, items }); return { ok: true }; },
    updateStatus: async () => ({ ok: true })
  });
  assert.equal(payload._items[0].item_name, 'ביומימיקרי');
  assert.equal(payload._items[0].gefen_number, '6089');
  assert.equal(payload._items[0].unit_price, 9900);
  assert.equal(calls[0].items[0].item_name, 'ביומימיקרי', 'the item RPC receives the canonical activity name');
  dom.window.close();
});

test('GEFEN middle-school Biomimicry resolves by activity number when the option key is absent', () => {
  initializePricingLookup();
  const { dom, form } = proposalForm({ activityNo: '53828' });
  assert.equal(extractItemsFromForm(form)[0].item_name, 'ביומימיקרי לחטיבה');
  dom.window.close();
});

test('the current catalog selection is used after replacing an unresolved previous selection', () => {
  initializePricingLookup();
  const { dom, form } = proposalForm({ selected: optionKey(pricing[2]), hiddenKey: 'removed-option' });
  const item = extractItemsFromForm(form)[0];
  assert.equal(item.item_name, 'רובוטיקה');
  assert.equal(item.pricing_option_key, optionKey(pricing[2]));
  assert.equal(item.activity_no, '7000');
  dom.window.close();
});

test('an explicitly entered manual row name remains unchanged', () => {
  initializePricingLookup();
  const { dom, form } = proposalForm({ itemName: 'פעילות מותאמת אישית', manual: true });
  assert.equal(extractItemsFromForm(form)[0].item_name, 'פעילות מותאמת אישית');
  dom.window.close();
});

test('a row without a real catalog selection remains blocked', async () => {
  initializePricingLookup();
  const { dom, form } = proposalForm();
  await assert.rejects(runProposalApprovalSubmission({ items: extractItemsFromForm(form) }), /חסר שם פעילות בשורה 1/);
  dom.window.close();
});
