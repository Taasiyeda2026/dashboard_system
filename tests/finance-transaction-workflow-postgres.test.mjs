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
let baselinePreview;
let historicalMigrationSnapshot;
const historySnapshotSql = `select jsonb_build_object(
  'account',(select to_jsonb(a)-'deleted_at'-'dispatch_number_reserved'-'dispatch_upload_hash'
    from finance_transaction_accounts a where generated_filename='original.pdf'),
  'payments',finance_payment_context()
) snapshot`;
const migration = '../supabase/migrations/20261115080018_finance_gefen_semimonthly_cutoff.sql';
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
  const prepared = (await db.query('select prepare_finance_dispatch($1,$2) prepared',[id,token])).rows[0].prepared;
  await db.query("select finalize_finance_billing($1,$2,'synthetic.pdf','testhash','test-drive','test-folder','test-item','https://example.test')",[id,token]);
  await db.query('select release_finance_dispatch($1,$2)',[id,token]);
  await db.query("select set_config('test.role','authenticated',false)");
  return prepared;
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
  await db.query(`alter table public.activities add column course_hourly_rate numeric,
    add column course_hourly_rate_source text;
    create table finance_private.gefen_approved_order_rates(
      activity_row_id text primary key, activity_school_id bigint, activity_no text,
      order_school_symbol bigint,hourly_rate numeric,order_numbers text[]
    );`);
  const currentBilling = await read('../supabase/migrations/20261116074136_finance_fixed_funder_amount.sql');
  await db.query(currentBilling.slice(currentBilling.indexOf('CREATE OR REPLACE FUNCTION'), currentBilling.indexOf('CREATE OR REPLACE FUNCTION finance_private.manual_quote')).replaceAll('now()', 'public.finance_test_now()'));
  baselinePreview = (await db.query("select pg_get_functiondef('finance_billing_preview(text[])'::regprocedure) fn")).rows[0].fn;

  for (const name of [
    '20261102141025_finance_transaction_account_pl_numbering',
    '20261116072732_finance_cumulative_gefen_accounts',
    '20261126131805_finance_payer_preflight_and_number_reservation',
    '20261126131902_finance_transaction_drafts',
    '20261126132220_finance_in_place_transaction_corrections',
    '20261126132351_finance_admin_transaction_deletion',
    '20261126132525_finance_non_gefen_partial_amount',
    '20261126133511_finance_uncertain_pdf_dispatch_recovery',
    '20261126164927_finance_gefen_invoice_billing_overrides'
  ]) {
    const path = `../supabase/migrations/${name}.sql`;
    if (name.includes('pl_numbering')) {
      await db.query('begin;'+await read(path)+'commit;');
      await db.query(`insert into public.finance_transaction_accounts(
        id,idempotency_key,cutoff_date,institution_symbol,customer_name_snapshot,
        total_amount,document_status,issue_mode,payment_due_date,generated_filename,sharepoint_item_id
      ) values('99999999-9999-4999-8999-999999999999','99999999-9999-4999-8999-999999999999',
        '2026-10-01','123','מממן היסטורי',850,'issued','manual','2026-11-30','original.pdf','original-item');`);
      await db.query(`select set_config('test.app_role','admin',false),set_config('test.uid','44444444-4444-4444-8444-444444444444',false);
        insert into activities(id,row_id) values(99,'historical-activity');
        insert into funding_sources values('${authority}','רשות');
        insert into finance_receipts(id,idempotency_key,payer_name,amount,received_date,created_by)
          values('99999999-9999-4999-8999-999999999998','99999999-9999-4999-8999-999999999998',
            'מממן היסטורי',425,'2026-10-20','99999999-9999-4999-8999-999999999997');
        insert into finance_receipt_allocations(receipt_id,account_id,activity_row_id,funding_source_id,amount)
          values('99999999-9999-4999-8999-999999999998','99999999-9999-4999-8999-999999999999',
            'historical-activity','${authority}',300);`);
      historicalMigrationSnapshot = (await db.query(historySnapshotSql)).rows[0].snapshot;
      assert.equal(historicalMigrationSnapshot.payments.balances[0].balance,550);
    } else await load(path);
  }
  const after = (await db.query(historySnapshotSql)).rows[0].snapshot;
  assert.deepEqual(after,historicalMigrationSnapshot);
});
after(async()=>{if(db)await db.end();});
beforeEach(async()=>{
  if(!db)return;
  await at('2026-11-15T00:00:00+02:00');
  await db.query(`truncate finance_private.account_deletions,finance_private.transaction_drafts,contacts_schools,contact_emails,finance_private.invoice_versions,finance_private.invoice_revisions,public.users,auth.users,finance_private.outlook_jobs,net.requests,finance_private.payment_operations,finance_audit_events,
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
    insert into activity_funding_sources values(1,'${gefen}',6000);
    update activities set course_hourly_rate=6000::numeric/9 where row_id='a';`);
});

