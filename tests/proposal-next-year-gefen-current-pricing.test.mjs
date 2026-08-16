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
await import('../frontend/src/proposal-pdf-single-generation-hotfix.js');

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
  let caught = null;
  try {
    nextYearGefenApprovalItems(row, [savedItem], []);
  } catch (error) {
    caught = error;
  }
  assert.ok(caught);
  assert.match(caught.message, /לא נמצא מחיר גפ״ן עדכני לתוכנית רובוטיקה – מספר גפ״ן 777\. לא ניתן להפיק את האישור\./);
  assert.equal(caught.userMessage, caught.message, 'combined PDF catch should receive the detailed user-facing error');
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

test('mark-as-sent hotfix first saves the current-price combined PDF and reuses its snapshots', async () => {
  const runtime = await readFile(new URL('../frontend/src/proposal-pdf-single-generation-hotfix.js', import.meta.url), 'utf8');
  assert.match(runtime, /isNextYearCombinedProposal\(row\).*rowHasSavedPdf\(row\)/s);
  assert.match(runtime, /await assertCurrentGefenPricingAvailable\(row, api\)/);
  assert.match(runtime, /restorePopupGuard = dispatchPrintWithoutPopup\(temporaryPrintButton\)/);
  assert.match(runtime, /PREPARED_CURRENT_PRICE_SNAPSHOTS\.set\(proposalId/);
  assert.match(runtime, /documentHtmlSnapshot: currentHtml/);
  assert.match(runtime, /documentSnapshot: currentSnapshot/);
  assert.match(runtime, /lockAndSendWithCurrentGefenSnapshot/);
});

test('mark-as-sent keeps the async PDF generator popup-free until its delayed blank-tab reservation', async () => {
  const runtime = await readFile(new URL('../frontend/src/proposal-pdf-single-generation-hotfix.js', import.meta.url), 'utf8');
  const start = runtime.indexOf('function dispatchPrintWithoutPopup');
  const end = runtime.indexOf('\nfunction installRootGuard', start);
  const guard = runtime.slice(start, end);
  assert.match(guard, /function interceptedOpen\(url = '', target = '', \.\.\.args\)/);
  assert.match(guard, /!cleanText\(url\) && cleanText\(target\) === '_blank'/);
  assert.match(guard, /restore\(\);\s*return fakeWindow;/s);
  assert.match(guard, /restoreTimer = setTimeout\(restore, 15000\)/);
  assert.doesNotMatch(guard, /window\.open = \(\) => fakeWindow/);
});

test('normal summer and next-year mark-as-sent builds the final PDF in the background without opening it', async () => {
  const screen = await readFile(new URL('../frontend/src/screens/proposals-agreements.js', import.meta.url), 'utf8');
  const start = screen.indexOf('const openSendProposalDialog = async');
  const end = screen.indexOf('\n    const approvalRequests =', start);
  const sendFlow = screen.slice(start, end);
  assert.match(sendFlow, /requiredTemplateSectionsForRow\(freshRow\)/);
  assert.match(sendFlow, /createProposalFinalPdfFile|proposalHtmlToPdfBlob/);
  assert.match(sendFlow, /finalizeSentProposal\(freshRow, mergedItems/);
  assert.doesNotMatch(sendFlow, /openProposalFinalPdf|reservePdfWindow|window\.open/);
});
