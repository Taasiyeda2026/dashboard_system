import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.FINANCE_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.pathname !== '/codex_finance_test') {
    throw Error('Only the disposable localhost codex_finance_test database is allowed');
  }
}
const db = url ? new pg.Client({ connectionString: url }) : null;
const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const gefen = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const migration = '../supabase/migrations/20261102191847_finance_gefen_course_monthly_minimum.sql';
const check = (name, fn) => test(name, { skip: !db }, fn);
async function rows(at = '2026-12-01T00:00:00+02:00') {
  return (await db.query("select finance_private.billing_rows(a,null,$1) rows from activities a where row_id='a'", [at])).rows[0].rows;
}
const month = (rows, value, funder = gefen) => rows.find(row => row.period === value && row.fundingSourceId === funder);

before(async () => {
  if (!db) return;
  await db.connect();
  await db.query('drop schema if exists finance_private cascade; drop schema if exists public cascade; drop schema if exists auth cascade; create schema public');
  await db.query(await read('./fixtures/finance-billing-schema.sql'));
  await db.query("alter table activities add activity_type text default 'course', add activity_season text default 'school_2027'");
  for (const name of ['20260821190000_finance_transaction_accounts', '20260821203000_finance_transaction_issuance_modes']) {
    await db.query(await read(`../supabase/migrations/${name}.sql`));
  }
  await db.query('alter function reserve_finance_transaction_account(uuid,date,text,text,text,jsonb) rename to reserve_finance_transaction_account_legacy_impl');
  for (const name of ['20261029222210_finance_funder_billing', '20261029224142_finance_receipts_manual_accounts',
    '20261030044100_finance_single_funder_price_fallback', '20261030051500_finance_optional_customer_identifier',
    '20261101192545_finance_service_quantity_snapshots']) {
    await db.query(await read(`../supabase/migrations/${name}.sql`));
  }
  await db.query(await read(migration));
});
after(async () => { if (db) await db.end(); });
beforeEach(async () => {
  if (!db) return;
  await db.query(`truncate finance_private.payment_operations,finance_audit_events,finance_receipt_allocations,finance_receipts,
    finance_billing_claims,finance_transaction_account_meetings,finance_transaction_account_lines,finance_private.dispatch_leases,
    finance_transaction_accounts,activity_funding_sources,activities,schools,authorities,funding_sources,course_meeting_cancellations;
    select set_config('test.uid','44444444-4444-4444-8444-444444444444',false),set_config('test.app_role','admin',false),set_config('test.role','authenticated',false);
    insert into schools values(1,'123'); insert into authorities values(1,'רשות א');
    insert into funding_sources values('${gefen}','גפ״ן'),('${other}','רשות');
    insert into activities(id,row_id,school_id,authority_id,school,activity_name,funding,price,sessions,status,date_1,date_2,date_3,date_4)
    values(1,'a',1,1,'מוסד','קורס','גפן',4000,'4','פתוח','2026-10-01','2026-10-20','2026-11-01','2026-12-01');
    insert into activity_funding_sources values(1,'${gefen}',4000);`);
});

check('two October slots defer into November with the third slot and retain original dates', async () => {
  const all = await rows();
  const october = month(all, '2026-10-01'), november = month(all, '2026-11-01');
  assert.equal(october.completedCount, 2);
  assert.equal(october.eligible, false);
  assert.equal(october.eligibilityStatus, 'waiting_three_meetings');
  assert.equal(october.issuableAmount, 0);
  assert.equal(november.completedCount, 3);
  assert.equal(november.eligible, true);
  assert.equal(november.issuableAmount, 3000);
  assert.deepEqual(november.unbilledSlots.map(s => [s.slot, s.date]), [[1,'2026-10-01'],[2,'2026-10-20'],[3,'2026-11-01']]);
});

check('late reruns never make October eligible using a November meeting', async () => {
  for (const at of ['2026-11-02T12:00:00Z','2027-02-01T00:00:00Z']) {
    const row = month(await rows(at), '2026-10-01');
    assert.equal(row.completedCount, 2);
    assert.equal(row.eligible, false);
  }
});

check('two slots in October and a third in December stay deferred through November', async () => {
  await db.query("update activities set date_3='2026-12-01',date_4=null");
  assert.equal(month(await rows('2027-01-01T00:00:00Z'), '2026-12-01').issuableAmount, 3000);
  assert.ok((await rows()).filter(r => r.gefenFunding).every(r => !r.eligible));
});

check('cancelled or not-held calendar dates never contribute even with duplicate cancellation markers', async () => {
  await db.query("insert into course_meeting_cancellations values('a','2026-10-20'),('a','2026-10-20')");
  const row = month(await rows(), '2026-11-01');
  assert.equal(row.completedCount, 2);
  assert.equal(row.eligible, false);
});

check('slot identity preserves separate same-day meetings without attendance records', async () => {
  await db.query("update activities set date_1='2026-10-10',date_2='2026-10-10',date_3='2026-10-10',date_4=null");
  const row = month(await rows(), '2026-10-01');
  assert.equal(row.completedCount, 3);
  assert.deepEqual(row.unbilledSlots.map(s => s.slot), [1,2,3]);
  assert.equal(row.eligible, true);
});