async function addPayerEmail() {
  await db.query("insert into contacts_schools(id,school_id,email,active) values(1,1,'billing@example.test','פעיל')");
}

check('payer preflight flags missing email and failed dispatch leaves numbering untouched', async () => {
  const october = row(await rows(), '2026-10-01');
  assert.equal(october.payerEmailMissing, true);
  const account = await reserve(october);
  assert.equal(account.transaction_account_number, null);
  const token = crypto.randomUUID();
  const before = (await db.query('select next_number from finance_private.account_numbering')).rows[0].next_number;
  await db.query("select set_config('test.role','service_role',false)");
  await db.query('select acquire_finance_dispatch($1,$2)', [account.id,token]);
  await assert.rejects(db.query('select prepare_finance_dispatch($1,$2)', [account.id,token]), /no_valid_payer_email/);
  assert.equal((await db.query('select next_number from finance_private.account_numbering')).rows[0].next_number,before);
  await db.query('select release_finance_dispatch($1,$2)', [account.id,token]);
  await addPayerEmail();
  assert.equal((await finish(account.id)).accountNumber, 'Pl'+before);
});

check('saved drafts are versioned, idempotent and administrator-only for deletion', async () => {
  const id = crypto.randomUUID();
  const payload = {manualSelectedActivityIds:['a'],manualDraft:{amount:100}};
  const save = (version, data) => db.query('select (finance_save_transaction_draft($1,$2,$3)).*',[id,version,data]);
  assert.equal((await save(0,payload)).rows[0].version,1);
  assert.equal((await save(0,payload)).rows[0].id,id);
  assert.equal((await save(1,{...payload,manualDraft:{amount:200}})).rows[0].version,2);
  await assert.rejects(save(1,payload),/stale_transaction_draft/);
  assert.equal((await db.query('select payload from finance_transaction_drafts()')).rows[0].payload.manualDraft.amount,200);
  assert.equal((await db.query('select count(*) from finance_transaction_accounts')).rows[0].count,'0');
  await db.query("select set_config('test.app_role','finance',false),set_config('test.permission','true',false)");
  await assert.rejects(db.query('select finance_delete_transaction_draft($1,2)',[id]),/finance_transactions_permission_denied/);
  await db.query("select set_config('test.app_role','admin',false)");
  await db.query('select finance_delete_transaction_draft($1,2)',[id]);
  assert.equal((await db.query('select count(*) from finance_transaction_drafts()')).rows[0].count,'0');
});

