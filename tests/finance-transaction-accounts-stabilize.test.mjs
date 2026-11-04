import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { financeError } from '../frontend/src/screens/finance-errors.js';
import { displayGefenProgramNumber, transactionAccountsViewHtml } from '../frontend/src/screens/finance-transaction-issuance.js';
import { manualHourlyRate, prepareManualAccount } from '../frontend/src/screens/finance-manual-account.js';

const pdf = readFileSync(new URL('../supabase/functions/finance-transaction-accounts/index.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261104214003_finance_transaction_accounts_stabilize.sql', import.meta.url), 'utf8');
const errors = readFileSync(new URL('../frontend/src/screens/finance-errors.js', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../frontend/sw.js', import.meta.url), 'utf8');
const config = readFileSync(new URL('../frontend/src/config.js', import.meta.url), 'utf8');

test('mixed-funding Gefen PDF hourly uses funding_amount_snapshot share, never full course price', () => {
  assert.match(pdf, /const funderAmount = Number\(line\.funding_amount_snapshot\)/);
  assert.match(pdf, /funderAmount \/ \(plannedMeetings \* 1\.5\)/);
  assert.doesNotMatch(pdf, /activity_price_from_source \?\? line\.activity_price_snapshot/);
  assert.doesNotMatch(pdf, /fullPrice \/ \(plannedMeetings \* 1\.5\)/);
  // Example: 6000 / 10 / 1.5 = 400
  assert.equal(6000 / (10 * 1.5), 400);
  assert.equal(400 * 4.5, 1800);
});

test('Poratzot display alias maps 3604 to 52279 without rewriting source identity', () => {
  assert.equal(displayGefenProgramNumber({ gefenNumber: '3604' }), '52279');
  assert.equal(displayGefenProgramNumber({ gefenNumber: '3604', activityNo: '3604' }), '52279');
  assert.equal(displayGefenProgramNumber({ gefenNumber: '52279', activityNo: '52279' }), '52279');
  assert.equal(displayGefenProgramNumber({ gefenNumber: '3604', activityNo: '9545' }), '3604');
  assert.match(pdf, /return \{name: 'אופק פרימיום \(פורצות דרך\)', gefen: '52279'\}/);
  assert.match(pdf, /gefen !== '3604'/);
});

test('רוקחים עולם always displays Gefen 46091 even when a row was mis-tagged 52279', () => {
  assert.equal(displayGefenProgramNumber({ activityName: 'רוקחים עולם', gefenNumber: '52279', activityNo: '52279' }), '46091');
  assert.equal(displayGefenProgramNumber({ activityName: 'רוקחים עולם', gefenNumber: '46091' }), '46091');
  assert.equal(displayGefenProgramNumber({ activityName: 'אופק פרימיום', gefenNumber: '52279', activityNo: '52279' }), '52279');
  assert.match(pdf, /רוקחים\\s\*עולם/);
  assert.match(pdf, /gefen: '46091'/);
  const migration = readFileSync(new URL('../supabase/migrations/20261104220642_finance_rokhim_olam_gefen_46091_only.sql', import.meta.url), 'utf8');
  assert.match(migration, /activity_no = '46091'/);
  assert.match(migration, /gefen_number = '46091'/);
  assert.doesNotMatch(migration, /set[\s\S]*price\s*=/i);
  assert.doesNotMatch(migration, /sessions\s*=/);
  assert.doesNotMatch(migration, /funding\s*=/);
});

test('claims uniqueness and field-level stale reasons are enforced in stabilize migration', () => {
  assert.match(migration, /finance_billing_claims_settled_slot_unique/);
  assert.match(migration, /activity_row_id, funding_source_id, meeting_slot/);
  assert.match(migration, /where settles_meeting/);
  assert.match(migration, /finance_private\.raise_stale_billing/);
  assert.match(migration, /מספר המפגשים המתוכנן/);
  assert.match(migration, /מסגרת המימון/);
  assert.match(migration, /מפגשים לחיוב/);
});

test('stale and duplicate-claim client errors ask to refresh before reissue', () => {
  assert.match(financeError({ message: 'stale_billing_preview' }), /רענן את התצוגה/);
  assert.match(financeError({ message: 'נתוני החיוב השתנו (סכום לחיוב). יש לרענן את התצוגה המקדימה ולחשב מחדש לפני ההפקה.' }), /סכום לחיוב/);
  assert.match(financeError({ code: '23505', message: 'finance_billing_claims_settled_slot_unique' }), /כבר חויבו/);
  assert.match(errors, /finance_billing_claims_settled_slot_unique/);
});

test('history keeps טיוטה and עריכה without duplicate צפייה', () => {
  const data = {
    transactionTab: 'history',
    transactionContext: {
      billingRows: [],
      accounts: [{
        id: 'acc',
        transaction_account_number: 'Pl26000100',
        document_status: 'issued',
        sharepoint_web_url: 'https://example.test/pdf',
        finance_transaction_account_lines: []
      }]
    }
  };
  const view = transactionAccountsViewHtml(data, (title) => `<h1>${title}</h1>`);
  assert.match(view, />טיוטה</);
  assert.match(view, />עריכה</);
  assert.doesNotMatch(view, /פתח PDF|עריכה והפקה מחדש|צפייה/);
});

test('manual Gefen mixed funding hourly rate uses funder share over full activity price', () => {
  const d = {
    manualFunderFilter: 'school:1',
    collectionActivities: [{ row_id: 'mixed', school_id: 1, school: 'א', activity_name: 'פורצות דרך', activity_type: 'course', price: 12000, sessions: '10', activity_no: '3604' }],
    transactionContext: {
      billingRows: [{
        activityRowId: 'mixed', activityType: 'course', fundingSourceId: 'gefen', funding: 'גפן', gefenFunding: true,
        payerKey: 'school:1', payerName: 'א', institutionSymbol: '1', period: '2026-10-01',
        plannedCount: 10, plannedHours: 15, activityPrice: 12000, fundingAmount: 6000,
        unbilledCount: 3, unbilledHours: 4.5, issuableAmount: 1800, eligible: true, fullFundingAmount: 6000, fullFundingBlockedReason: ''
      }]
    }
  };
  prepareManualAccount(d, 'mixed');
  assert.equal(d.manualDraft.funding_amount, 6000);
  assert.equal(manualHourlyRate(d.manualDraft), 400);
  assert.equal(d.manualDraft.activity_price, 12000);
});

test('workshop PDF rows expose quantity without hourly columns', () => {
  assert.match(pdf, /serviceWidths, serviceRows/);
  assert.match(pdf, /\['שם בית הספר', 'סדנה \/ סיור', 'רשות', 'כמות', 'סה״כ'\]/);
  assert.doesNotMatch(pdf, /compactWidths, otherFunding/);
});

test('deployable frontend cache markers were bumped for this stabilize release', () => {
  assert.match(sw, /const CACHE_VERSION = 2089;/);
  assert.match(config, /finance-transaction-accounts-stabilize-20261104-v1/);
  assert.match(config, /finance-rokhim-olam-gefen-46091-20261104-v1/);
});