check('missing dates and today are excluded; calendar date boundaries use Israel time', async () => {
  await db.query("update activities set date_3='2026-11-01',date_4=null,end_time='00:00'");
  assert.equal(month(await rows('2026-11-01T21:59:59Z'), '2026-11-01').completedCount, 2);
  assert.equal(month(await rows('2026-11-01T22:00:00Z'), '2026-11-01').completedCount, 3);
});

check('workshops and non-Gefen courses keep their existing eligibility', async () => {
  await db.query("update activities set activity_type='workshop',sessions='1',date_2=null,date_3=null,date_4=null");
  assert.equal(month(await rows(), '2026-10-01').eligible, true);
  await db.query("update activities set activity_type='course',funding='רשות'");
  await db.query('update activity_funding_sources set funding_source_id=$1', [other]);
  const row = (await rows())[0];
  assert.equal(row.gefenFunding, false);
  assert.equal(row.eligible, true);
});

check('mixed funding gates only the Gefen share and keeps funding amounts separate', async () => {
  await db.query("update activities set funding='גפן + רשות',date_3=null,date_4=null,sessions='2'; update activity_funding_sources set amount=2000");
  await db.query('insert into activity_funding_sources values(1,$1,2000)',[other]);
  const all = await rows();
  assert.equal(all.find(r => r.gefenFunding).eligible, false);
  assert.equal(all.find(r => !r.gefenFunding).issuableAmount, 2000);
});

check('manual full-funding cannot bypass the historical selected-month minimum', async () => {
  await assert.rejects(db.query("select finance_private.manual_quote('a',$1,'2026-10-01','{\"billing_basis\":\"full_funding\"}')",[gefen]), /billing_blocked/);
});

check('full-funding finalization rechecks the selected calendar month after a cancellation', async () => {
  await db.query("update activities set date_1='2026-08-01',date_2='2026-08-20',date_3='2026-09-01',date_4=null");
  const draft = JSON.stringify({billing_basis:'full_funding'});
  const quote = (await db.query("select finance_private.manual_quote('a',$1,'2026-09-01',$2) q",[gefen,draft])).rows[0].q;
  const account = (await db.query("select (reserve_finance_manual_account($1,'a',$2,'2026-09-01',$3,$4)).*",
    [crypto.randomUUID(),gefen,draft,quote.revision])).rows[0];
  const token = crypto.randomUUID();
  await db.query("select set_config('test.role','service_role',false)");
  await db.query('select acquire_finance_dispatch($1,$2)',[account.id,token]);
  await db.query("insert into course_meeting_cancellations values('a','2026-09-01')");
  const finish = () => db.query("select finalize_finance_billing($1,$2,'original.pdf','hash','drive','folder','item','url')",[account.id,token]);
  await assert.rejects(finish(),/stale_billing_reservation/);
  await db.query("delete from course_meeting_cancellations where activity_id='a'");
  await finish();
  assert.equal((await db.query('select document_status from finance_transaction_accounts where id=$1',[account.id])).rows[0].document_status,'issued');
});

check('reservation and finalization retain history and repeated issuance cannot double bill carried slots', async () => {
  await db.query("update activities set date_1='2026-08-01',date_2='2026-08-20',date_3='2026-09-01',date_4=null");
  const cutoff = (await db.query("select (date_trunc('month',now() at time zone 'Asia/Jerusalem')::date-1)::text value")).rows[0].value;
  const row = month(await rows(), '2026-09-01');
  const key = crypto.randomUUID();
  const args = [key,cutoff,JSON.stringify([{activity_row_id:'a',funding_source_id:gefen,performance_month:row.period,expected_amount:row.issuableAmount,meeting_slots:row.unbilledSlots.map(s=>s.slot),issue_mode:'automatic'}])];
  const reserve = () => db.query("select (reserve_finance_transaction_account($1,$2,'123','מוסד',null,$3)).*",args);
  const account = (await reserve()).rows[0];
  assert.equal((await reserve()).rows[0].id, account.id);
  const token = crypto.randomUUID();
  await db.query("select set_config('test.role','service_role',false)");
  await db.query('select acquire_finance_dispatch($1,$2)',[account.id,token]);
  await db.query("select finalize_finance_billing($1,$2,'original.pdf','hash','drive','folder','item','url')",[account.id,token]);
  const before = (await db.query('select row_to_json(h) snapshot from finance_transaction_accounts h where id=$1',[account.id])).rows[0].snapshot;
  assert.ok((await rows()).every(r => !r.eligible));
  assert.deepEqual((await db.query('select row_to_json(h) snapshot from finance_transaction_accounts h where id=$1',[account.id])).rows[0].snapshot,before);
  assert.equal((await db.query('select count(*)::int n from finance_billing_claims')).rows[0].n, 3);
  await db.query("select set_config('test.role','authenticated',false)");
  args[0] = crypto.randomUUID();
  await assert.rejects(reserve(),/billing_blocked/);
  await db.query("update activities set date_4='2026-10-01'");
  const next = month(await rows(), '2026-10-01');
  assert.equal(next.completedCount, 4, 'cumulative count includes previously billed meetings');
  assert.equal(next.issuableAmount, 1000);
  assert.deepEqual(next.unbilledSlots.map(s => s.slot), [4]);
  assert.deepEqual((await db.query('select row_to_json(h) snapshot from finance_transaction_accounts h where id=$1',[account.id])).rows[0].snapshot,before);
});