check('administrator deletion waits for dispatch and recycles the last number only once', async () => {
  await addPayerEmail();
  const account = await reserve(row(await rows(),'2026-10-01'));
  const {accountNumber} = await finish(account.id);
  await db.query("select set_config('test.app_role','finance',false),set_config('test.permission','true',false)");
  await assert.rejects(db.query('select begin_finance_account_deletion($1)', [account.id]),/finance_transactions_permission_denied/);
  await db.query("select set_config('test.app_role','admin',false),set_config('test.role','service_role',false)");
  const token = crypto.randomUUID();
  await db.query('select acquire_finance_dispatch($1,$2)', [account.id,token]);
  await assert.rejects(db.query('select begin_finance_account_deletion($1)', [account.id]),/dispatch_in_progress/);
  await db.query('select release_finance_dispatch($1,$2)', [account.id,token]);
  const {operationId} = (await db.query('select begin_finance_account_deletion($1) r', [account.id])).rows[0].r;
  assert.equal((await db.query('select begin_finance_account_deletion($1) r', [account.id])).rows[0].r.operationId,operationId);
  await assert.rejects(db.query('select acquire_finance_dispatch($1,$2)', [account.id,token]),/finance_account_deletion_in_progress/);
  for(let attempt=0;attempt<2;attempt++) {
    assert.deepEqual((await db.query('select finish_finance_account_deletion($1,$2) r',[account.id,operationId])).rows[0].r,{deleted:true,recycledNumber:true});
  }
  await db.query("select set_config('test.role','authenticated',false)");
  const october = row(await rows(),'2026-10-01');
  assert.equal(october.issuableAmount,3000);
  assert.equal((await finish((await reserve(october)).id)).accountNumber,accountNumber);
});

async function prepareSponsor() {
  await db.query(`update activities set funding='רשות',date_6='2026-11-01' where row_id='a';
    update activity_funding_sources set funding_source_id='${authority}';
    insert into contacts_schools(id,authority_id,client_type,email) values(2,1,'authority','authority@example.test');`);
}
async function sponsorQuote(amount = 6000) {
  return (await db.query("select finance_manual_account_quote('a',$1,'2026-11-01',$2) q", [
    authority, { billing_basis:'full_funding', amount }
  ])).rows[0].q;
}
async function reserveSponsor(quote, key = crypto.randomUUID()) {
  return (await db.query("select (reserve_finance_manual_account($1,'a',$2,'2026-11-01',$3,$4)).*", [
    key, authority, { billing_basis:'full_funding',amount:quote.total_amount },quote.revision
  ])).rows[0];
}
check('early sponsor partial amount is accepted and stays within the payer funding cap', async () => {
  await prepareSponsor();
  await assert.rejects(sponsorQuote(6001), /course_performance_mismatch/);
  const quote = await sponsorQuote(1250.5);
  const account = await reserveSponsor(quote);
  assert.equal(account.transaction_account_number,null);
  await finish(account.id);
  assert.equal(Number((await db.query('select total_amount from finance_transaction_accounts where id=$1',[account.id])).rows[0].total_amount),1250.5);
  assert.equal((await sponsorQuote(4749.5)).total_amount,4749.5);
  await assert.rejects(sponsorQuote(4750), /course_performance_mismatch/);
});

check('authorized finance user corrects an issued sponsor account in place and preserves the original version', async () => {
  await prepareSponsor();
  const account = await reserveSponsor(await sponsorQuote());
  const {accountNumber} = await finish(account.id);
  await db.query("select set_config('test.app_role','finance',false),set_config('test.permission','true',false)");
  const context = (await db.query('select finance_invoice_revision_context($1) c',[account.id])).rows[0].c;
  const id = context.account.finance_transaction_account_lines[0].id;
  const request = async proposed => (await db.query('select finance_request_invoice_revision($1,$2,$3,$4,false) r', [
    account.id, crypto.randomUUID(),context.baseHash,proposed
  ])).rows[0].r;
  await assert.rejects(request({payment_due_date:'2027-02-28',lines:[{id,amount:4800}]}), /revision_dates_require_admin/);
  const revision = await request({lines:[{id,amount:4800}]});
  assert.equal(revision.status,'approved');
  const q = (await db.query('select finance_invoice_revision_quote($1) q',[revision.id])).rows[0].q;
  const token = crypto.randomUUID();
  await db.query("select set_config('test.role','service_role',false)");
  const begun = (await db.query('select begin_finance_invoice_revision($1,$2,$3,$4) r',[revision.id,token,q.revision,revision.requested_by])).rows[0].r;
  assert.equal(begun.accountId,account.id);
  const done = (await db.query("select finish_finance_invoice_revision($1,$2,$3,'revised.pdf',$4,'drive','folder','item2','https://example.test/revised',null) r",
    [revision.id,token,q.revision,'f'.repeat(64)])).rows[0].r;
  assert.equal(done.accountId,account.id);
  assert.equal(done.keptAccountNumber,accountNumber);
  const versions = (await db.query("select version,(snapshot->>'total_amount')::numeric::int as amount from finance_private.invoice_versions where account_id=$1 order by version",[account.id])).rows;
  assert.deepEqual(versions,[{version:0,amount:6000},{version:1,amount:4800}]);
  assert.equal((await db.query('select count(*) from finance_transaction_accounts')).rows[0].count,'1');
  assert.equal((await db.query("select price from activities where row_id='a'")).rows[0].price,'6000');
});

