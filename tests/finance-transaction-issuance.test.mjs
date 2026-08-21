import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  TRANSACTION_MODE_AUTOMATIC,
  TRANSACTION_MODE_MANUAL,
  buildTransactionPreview,
  financePaymentDueDate,
  hasGefenFunding,
  transactionActivitySummary
} from '../frontend/src/screens/finance-transaction-accounts.js';

const activity = (extra = {}) => ({
  row_id: 'a1',
  school: 'אלון',
  semel_mosad: '123456',
  activity_name: 'חלל',
  activity_no: '57651',
  funding: 'גפן',
  price: 9000,
  sessions: '10',
  date_1: '2026-10-01',
  date_2: '2026-10-02',
  date_3: '2026-12-01',
  contact_email: 'school@example.org',
  ...extra
});

test('Gefen detection includes mixed funding and common quote spellings', () => {
  assert.equal(hasGefenFunding('גפן'), true);
  assert.equal(hasGefenFunding('גפ"ן'), true);
  assert.equal(hasGefenFunding('גפ״ן + ויצו'), true);
  assert.equal(hasGefenFunding('רמי שני + גפן'), true);
  assert.equal(hasGefenFunding('רשות'), false);
});

test('automatic mode is Gefen-only and keeps the three-meeting threshold', () => {
  const twoGefen = transactionActivitySummary(activity(), { cutoff: '2026-10-31', mode: TRANSACTION_MODE_AUTOMATIC });
  const threeGefen = transactionActivitySummary(activity({ date_3: '2026-10-03' }), { cutoff: '2026-10-31', mode: TRANSACTION_MODE_AUTOMATIC });
  const otherFunding = transactionActivitySummary(activity({ funding: 'רשות', date_3: '2026-10-03' }), { cutoff: '2026-10-31', mode: TRANSACTION_MODE_AUTOMATIC });
  assert.equal(twoGefen.eligible, false);
  assert.equal(threeGefen.eligible, true);
  assert.equal(otherFunding.eligible, false);
});

test('manual mode allows any funding source with at least one performed-unbilled meeting', () => {
  const manual = transactionActivitySummary(activity({ funding: 'רשות' }), { cutoff: '2026-10-31', mode: TRANSACTION_MODE_MANUAL });
  assert.equal(manual.unbilledCount, 2);
  assert.equal(manual.eligible, true);
});

test('automatic preview includes mixed Gefen but excludes non-Gefen', () => {
  const preview = buildTransactionPreview([
    activity({ row_id: 'g1', funding: 'גפן + ויצו', date_3: '2026-10-03' }),
    activity({ row_id: 'r1', funding: 'רשות', date_3: '2026-10-03' })
  ], { cutoff: '2026-10-31', mode: TRANSACTION_MODE_AUTOMATIC });
  assert.equal(preview.accounts.length, 1);
  assert.equal(preview.accounts[0].lines.length, 1);
  assert.equal(preview.accounts[0].lines[0].activityRowId, 'g1');
});

test('grouped account collects unique activity contact emails', () => {
  const preview = buildTransactionPreview([
    activity({ row_id: 'a1', contact_email: 'one@example.org', date_3: '2026-10-03' }),
    activity({ row_id: 'a2', contact_email: 'two@example.org', date_3: '2026-10-03' })
  ], { cutoff: '2026-10-31', mode: TRANSACTION_MODE_AUTOMATIC });
  assert.deepEqual(preview.accounts[0].customerEmails.sort(), ['one@example.org', 'two@example.org']);
});

test('שוטף + 30 is end of issue month plus 30 calendar days', () => {
  assert.equal(financePaymentDueDate('2026-11-05'), '2026-12-30');
  assert.equal(financePaymentDueDate('2027-01-10'), '2027-03-02');
});

test('migration enforces automatic Gefen mode while preserving manual issuance for all funding', () => {
  const sql = fs.readFileSync('supabase/migrations/20260821203000_finance_transaction_issuance_modes.sql', 'utf8');
  assert.match(sql, /issue_mode text not null default 'manual'/);
  assert.match(sql, /finance_is_gefen_funding/);
  assert.match(sql, /automatic_requires_gefen/);
  assert.match(sql, /v_issue_mode='automatic'[\s\S]*minimum_three_meetings/);
  assert.match(sql, /funding_snapshot/);
  assert.match(sql, /payment_due_date/);
});

test('PDF is fixed to the approved Site9 transaction folder and includes payment instructions', () => {
  const source = fs.readFileSync('supabase/functions/finance-transaction-accounts/index.ts', 'utf8');
  assert.match(source, /b!AtuGFxdZBk6FLP0KPlKdH27mOwNzeTRErL1YKP0yl5EP6fDqQimqQ4QpOG6yQbMh/);
  assert.match(source, /01LT7GPE6FW7O7REM6WJBIXX6II2IDYTXM/);
  assert.match(source, /לתשלום עד/);
  assert.match(source, /בנק הפועלים סניף 611 חשבון 300120/);
  assert.match(source, /למוטב בלבד/);
  assert.doesNotMatch(source, /body\.driveId|body\.folderItemId/);
});

test('Outlook recipients come from account activity-contact snapshot and support multiple addresses', () => {
  const source = fs.readFileSync('supabase/functions/finance-transaction-accounts/index.ts', 'utf8');
  assert.match(source, /recipientAddresses\(account\.customer_email_snapshot\)/);
  assert.match(source, /toRecipients: recipients\.map/);
});
