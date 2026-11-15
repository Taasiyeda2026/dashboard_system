import test, {before, after, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import pg from 'pg';

// Never run this suite against a remote database, or dispatch an actual document.
const url = process.env.FINANCE_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['localhost','127.0.0.1'].includes(target.hostname) || target.pathname !== '/codex_finance_test') {
    throw Error('Only the disposable localhost codex_finance_test database is allowed');
  }
}
const db = url ? new pg.Client({connectionString:url}) : null;
const check = (name, fn) => test(name, {skip:!db}, fn);
const read = p => readFile(new URL(p, import.meta.url), 'utf8');
const gefen = '11111111-1111-4111-8111-111111111111';
const authority = '22222222-2222-4222-8222-222222222222';
const migration = '../supabase/migrations/20261115074632_finance_gefen_semimonthly_cutoff.sql';
async function at(value) { await db.query("select set_config('test.clock',$1,false)",[value]); }
async function rows() { return (await db.query("select finance_billing_preview(array['a']) r")).rows[0].r; }
const row = (rows, period, funder=gefen) => rows.find(r => r.period===period && r.fundingSourceId===funder);
async function reserve(r, key=crypto.randomUUID(), cutoff=r.billingCutoff, range=r.period) {
  return (await db.query("select (reserve_finance_transaction_account($1,$2,'123','ignored',null,$3)).*",[
    key,cutoff,JSON.stringify([{activity_row_id:'a',funding_source_id:r.fundingSourceId,
      performance_month:r.period,billing_range_end:range,meeting_slots:r.unbilledSlots.map(s=>s.slot),
      expected_amount:r.issuableAmount,issue_mode:r.gefenFunding?'automatic':'manual'}])])).rows[0];
}
async function finish(id) {
  const token=crypto.randomUUID();
  await db.query("select set_config('test.role','service_role',false)");
  await db.query('select acquire_finance_dispatch($1,$2)',[id,token]);
  await db.query('select validate_finance_dispatch($1,$2)',[id,token]);
  await db.query("select finalize_finance_billing($1,$2,'synthetic.pdf','testhash','test-drive','test-folder','test-item','https://example.test')",[id,token]);
  await db.query('select release_finance_dispatch($1,$2)',[id,token]);
  await db.query("select set_config('test.role','authenticated',false)");
}
before(async()=>{
  if(!db)return;await db.connect();
  await db.query('drop schema if exists finance_private cascade; drop schema if exists public cascade; drop schema if exists auth cascade; drop schema if exists net cascade; drop schema if exists vault cascade; drop schema if exists cron cascade; create schema public');
  await db.query(await read('./fixtures/finance-billing-schema.sql'));
  await db.query(`create function public.finance_test_now() returns timestamptz language sql stable as
    $$select coalesce(nullif(current_setting('test.clock',true),'')::timestamptz,pg_catalog.now())$$`);
  const load = async path => db.query((await read(path)).replaceAll('now()', 'public.finance_test_now()'));
  await db.query(`alter table activities add activity_type text default 'course',add activity_season text default 'school_2027',add school_contact_id bigint;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create table public.users(auth_user_id uuid primary key,email text,is_active boolean,role text,permissions jsonb);
    create function public.app_permission_parent(text) returns text language sql as $$select case when $1='manage_finance_transactions' then 'finance_access' end$$;
    create table contacts_schools(id bigint primary key,school_id bigint,authority_id bigint,client_type text,client_name text,email text,active text);
    create table contact_emails(contact_id bigint,email text,active boolean);
    create table finance_school_invoice_recipients(school_id bigint,recipient_email text,contact_id bigint);
    create schema net;create schema vault;create schema cron;create table cron.job(jobname text);create function cron.unschedule(text) returns boolean language sql as $$delete from cron.job where jobname=$1 returning true$$;
    create table vault.decrypted_secrets(name text,decrypted_secret text);
    insert into vault.decrypted_secrets values('quote_signature_reminder_project_url','https://local.example'),('quote_signature_reminder_anon_key','test-public-jwt');
    create table net.requests(id bigint generated always as identity,headers jsonb,body jsonb);
    create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as
      $$insert into net.requests(headers,body) values(headers,body) returning id$$;
    create function cron.schedule(text,text,text) returns bigint language sql as $$insert into cron.job values($1);select 1::bigint$$;`);
  for(const name of ['20260821190000_finance_transaction_accounts','20260821203000_finance_transaction_issuance_modes'])await load(`../supabase/migrations/${name}.sql`);
  await db.query('alter function reserve_finance_transaction_account(uuid,date,text,text,text,jsonb) rename to reserve_finance_transaction_account_legacy_impl');
  for(const name of ['20261029222210_finance_funder_billing','20261029224142_finance_receipts_manual_accounts',
    '20261030210000_finance_consolidated_funder_accounts','20261030044100_finance_single_funder_price_fallback','20261030051500_finance_optional_customer_identifier',
    '20261101192545_finance_service_quantity_snapshots','20261102191847_finance_gefen_course_monthly_minimum',
    '20261102202405_finance_automatic_outlook_drafts','20261103191835_finance_original_issuer_outlook_mailbox','20261103211803_finance_delegated_invoice_drafts','20261103221311_finance_manual_payer_first','20261103231056_finance_course_performance_hours','20261104000410_finance_invoice_history_revisions','20261105012836_finance_invoice_revision_ux_upgrade',
    '20261104223358_finance_transaction_accounts_stabilize','20261105095155_finance_consolidated_full_funding_period_lookup',
    '20261106090000_gefen_order_billing_matches','20261030014500_finance_school_2027_scope'])await load(`../supabase/migrations/${name}.sql`);
  await load(migration);
});
after(async()=>{if(db)await db.end();});
beforeEach(async()=>{
  if(!db)return;
  await at('2026-11-15T00:00:00+02:00');
  await db.query(`truncate finance_private.invoice_versions,finance_private.invoice_revisions,public.users,auth.users,finance_private.outlook_jobs,net.requests,finance_private.payment_operations,finance_audit_events,
    finance_receipt_allocations,finance_receipts,finance_billing_claims,finance_transaction_account_meetings,
    finance_transaction_account_lines,finance_private.dispatch_leases,finance_transaction_accounts,activity_funding_sources,
    finance_private.gefen_order_billing_matches,activities,schools,authorities,funding_sources,course_meeting_cancellations;
    select set_config('test.uid','44444444-4444-4444-8444-444444444444',false),set_config('test.app_role','admin',false),set_config('test.role','authenticated',false);
    insert into auth.users values('44444444-4444-4444-8444-444444444444','finance@example.test',now());
    insert into public.users values('44444444-4444-4444-8444-444444444444','finance@example.test',true,'admin','{}');
    insert into schools values(1,'123'); insert into authorities values(1,'רשות');
    insert into funding_sources values('${gefen}','גפ״ן'),('${authority}','רשות');
    insert into activities(id,row_id,school_id,authority_id,school,funding,price,sessions,activity_name,status,date_1,date_2,date_3,date_4,date_5,date_6)
    values(1,'a',1,1,'מוסד','גפן',6000,'6','קורס בדיקה','פתוח','2026-10-01','2026-10-10','2026-10-20','2026-11-05','2026-11-14','2026-11-18');
    insert into activity_funding_sources values(1,'${gefen}',6000);`);
});