check('a separate account is reserved for each funder in mixed funding', async () => {
  await addPayerEmail();
  await db.query(`update activities set funding='גפן + רשות' where row_id='a';
    update activity_funding_sources set amount=3600 where funding_source_id='${gefen}';
    insert into activity_funding_sources values(1,'${authority}',2400);
    insert into contacts_schools(id,authority_id,client_type,email) values(2,1,'authority','authority@example.test');`);
  const school = await reserve(row(await rows(),'2026-10-01'));
  await finish(school.id);
  const sponsor = await reserveSponsor(await sponsorQuote(2400));
  await finish(sponsor.id);
  const accounts = (await db.query('select id,funding_source_id_snapshot from finance_transaction_accounts order by funding_source_id_snapshot')).rows;
  assert.deepEqual(accounts,[{id:school.id,funding_source_id_snapshot:gefen},{id:sponsor.id,funding_source_id_snapshot:authority}]);
});

check('correction below allocated receipts is blocked and deletion releases allocations without deleting receipts', async () => {
  await prepareSponsor();
  const account = await reserveSponsor(await sponsorQuote());
  await finish(account.id);
  const receipt = (await db.query('select finance_record_receipt($1,$2,$3) id',[
    crypto.randomUUID(),{funding_source_id:authority,payer_name:'רשות',activity_row_id:'a',amount:5500,received_date:'2026-11-15'},
    JSON.stringify([{account_id:account.id,activity_row_id:'a',amount:5500}])
  ])).rows[0].id;
  const c = (await db.query('select finance_invoice_revision_context($1) c',[account.id])).rows[0].c;
  const revision = (await db.query('select finance_request_invoice_revision($1,$2,$3,$4,false) r',[
    account.id,crypto.randomUUID(),c.baseHash,{lines:[{id:c.account.finance_transaction_account_lines[0].id,amount:5000}]}
  ])).rows[0].r;
  await assert.rejects(db.query('select finance_invoice_revision_quote($1)',[revision.id]),/revision_below_allocated_receipts/);
  const {operationId} = (await db.query('select begin_finance_account_deletion($1) r',[account.id])).rows[0].r;
  await db.query("select set_config('test.role','service_role',false)");
  await db.query('select finish_finance_account_deletion($1,$2)',[account.id,operationId]);
  assert.equal((await db.query('select amount,voided_at from finance_receipts where id=$1',[receipt])).rows[0].voided_at,null);
  assert.ok((await db.query('select released_at from finance_receipt_allocations where receipt_id=$1',[receipt])).rows[0].released_at);
  assert.ok(!(await db.query('select finance_payment_context() payment')).rows[0].payment.balances.some(row=>row.accountId===account.id));
  assert.equal((await db.query("select set_config('test.role','authenticated',false)")).rowCount,1);
  await assert.rejects(db.query('select finance_invoice_revision_context($1)',[account.id]),/invoice_not_editable/);
});

