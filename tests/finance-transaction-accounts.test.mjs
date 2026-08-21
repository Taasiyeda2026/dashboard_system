import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  activityMeetingSlots,
  buildTransactionPreview,
  financeCycleCutoff,
  transactionActivitySummary,
  transactionDraftContent
} from '../frontend/src/screens/finance-transaction-accounts.js';

const activity = (count, extra = {}) => ({
  row_id: extra.row_id || 'a1',
  school: 'אלון',
  semel_mosad: '123',
  activity_name: 'חלל',
  activity_no: '57651',
  price: 9000,
  sessions: String(count),
  ...Object.fromEntries(Array.from({ length: count }, (_, i) => [`date_${i + 1}`, `2026-10-${String(i + 1).padStart(2, '0')}`])),
  ...extra
});
const summary = (count, opts = {}) => transactionActivitySummary(activity(count, opts.activity), { cutoff: '2026-10-31', ...opts });

test('monthly cutoff is previous month end in business timezone', () => {
  assert.equal(financeCycleCutoff(new Date('2027-01-05T12:00:00Z')), '2026-12-31');
});

test('two completed meetings are deferred while activity is still running', () => {
  assert.equal(transactionActivitySummary(activity(3, { date_3: '2026-12-01' }), { cutoff: '2026-10-31' }).eligible, false);
});

test('three meetings are eligible and each is 1.5 hours', () => {
  assert.deepEqual([summary(3).eligible, summary(3).unbilledHours], [true, 4.5]);
});

test('deferred meetings accumulate and all four bill', () => assert.equal(summary(4).unbilledCount, 4));

test('deferred activity still exposes performed-unbilled monetary value', () => {
  const s = transactionActivitySummary(activity(3, { date_3: '2026-12-01' }), { cutoff: '2026-10-31' });
  assert.equal(s.eligible, false);
  assert.equal(s.issuableAmount, 0);
  assert.equal(s.amount, 6000);
  assert.equal(s.unbilledAmount, 6000);
});

test('cancelled meeting is excluded without changing the planned-price denominator', () => {
  const s = summary(4, { cancelledDates: ['2026-10-02'] });
  assert.equal(s.unbilledCount, 3);
  assert.equal(s.hourlyRate, 1500);
  assert.equal(s.amount, 6750);
});

test('future meeting is excluded from completed', () => {
  assert.equal(transactionActivitySummary(activity(4, { date_4: '2026-12-01' }), { cutoff: '2026-10-31' }).unbilledCount, 3);
});

test('same-day meeting is not completed before end_time and is completed afterwards', () => {
  const a = activity(3, { date_1: '2026-10-05', date_2: '2026-10-04', date_3: '2026-10-03', end_time: '12:00' });
  const before = transactionActivitySummary(a, { cutoff: '2026-10-05', now: new Date('2026-10-05T07:00:00Z') });
  const after = transactionActivitySummary(a, { cutoff: '2026-10-05', now: new Date('2026-10-05T10:30:00Z') });
  assert.equal(before.completedCount, 2);
  assert.equal(after.completedCount, 3);
});

test('duplicate same-day date slots remain distinct meetings', () => {
  const a = activity(3, { date_1: '2026-10-01', date_2: '2026-10-01', date_3: '2026-10-02' });
  assert.deepEqual(activityMeetingSlots(a).map((row) => [row.slot, row.date]), [[1, '2026-10-01'], [2, '2026-10-01'], [3, '2026-10-02']]);
  assert.equal(transactionActivitySummary(a, { cutoff: '2026-10-31' }).unbilledCount, 3);
});

test('legacy billed dates behave as a multiset for duplicate same-day slots', () => {
  const a = activity(3, { date_1: '2026-10-01', date_2: '2026-10-01', date_3: '2026-10-02' });
  const s = transactionActivitySummary(a, { cutoff: '2026-10-31', billedDates: ['2026-10-01'] });
  assert.equal(s.billedCount, 1);
  assert.equal(s.unbilledCount, 2);
});

test('explicit billed meeting slot is excluded', () => assert.equal(summary(4, { billedSlots: [1] }).unbilledCount, 3));

test('finished activity gets closing bill for remaining meetings', () => {
  const s = summary(4, { billedSlots: [1, 2], billedAmount: 4500 });
  assert.equal(s.closingBill, true);
  assert.equal(s.unbilledCount, 2);
  assert.equal(s.amount, 4500);
});

test('activities for one institution produce one account', () => {
  assert.equal(buildTransactionPreview([activity(3), activity(4, { row_id: 'a2' })], { cutoff: '2026-10-31' }).accounts.length, 1);
});

test('ineligible activity is omitted while eligible peer remains', () => {
  const p = buildTransactionPreview([activity(3, { date_3: '2026-12-01' }), activity(3, { row_id: 'a2' })], { cutoff: '2026-10-31' });
  assert.deepEqual([p.accounts[0].lines.length, p.deferred.length], [1, 1]);
});

test('hourly rate prefers activities.sessions even when only some dates are scheduled', () => {
  const a = activity(4, { sessions: '10', price: 9000 });
  const s = transactionActivitySummary(a, { cutoff: '2026-10-31' });
  assert.equal(s.plannedCount, 10);
  assert.equal(s.hourlyRate, 600);
});

