import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const screenUrl = new URL('../frontend/src/screens/proposals-agreements.js', import.meta.url);
const { settleProposalApprovalStep } = await import(screenUrl);

const regressionFixtures = [
  { quote_number: '10214', client_authority: 'רשות אשכול', school_framework: 'שחר אשכול', items: [{ item_name: 'פעילות גפ״ן' }] },
  { quote_number: '10219', client_authority: 'שדרות', school_framework: 'דרור', items: [{ item_name: 'פעילות א' }, { item_name: 'פעילות ב' }, { item_name: 'פעילות ג' }] }
];

test('approval step accepts the one-item and multi-item 10214/10219 structures', async () => {
  for (const fixture of regressionFixtures) {
    let calls = 0;
    const result = await settleProposalApprovalStep(Promise.resolve({ ok: true, items: fixture.items }), 'שמירת פריטי ההצעה', 25);
    calls += 1;
    assert.equal(result.items.length, fixture.items.length);
    assert.equal(calls, 1);
  }
});

test('approval step exposes proposal and item failures instead of swallowing them', async () => {
  await assert.rejects(settleProposalApprovalStep(Promise.reject(new Error('שמירת ההצעה נכשלה')), 'שמירת ההצעה', 25), /שמירת ההצעה נכשלה/);
  await assert.rejects(settleProposalApprovalStep(Promise.resolve({ ok: false, message: 'שמירת פריטי ההצעה נכשלה' }), 'שמירת פריטי ההצעה', 25), /שמירת פריטי ההצעה נכשלה/);
});

test('a hung approval promise has a finite timeout', async () => {
  await assert.rejects(settleProposalApprovalStep(new Promise(() => {}), 'שליחת ההצעה לאישור', 5), /לא הושלם בזמן/);
});

test('submission source enforces single flight and ordered draft-items-status writes', async () => {
  const source = await readFile(screenUrl, 'utf8');
  assert.match(source, /if \(form\.dataset\.saving === 'yes'\) return;/);
  assert.match(source, /payload\.status = \(approvingWithSignature \|\| submittingForApproval\) \? 'draft' : targetStatus;/);
  const saveStart = source.indexOf("'שמירת ההצעה'");
  const itemsStart = source.indexOf("'שמירת פריטי ההצעה'", saveStart);
  const statusStart = source.indexOf("api.updateProposalAgreementStatus(savedId, 'pending_approval')", itemsStart);
  assert.ok(saveStart > 0 && itemsStart > saveStart && statusStart > itemsStart);
  assert.match(source, /finally \{[\s\S]*form\.dataset\.saving = '';[\s\S]*b\.disabled = false;/);
  assert.doesNotMatch(source, /MutationObserver[\s\S]{0,300}saveForm/);
});