check('two account dispatches reserve distinct numbers concurrently and deleting a non-last account does not recycle', async () => {
  await addPayerEmail();
  await db.query(`update activities set funding='גפן + רשות' where row_id='a';
    update activity_funding_sources set amount=3600 where funding_source_id='${gefen}';
    insert into activity_funding_sources values(1,'${authority}',2400);
    insert into contacts_schools(id,authority_id,client_type,email) values(2,1,'authority','authority@example.test');`);
  const school = await reserve(row(await rows(),'2026-10-01'));
  const sponsor = await reserveSponsor(await sponsorQuote(2400));
  const other = new pg.Client({connectionString:url});
  await other.connect();
  try {
    await other.query("select set_config('test.clock','2026-11-15T00:00:00+02:00',false),set_config('test.role','service_role',false)");
    await db.query("select set_config('test.role','service_role',false)");
    const prepare = async (client, account) => {
      const token = crypto.randomUUID();
      await client.query('select acquire_finance_dispatch($1,$2)',[account.id,token]);
      const {number} = (await client.query("select prepare_finance_dispatch($1,$2)->>'accountNumber' number",[account.id,token])).rows[0];
      await client.query("select finalize_finance_billing($1,$2,'synthetic.pdf','hash','drive','folder','item','https://example.test')",[account.id,token]);
      await client.query('select release_finance_dispatch($1,$2)',[account.id,token]);
      return {account,number};
    };
    const numbers = await Promise.all([prepare(db,school),prepare(other,sponsor)]);
    numbers.sort((a,b)=>a.number.localeCompare(b.number));
    assert.notEqual(numbers[0].number,numbers[1].number);
    const earlier = numbers[0].account.id;
    const before = (await db.query('select next_number from finance_private.account_numbering')).rows[0].next_number;
    const {operationId} = (await db.query('select begin_finance_account_deletion($1) r',[earlier])).rows[0].r;
    const {r} = (await db.query('select finish_finance_account_deletion($1,$2) r',[earlier,operationId])).rows[0];
    assert.equal(r.recycledNumber,false);
    assert.equal((await db.query('select next_number from finance_private.account_numbering')).rows[0].next_number,before);
  } finally { await other.end(); }
});

test('measure eligibility before and after with 175 synthetic activities', {
  skip: !db || process.env.FINANCE_TEST_BENCHMARK !== '1'
}, async t => {
  await addPayerEmail();
  await db.query(`insert into activities
    select (jsonb_populate_record(null::activities,to_jsonb(a)||jsonb_build_object('id',n,'row_id','a'||n))).*
    from activities a cross join generate_series(2,175) n where a.row_id='a';
    insert into activity_funding_sources select id,'${gefen}',6000 from activities where id>1;`);
  const request = "select finance_billing_preview(array(select row_id from activities)) result";
  const updatedPreview = (await db.query("select pg_get_functiondef('finance_billing_preview(text[])'::regprocedure) fn")).rows[0].fn;
  const timings = {before:[],after:[]};
  let baseline;
  for (let sample=0;sample<6;sample++) {
    for (const [label,definition] of [['before',baselinePreview],['after',updatedPreview]]) {
      await db.query(definition);
      const start=performance.now();
      const {result}=(await db.query(request)).rows[0];
      if (sample===0 && label==='before') baseline=result;
      if (sample===0 && label==='after') {
        assert.deepEqual(result.map(({payerEmailMissing,...row})=>row),baseline);
      }
      if (sample>0) timings[label].push(performance.now()-start);
    }
  }
  for (const [label,raw] of Object.entries(timings)) {
    const sorted=raw.sort((a,b)=>a-b);
    t.diagnostic(`${label}: median=${sorted[2].toFixed(1)} ms, min=${sorted[0].toFixed(1)} ms, max=${sorted.at(-1).toFixed(1)} ms, samples=${sorted.length}`);
  }
  t.diagnostic(`175 activities; ${baseline.length} billing rows; 1 database RPC per sample`);
});