test('hourly rate falls back to populated date slots when sessions is missing', () => {
  const a = activity(10, { sessions: '' });
  assert.equal(transactionActivitySummary(a, { cutoff: '2026-10-31' }).hourlyRate, 600);
});

test('final bill corrects cumulative rounding to exact activity price when nothing was cancelled', () => {
  assert.equal(summary(3, { billedSlots: [1, 2], billedAmount: 6000 }).amount, 3000);
});

test('closing bill does not redistribute a cancelled meeting value', () => {
  const s = summary(4, { cancelledDates: ['2026-10-02'] });
  assert.equal(s.closingBill, true);
  assert.equal(s.amount, 6750);
});

test('missing institution symbol is blocked', () => {
  assert.equal(summary(3, { activity: { semel_mosad: '' } }).blockedReason, 'חסר סמל מוסד');
});

test('Outlook draft has exact short body and no SharePoint link', () => {
  const d = transactionDraftContent(8525, 'אלון');
  assert.match(d.body, /מצורף חשבון עסקה מס׳ 8525/);
  assert.doesNotMatch(d.body, /sharepoint|http/i);
});

test('migration has sequence, Jerusalem issue date, immutable snapshots and slot-level uniqueness', () => {
  const sql = fs.readFileSync('supabase/migrations/20260821190000_finance_transaction_accounts.sql', 'utf8');
  assert.match(sql, /sequence[\s\S]*start with 8525/i);
  assert.match(sql, /Asia\/Jerusalem/);
  assert.match(sql, /meeting_slot smallint/);
  assert.match(sql, /unique \(activity_row_id, meeting_slot\)/);
  assert.match(sql, /unique \(idempotency_key, institution_symbol\)/);
  assert.match(sql, /activity_name_snapshot/);
});

test('server reservation recomputes sessions denominator and requires complete slot selection', () => {
  const sql = fs.readFileSync('supabase/migrations/20260821190000_finance_transaction_accounts.sql', 'utf8');
  assert.match(sql, /v_activity\.sessions::integer/);
  assert.match(sql, /meeting_slots/);
  assert.match(sql, /v_selected_slots is distinct from v_expected_slots/);
  assert.doesNotMatch(sql, /select distinct \(to_jsonb\(v_activity\).*date_/i);
});

test('generating reservations are hidden from normal finance read policies', () => {
  const sql = fs.readFileSync('supabase/migrations/20260821190000_finance_transaction_accounts.sql', 'utf8');
  assert.match(sql, /document_status <> 'generating'/);
  assert.match(sql, /cancel_generating_finance_transaction_account/);
});

test('finance can read cancellation facts and reserve falls back to activity contact email', () => {
  const sql = fs.readFileSync('supabase/migrations/20260821190000_finance_transaction_accounts.sql', 'utf8');
  assert.match(sql, /finance_course_meeting_cancellations_read/);
  assert.match(sql, /v_activity\.contact_email/);
});

test('finalize and Outlook state transitions are service-role only', () => {
  const sql = fs.readFileSync('supabase/migrations/20260821190000_finance_transaction_accounts.sql', 'utf8');
  assert.match(sql, /auth\.role\(\).*service_role/);
  assert.match(sql, /grant execute[\s\S]*finalize_finance_transaction_account[\s\S]*service_role/i);
});

test('PDF implementation embeds fonts, compact logo and text instead of screenshot/canvas', () => {
  const source = fs.readFileSync('supabase/functions/finance-transaction-accounts/index.ts', 'utf8');
  assert.match(source, /embedFont/);
  assert.match(source, /drawText/);
  assert.match(source, /embedPng/);
  assert.match(source, /logo1\.png/);
  assert.doesNotMatch(source, /html2canvas|screenshot/i);
});

test('SharePoint target is restricted to an allowed drive and verified as a folder', () => {
  const source = fs.readFileSync('supabase/functions/finance-transaction-accounts/index.ts', 'utf8');
  assert.match(source, /MS_SHAREPOINT_DRIVE_ID/);
  assert.match(source, /sharepoint_drive_not_allowed/);
  assert.match(source, /sharepoint_folder_not_allowed/);
});

test('SharePoint retry replaces same account file instead of failing on filename collision', () => {
  const source = fs.readFileSync('supabase/functions/finance-transaction-accounts/index.ts', 'utf8');
  assert.match(source, /conflictBehavior=replace/);
  assert.doesNotMatch(source, /conflictBehavior=fail/);
});

test('Edge uses service client for backend-only finalize and Outlook markers', () => {
  const source = fs.readFileSync('supabase/functions/finance-transaction-accounts/index.ts', 'utf8');
  assert.match(source, /admin\.rpc\("finalize_finance_transaction_account"/);
  assert.match(source, /admin\.rpc\("mark_finance_transaction_outlook"/);
});

test('Outlook failure is non-critical and draft-ready retry is idempotent', () => {
  const source = fs.readFileSync('supabase/functions/finance-transaction-accounts/index.ts', 'utf8');
  assert.match(source, /outlookStatus: "failed"/);
  assert.match(source, /accountId = clean\(body\.accountId\)/);
  assert.match(source, /account\.outlook_status === "draft_ready"/);
  assert.doesNotMatch(source, /sendMail/);
});
