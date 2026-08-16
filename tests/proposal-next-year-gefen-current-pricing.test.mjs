import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
if (!globalThis.sessionStorage) {
  const values = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
}
if (!globalThis.localStorage) globalThis.localStorage = globalThis.sessionStorage;
const { gefenApprovalDocumentHtml, nextYearGefenApprovalItems } = await import(
  '../frontend/src/screens/proposals-agreements.js'
);

const row = { activity_type_group: 'next_year', semel_mosad: '123', quote_number: '42' };
const savedItem = Object.freeze({
  item_name: 'רובוטיקה', proposal_group: 'next_year_courses', gefen_number: '777',
  meetings_count: 8, hours_count: 10, hourly_price: 850, quantity: 1,
  unit_price: 8500, total_price: 8500
});
const current = (price) => [{
  gefen_number: '777', meetings_count: 9, hours_count: 12,
  hourly_price: price / 12, total_price: price
}];

test('next_year GEFEN approval uses current pricing without changing the historical quote item', () => {
  const approvalItems = nextYearGefenApprovalItems(row, [savedItem], current(9000));
  assert.equal(savedItem.total_price, 8500);
  assert.equal(approvalItems[0].total_price, 9000);
  assert.equal(approvalItems[0].item_name, 'רובוטיקה');
  assert.equal(approvalItems[0].gefen_number, '777');
  assert.match(gefenApprovalDocumentHtml(row, approvalItems), /9,000/);
});

test('next_year GEFEN approval multiplies the current program price by group count', () => {
  const approvalItems = nextYearGefenApprovalItems(row, [{ ...savedItem, quantity: 2, total_price: 17000 }], current(9000));
  assert.equal(approvalItems[0].unit_price, 9000);
  assert.equal(approvalItems[0].total_price, 18000);
});

test('non-next_year approvals keep their saved pricing', () => {
  const legacy = { ...row, activity_type_group: 'gefen' };
  const approvalItems = nextYearGefenApprovalItems(legacy, [savedItem], current(9000));
  assert.equal(approvalItems[0].total_price, 8500);
});

test('missing current GEFEN number blocks generation with the program-specific message', () => {
  assert.throws(
    () => nextYearGefenApprovalItems(row, [savedItem], []),
    /לא נמצא מחיר גפ״ן עדכני לתוכנית רובוטיקה – מספר גפ״ן 777\. לא ניתן להפיק את האישור\./
  );
});

test('regeneration reflects a later catalog price', () => {
  assert.equal(nextYearGefenApprovalItems(row, [savedItem], current(9000))[0].total_price, 9000);
  assert.equal(nextYearGefenApprovalItems(row, [savedItem], current(9500))[0].total_price, 9500);
  assert.equal(savedItem.total_price, 8500);
});

test('approval generation reads only and never updates proposal_agreement_items', async () => {
  const screen = await readFile(new URL('../frontend/src/screens/proposals-agreements.js', import.meta.url), 'utf8');
  const api = await readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
  const currentPricingMethod = api.match(/readCurrentGefenCourses:[\s\S]*?\n  },\n  readProposalActivityPricing:/)?.[0] || '';
  assert.match(currentPricingMethod, /\.from\('proposal_gefen_courses'\)/);
  assert.doesNotMatch(currentPricingMethod, /\.update\(|proposal_agreement_items/);
  assert.match(screen, /\[GEFEN approval items load failed\]/);
  assert.match(screen, /showToast\('טעינת פריטי הצעת המחיר נכשלה\. לא ניתן להפיק את אישור גפ״ן\.'/);
});