check('a staged PDF survives normal expiry and only its matching hash can resume dispatch', async () => {
  await addPayerEmail();
  const account = await reserve(row(await rows(),'2026-10-01'));
  const token = crypto.randomUUID(), hash = 'f'.repeat(64);
  await db.query("select set_config('test.role','service_role',false)");
  await db.query('select acquire_finance_dispatch($1,$2)',[account.id,token]);
  await db.query('select prepare_finance_dispatch($1,$2)',[account.id,token]);
  await db.query('select finance_stage_pdf_upload($1,$2,$3)',[account.id,token,hash]);
  await at('2026-11-15T00:16:00+02:00');
  const nextToken=crypto.randomUUID();
  await db.query('select acquire_finance_dispatch($1,$2)',[account.id,nextToken]);
  await assert.rejects(db.query('select finance_stage_pdf_upload($1,$2,$3)',[account.id,token,hash]),/dispatch_lease_expired/);
  await assert.rejects(db.query('select finance_stage_pdf_upload($1,$2,$3)',[account.id,nextToken,'a'.repeat(64)]),/finance_pdf_upload_outcome_unknown/);
  await assert.rejects(db.query("select cancel_finance_dispatch($1,$2,'failed')",[account.id,nextToken]),/finance_pdf_upload_outcome_unknown/);
  await db.query("select set_config('test.role','authenticated',false)");
  const pending=(await db.query('select finance_pending_pdf_uploads() pending')).rows[0].pending;
  assert.deepEqual(pending.map(item=>item.id),[account.id]);
});

check('a corrected amount above the funding cap is rejected without changing the original', async () => {
  await prepareSponsor();
  const account = await reserveSponsor(await sponsorQuote());
  await finish(account.id);
  const c = (await db.query('select finance_invoice_revision_context($1) c',[account.id])).rows[0].c;
  const revision = (await db.query('select finance_request_invoice_revision($1,$2,$3,$4,false) r',[
    account.id,crypto.randomUUID(),c.baseHash,{lines:[{id:c.account.finance_transaction_account_lines[0].id,amount:6000.01}]}
  ])).rows[0].r;
  await assert.rejects(db.query('select finance_invoice_revision_quote($1)',[revision.id]),/revision_billing_cap_exceeded/);
  assert.equal(Number((await db.query('select total_amount from finance_transaction_accounts where id=$1',[account.id])).rows[0].total_amount),6000);
});

check('a source price change flags a funding difference and retains the issued account and PDF', async () => {
  await prepareSponsor();
  const account = await reserveSponsor(await sponsorQuote());
  await finish(account.id);
  await db.query('update activities set price=5000 where row_id=\'a\'; update activity_funding_sources set amount=5000');
  const sponsor = (await rows()).find(r=>r.fundingSourceId===authority);
  assert.equal(sponsor.fullFundingAmount,0);
  assert.match(sponsor.fullFundingBlockedReason,/בדיקת כספים|נדרש בירור/);
  await assert.rejects(sponsorQuote(5000),/billing_blocked/);
  const original=(await db.query('select total_amount,generated_filename,document_status from finance_transaction_accounts where id=$1',[account.id])).rows[0];
  assert.deepEqual(original,{total_amount:'6000.00',generated_filename:'synthetic.pdf',document_status:'issued'});
});