check('Israel boundaries: 14→15, month end→1, year end and leap February',async()=>{
  for(const [time,cutoff] of [
    ['2026-11-14T21:59:59Z','2026-10-31'],['2026-11-14T22:00:00Z','2026-11-14'],
    ['2026-11-30T21:59:59Z','2026-11-14'],['2026-11-30T22:00:00Z','2026-11-30'],
    ['2026-12-31T22:00:00Z','2026-12-31'],['2027-01-14T22:00:00Z','2027-01-14'],
    ['2028-03-01T00:00:00+02:00','2028-02-29']]) {
    assert.equal((await db.query('select finance_private.gefen_cycle_cutoff($1)::text cutoff',[time])).rows[0].cutoff,cutoff);
  }
});
check('preview freezes slots and amounts until the next opening for all Gefen activity types',async()=>{
  await at('2026-11-14T23:59:59+02:00');
  assert.equal(row(await rows(),'2026-10-01').issuableAmount,3000);
  assert.ok(!(await rows()).some(r=>r.period==='2026-11-01' && r.eligible));
  await at('2026-11-15T00:00:00+02:00');
  const mid=row(await rows(),'2026-11-01');
  assert.equal(mid.issuableAmount,2000);assert.equal(mid.billingCutoff,'2026-11-14');
  assert.equal(mid.nextBillingUpdate,'2026-12-01');assert.deepEqual(mid.unbilledSlots.map(s=>s.slot),[4,5]);
  await at('2026-11-30T23:59:59+02:00');
  assert.deepEqual(row(await rows(),'2026-11-01'),mid);
  await at('2026-12-01T00:00:00+02:00');
  assert.equal(row(await rows(),'2026-11-01').issuableAmount,3000);
  assert.equal(row(await rows(),'2026-11-01').nextBillingUpdate,'2026-12-15');
  for(const type of ['workshop','tour']) {
    await db.query("update activities set activity_type=$1,sessions='1',date_1='2026-11-15',date_2=null,date_3=null,date_4=null,date_5=null,date_6=null",[type]);
    await at('2026-11-30T12:00:00+02:00');assert.ok((await rows()).every(r=>!r.eligible));
    await at('2026-12-01T00:00:00+02:00');assert.equal(row(await rows(),'2026-11-01').issuableAmount,6000);
  }
});
check('third cumulative meeting before cutoff unlocks arrears; after cutoff waits for next opening',async()=>{
  await db.query("update activities set date_3='2026-11-14',date_4=null,date_5=null,date_6=null");
  await at('2026-11-14T23:59:00+02:00');assert.ok((await rows()).every(r=>!r.eligible));
  await at('2026-11-15T00:00:00+02:00');
  let r=row(await rows(),'2026-11-01');assert.equal(r.issuableAmount,3000);assert.deepEqual(r.unbilledSlots.map(s=>s.slot),[1,2,3]);
  assert.equal(row(await rows(),'2026-10-01').eligible,false);
  await db.query("update activities set date_3='2026-11-15'");
  await at('2026-11-30T12:00:00+02:00');assert.ok((await rows()).every(r=>!r.eligible));
  await at('2026-12-01T00:00:00+02:00');assert.equal(row(await rows(),'2026-11-01').issuableAmount,3000);
});
check('two invoices in one issue month, then same performance month top-up: only new slots, retries and overlaps blocked',async()=>{
  await at('2026-11-01T00:00:00+02:00');
  const old=row(await rows(),'2026-10-01'),key=crypto.randomUUID();
  const first=await reserve(old,key);await finish(first.id);
  await db.query('select finance_record_receipt($1,$2,$3)',[crypto.randomUUID(),
    {funding_source_id:gefen,payer_name:'מוסד',activity_row_id:'a',amount:1000,received_date:'2026-11-01',reference:'synthetic-receipt'},
    JSON.stringify([{account_id:first.id,activity_row_id:'a',amount:1000}])]);
  const paymentsBefore=(await db.query(`select jsonb_build_object('receipts',(select jsonb_agg(to_jsonb(r)) from finance_receipts r),
    'allocations',(select jsonb_agg(to_jsonb(a)) from finance_receipt_allocations a)) value`)).rows[0].value;
  const snapshot=(await db.query('select to_jsonb(a) snapshot from finance_transaction_accounts a where id=$1',[first.id])).rows[0].snapshot;
  assert.equal((await reserve(old,key)).id,first.id);
  await assert.rejects(reserve(old),/billing_blocked/);
  await at('2026-11-15T00:00:00+02:00');
  const mid=row(await rows(),'2026-11-01');const second=await reserve(mid);await finish(second.id);
  assert.notEqual(second.id,first.id);assert.equal(Number(second.total_amount),2000);
  assert.ok((await rows()).every(r=>!r.eligible));await assert.rejects(reserve(mid),/billing_blocked/);
  await at('2026-12-01T00:00:00+02:00');
  const rest=row(await rows(),'2026-11-01');assert.deepEqual(rest.unbilledSlots.map(s=>s.slot),[6]);
  const third=await reserve(rest);await finish(third.id);
  assert.equal(Number(third.total_amount),1000);
  assert.equal((await db.query('select sum(total_amount)::int total from finance_transaction_accounts')).rows[0].total,6000);
  assert.deepEqual((await db.query('select to_jsonb(a) snapshot from finance_transaction_accounts a where id=$1',[first.id])).rows[0].snapshot,snapshot);
  assert.equal((await db.query('select count(*)::int n from finance_billing_claims')).rows[0].n,6);
  const paymentsAfter=(await db.query(`select jsonb_build_object('receipts',(select jsonb_agg(to_jsonb(r)) from finance_receipts r),
    'allocations',(select jsonb_agg(to_jsonb(a)) from finance_receipt_allocations a)) value`)).rows[0].value;
  assert.deepEqual(paymentsAfter,paymentsBefore);
  const balances=(await db.query('select finance_payment_context() value')).rows[0].value.balances;
  assert.equal(balances.find(b=>b.accountId===first.id).balance,2000);
  // Payment terms are still calculated from the issue month, without a half-month adjustment.
  assert.equal((await db.query('select payment_due_date::text due from finance_transaction_accounts where id=$1',[second.id])).rows[0].due,'2026-12-30');
});
check('unissued earlier periods remain available across openings and into January',async()=>{
  await at('2027-01-15T00:00:00+02:00');
  const all=await rows();assert.equal(row(all,'2026-10-01').issuableAmount,3000);assert.equal(row(all,'2026-11-01').issuableAmount,3000);
  const a=await reserve(row(all,'2026-10-01'));await finish(a.id);
  const b=await reserve(row(await rows(),'2026-11-01'));await finish(b.id);
  assert.ok((await rows()).every(r=>!r.eligible));
});
check('mixed funding keeps completion billing, payer grouping and separate funding caps',async()=>{
  await db.query("update activities set funding='גפן + רשות',price=12000");
  await db.query("insert into activity_funding_sources values(1,$1,6000)",[authority]);
  let all=await rows();assert.equal(row(all,'2026-11-01').issuableAmount,2000);assert.equal(row(all,'2026-11-01',authority).eligible,false);
  await at('2026-11-19T12:00:00+02:00');all=await rows();
  const other=row(all,'2026-11-01',authority);assert.equal(other.eligible,true);assert.equal(other.issuableAmount,6000);
  assert.equal(other.payerKey,'authority:1');assert.equal(row(all,'2026-11-01').payerKey,'school:1');
  // Existing non-Gefen monthly UI range guard stays closed, even though completion eligibility is live.
  await assert.rejects(reserve(other),/invalid_monthly_billing_range/);
  await at('2026-12-01T00:00:00+02:00');
  for(const f of [gefen,authority]) {
    for(const r of (await rows()).filter(r=>r.fundingSourceId===f && r.eligible)) {const a=await reserve(r);await finish(a.id);}
  }
  assert.equal((await db.query('select sum(total_amount)::int total from finance_transaction_accounts')).rows[0].total,12000);
});
check('RPC rejects stale or forged cutoffs, current-month-before-opening and future ranges',async()=>{
  const r=row(await rows(),'2026-11-01');
  await assert.rejects(reserve(r,crypto.randomUUID(),'2026-10-31'),/invalid_cutoff/);
  await assert.rejects(reserve(r,crypto.randomUUID(),'2026-11-15'),/invalid_cutoff/);
  await assert.rejects(reserve(r,crypto.randomUUID(),r.billingCutoff,'2026-12-01'),/invalid_monthly_billing_range/);
  await at('2026-11-14T23:59:00+02:00');
  await assert.rejects(reserve({...r,billingCutoff:'2026-10-31'}),/invalid_monthly_billing_range/);
});
check('final dispatch across an opening uses the stored cutoff but still rejects changed meetings',async()=>{
  await at('2026-11-30T23:59:59+02:00');const r=row(await rows(),'2026-11-01');
  const account=await reserve(r);
  await at('2026-12-01T00:00:01+02:00');
  assert.deepEqual(row((await db.query("select finance_private.billing_rows(a,$1) r from activities a where row_id='a'",[account.id])).rows[0].r,'2026-11-01').unbilledSlots.map(s=>s.slot),[4,5]);
  await finish(account.id);
  assert.deepEqual(row(await rows(),'2026-11-01').unbilledSlots.map(s=>s.slot),[6]);
  const next=await reserve(row(await rows(),'2026-11-01'));
  await db.query("update activities set date_6='2026-12-02'");
  await assert.rejects(finish(next.id),/נתוני החיוב השתנו/);
});
check('the unique settled-slot index and activity locks protect concurrent retries with different keys',async()=>{
  const r=row(await rows(),'2026-11-01');
  const client=new pg.Client({connectionString:url});await client.connect();
  try {
    await client.query("select set_config('test.uid','44444444-4444-4444-8444-444444444444',false),set_config('test.app_role','admin',false),set_config('test.clock','2026-11-15T00:00:00+02:00',false)");
    const payload=JSON.stringify([{activity_row_id:'a',funding_source_id:gefen,performance_month:r.period,billing_range_end:r.period,meeting_slots:r.unbilledSlots.map(s=>s.slot),expected_amount:r.issuableAmount,issue_mode:'automatic'}]);
    const issue=c=>c.query("select reserve_finance_transaction_account($1,'2026-11-14','123','ignored',null,$2)",[crypto.randomUUID(),payload]);
    const attempts=await Promise.allSettled([issue(db),issue(client)]);
    assert.equal(attempts.filter(a=>a.status==='fulfilled').length,1);
    assert.match(attempts.find(a=>a.status==='rejected').reason.message,/billing_blocked/);
    assert.equal((await db.query('select count(*)::int n from finance_transaction_accounts')).rows[0].n,1);
  } finally {await client.end();}
});

check('preview and reservation permission gates remain enforced; private cutoff helper is not exposed',async()=>{
  await db.query('set role authenticated');
  try {
    assert.ok((await rows()).length>0);
    await assert.rejects(db.query('select finance_private.gefen_cycle_cutoff()'),/permission denied/);
    await db.query("select set_config('test.app_role','employee',false)");
    await assert.rejects(rows(),/finance_permission_denied/);
  } finally {await db.query('reset role');}
  await db.query('set role anon');
  try {await assert.rejects(rows(),/permission denied/);} finally {await db.query('reset role');}
});