async function gefenQuote(values={}){
  await addPayerEmail();
  const source=(await rows()).filter(r=>r.gefenFunding&&r.eligible);
  const groups=[{activity:'a',funder:gefen,meetings:11,hours:4.25,rate:475,periods:source.map(r=>({month:r.period,revision:r.billingSourceRevision})),...values}];
  const q=(await db.query('select finance_gefen_billing_quote($1,$2) q',[source[0].billingCutoff,JSON.stringify(groups)])).rows[0].q;
  return {q,groups,cutoff:source[0].billingCutoff};
}
async function gefenReserve(request,key=crypto.randomUUID()){
  return (await db.query('select (reserve_finance_gefen_billing_account($1,$2,$3,$4)).*',[key,request.cutoff,JSON.stringify(request.groups),request.q.revision])).rows[0];
}
check('Gefen independent billing values survive reserve dispatch claims and balances without editing activity',async()=>{
  const original=(await db.query("select to_jsonb(a) r from activities a where row_id='a'")).rows[0].r;
  const request=await gefenQuote();assert.equal(request.q.total_amount,2018.75);
  const key=crypto.randomUUID(),account=await gefenReserve(request,key);
  assert.equal(Number(account.total_amount),2018.75);
  assert.equal((await gefenReserve(request,key)).id,account.id,'idempotent retry');
  const lines=(await db.query('select * from finance_transaction_account_lines where account_id=$1 order by performance_month',[account.id])).rows;
  assert.equal(lines.reduce((n,l)=>n+Number(l.quantity_snapshot),0),11);
  assert.equal(lines.reduce((n,l)=>n+Number(l.billed_hours),0),4.25);
  assert.ok(lines.every(l=>Number(l.hourly_rate_snapshot)===475&&l.billing_override_snapshot.source&&l.billing_override_snapshot.chosen.meetings===11));
  assert.equal(Number((await db.query('select sum(claimed_amount) n from finance_billing_claims where account_id=$1',[account.id])).rows[0].n),2018.75);
  assert.equal(Number((await db.query('select count(*) n from finance_transaction_account_meetings m join finance_transaction_account_lines l on l.id=m.account_line_id where l.account_id=$1',[account.id])).rows[0].n),5,'five real eligible meetings; no eleven fictitious meetings');
  await finish(account.id);
  assert.deepEqual((await db.query("select to_jsonb(a) r from activities a where row_id='a'")).rows[0].r,original);
  const balance=(await db.query('select finance_payment_context() p')).rows[0].p.balances.find(b=>b.accountId===account.id);
  assert.equal(balance.balance,2018.75);
  await assert.rejects(gefenReserve(request),/billing_blocked|stale_billing_preview/);
});
check('Gefen higher than performance amount allowed within funding but funding ceiling is enforced',async()=>{
  const request=await gefenQuote({hours:11,rate:500,meetings:1});
  assert.equal(request.q.total_amount,5500);const a=await gefenReserve(request);await finish(a.id);
});
check('Gefen excessive funding amount and invalid inputs fail before any account is created',async()=>{
  await assert.rejects(gefenQuote({hours:13,rate:500}),/billing_funding_cap_exceeded/);
  await db.query('delete from contacts_schools');
  await assert.rejects(gefenQuote({meetings:1.5}),/invalid_gefen_billing_values/);
  assert.equal((await db.query('select count(*) n from finance_transaction_accounts')).rows[0].n,'0');
});
check('Gefen source changes after quote or reservation fail closed',async()=>{
  const request=await gefenQuote();
  await db.query("update activities set date_2='2026-10-11' where row_id='a'");
  await assert.rejects(gefenReserve(request),/stale_billing_preview/);
  await db.query("update activities set date_2='2026-10-10' where row_id='a'");
  const a=await gefenReserve(request);
  await db.query("update activities set course_hourly_rate=700 where row_id='a'");
  await assert.rejects(db.query('select finance_private.assert_current($1)',[a.id]),/נתוני החיוב השתנו/);
});
check('Gefen account-only rates do not block later real meeting periods',async()=>{
  const request=await gefenQuote();const a=await gefenReserve(request);await finish(a.id);
  await at('2026-12-01T12:00:00+02:00');
  const november=row(await rows(),'2026-11-01');assert.equal(november.eligible,true);assert.equal(november.unbilledCount,1);
  assert.equal(november.blockedReason,'');
});
check('Gefen quote and reservation retain permission and payer isolation',async()=>{
  const request=await gefenQuote();
  await db.query("select set_config('test.uid','',false)");
  await assert.rejects(gefenReserve(request),/finance_transactions_permission_denied/);
  await assert.rejects(db.query('select finance_gefen_billing_quote($1,$2)',[request.cutoff,JSON.stringify(request.groups)]),/finance_transactions_permission_denied/);
});
check('Gefen split periods preserve tiny hours and an invoice count below real slot count',async()=>{
 const request=await gefenQuote({meetings:1,hours:0.000001,rate:100000});
 const a=await gefenReserve(request);
 const lines=(await db.query('select sum(quantity_snapshot) q,sum(billed_hours) h,sum(amount) a from finance_transaction_account_lines where account_id=$1',[a.id])).rows[0];
 assert.equal(Number(lines.q),1);assert.equal(Number(lines.h),0.000001);assert.equal(Number(lines.a),0.10);await finish(a.id);
});
