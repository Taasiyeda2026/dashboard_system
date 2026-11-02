import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
const url=process.env.FINANCE_TEST_DATABASE_URL;
if(url){const u=new URL(url);if(!['127.0.0.1','localhost'].includes(u.hostname)||u.pathname!=='/codex_finance_test')throw Error('Disposable localhost finance test database only');}
const db=url?new pg.Client({connectionString:url}):null;
const read=p=>readFile(new URL(p,import.meta.url),'utf8');
const check=(name,fn)=>test(name,{skip:!db},fn);
const gefen='11111111-1111-4111-8111-111111111111';
let account,token;
before(async()=>{
  if(!db)return;await db.connect();
  await db.query('drop schema if exists finance_private cascade; drop schema if exists public cascade; drop schema if exists auth cascade; drop schema if exists net cascade; drop schema if exists vault cascade; drop schema if exists cron cascade; create schema public');
  await db.query(await read('./fixtures/finance-billing-schema.sql'));
  await db.query(`alter table activities add activity_type text default 'course',add activity_season text default 'school_2027',add school_contact_id bigint;
    create table contacts_schools(id bigint primary key,school_id bigint,authority_id bigint,client_type text,client_name text,email text,active text);
    create table contact_emails(contact_id bigint,email text,active boolean);
    create table finance_school_invoice_recipients(school_id bigint,recipient_email text,contact_id bigint);
    create schema net;create schema vault;create schema cron;
    create table vault.decrypted_secrets(name text,decrypted_secret text);
    insert into vault.decrypted_secrets values('quote_signature_reminder_project_url','https://local.example'),('quote_signature_reminder_anon_key','test-public-jwt');
    create table net.requests(id bigint generated always as identity,headers jsonb,body jsonb);
    create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as
      $$insert into net.requests(headers,body) values(headers,body) returning id$$;
    create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;`);
  for(const name of ['20260821190000_finance_transaction_accounts','20260821203000_finance_transaction_issuance_modes'])await db.query(await read(`../supabase/migrations/${name}.sql`));
  await db.query('alter function reserve_finance_transaction_account(uuid,date,text,text,text,jsonb) rename to reserve_finance_transaction_account_legacy_impl');
  for(const name of ['20261029222210_finance_funder_billing','20261029224142_finance_receipts_manual_accounts',
    '20261030044100_finance_single_funder_price_fallback','20261030051500_finance_optional_customer_identifier',
    '20261101192545_finance_service_quantity_snapshots','20261102191847_finance_gefen_course_monthly_minimum',
    '20261102202405_finance_automatic_outlook_drafts'])await db.query(await read(`../supabase/migrations/${name}.sql`));
});
after(async()=>{if(db)await db.end();});
beforeEach(async()=>{
  if(!db)return;
  await db.query(`truncate finance_private.outlook_jobs,net.requests,finance_private.payment_operations,finance_audit_events,
    finance_receipt_allocations,finance_receipts,finance_billing_claims,finance_transaction_account_meetings,
    finance_transaction_account_lines,finance_private.dispatch_leases,finance_transaction_accounts,activity_funding_sources,
    activities,schools,authorities,funding_sources,course_meeting_cancellations,contacts_schools,contact_emails,finance_school_invoice_recipients;
    select set_config('test.uid','44444444-4444-4444-8444-444444444444',false),set_config('test.app_role','admin',false),set_config('test.role','service_role',false);
    insert into schools values(1,'123');insert into authorities values(1,'רשות');insert into funding_sources values('${gefen}','גפ״ן');
    insert into activities(id,row_id,school_id,authority_id,school,funding,price,sessions,activity_name,status,date_1,date_2,date_3)
      values(1,'a',1,1,'מוסד','גפ״ן',3000,'3','קורס','פתוח','2026-08-01','2026-08-20','2026-09-01');
    insert into activity_funding_sources values(1,'${gefen}',3000);`);
  const row=(await db.query("select finance_private.billing_rows(a) r from activities a where row_id='a'")).rows[0].r.find(r=>r.period==='2026-09-01');
  account=(await db.query("select (reserve_finance_transaction_account($1,date_trunc('month',now() at time zone 'Asia/Jerusalem')::date-1,'123','מוסד','stale@example.test',$2)).*",
    [crypto.randomUUID(),JSON.stringify([{activity_row_id:'a',funding_source_id:gefen,performance_month:row.period,expected_amount:row.issuableAmount,meeting_slots:[1,2,3],issue_mode:'automatic'}])])).rows[0];
  token=crypto.randomUUID();await db.query('select acquire_finance_dispatch($1,$2)',[account.id,token]);
});
const recipients=async()=> (await db.query('select finance_transaction_recipients($1) r',[account.id])).rows[0].r;
const finalize=()=>db.query("select finalize_finance_billing($1,$2,'original.pdf','hash','drive','folder','item','url')",[account.id,token]);
check('server resolver includes current active school contacts, additional addresses and designated billing recipient only',async()=>{
  await db.query(`insert into contacts_schools values
    (1,1,1,'school',null,'Teacher@Example.test; invalid','פעיל'),(2,1,1,'school',null,'admin@example.test','פעיל'),
    (3,1,1,'school',null,'inactive@example.test','לא פעיל'),(4,2,2,'school',null,'other-school@example.test','פעיל');
    insert into contact_emails values(1,'SECOND@example.test',true),(1,'teacher@example.test',true),(2,'old@example.test',false);
    insert into finance_school_invoice_recipients values(1,'billing@example.test',null);`);
  const r=await recipients();assert.deepEqual(r.recipients,['admin@example.test','billing@example.test','second@example.test','teacher@example.test']);assert.equal(r.invalidCount,1);
});
check('authority payer excludes school contacts and stale browser snapshot; manual payer addresses remain explicit',async()=>{
  await db.query(`insert into contacts_schools values(1,1,1,'school',null,'school@example.test','פעיל'),(2,null,1,'authority',null,'authority@example.test','פעיל');
    update finance_transaction_accounts set payer_key_snapshot='authority:1',authority_id_snapshot=1;`);
  assert.deepEqual((await recipients()).recipients,['authority@example.test']);
  await db.query("update finance_transaction_accounts set manual_draft='{}',customer_email_snapshot='manual@example.test'");
  assert.deepEqual((await recipients()).recipients,['authority@example.test','manual@example.test']);
});
check('billing finalization atomically queues exactly one draft without touching issued snapshots or claims',async()=>{
  assert.equal((await db.query('select count(*)::int n from finance_private.outlook_jobs')).rows[0].n,0);
  await finalize();assert.equal((await db.query('select count(*)::int n from finance_private.outlook_jobs')).rows[0].n,1);
  await finalize();assert.equal((await db.query('select count(*)::int n from finance_private.outlook_jobs')).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int n from finance_billing_claims')).rows[0].n,3);
  await db.query("select mark_finance_transaction_outlook($1,'failed',null,'Graph 403',$2)",[account.id,token]);
  assert.equal((await db.query('select document_status from finance_transaction_accounts')).rows[0].document_status,'issued');
  assert.equal((await db.query('select state from finance_private.outlook_jobs')).rows[0].state,'pending');
});
check('creation intent is single-use under the dispatch lease and cleared only after a definite rejection',async()=>{
  await finalize();const begin=()=>db.query("select begin_finance_outlook_creation($1,$2,'office@example.test','[\"a@example.test\"]') allowed",[account.id,token]);
  assert.equal((await begin()).rows[0].allowed,true);assert.equal((await begin()).rows[0].allowed,false);
  await db.query("select mark_finance_transaction_outlook($1,'needs_review',null,'uncertain',$2)",[account.id,token]);
  assert.equal((await begin()).rows[0].allowed,false);
  await db.query("select mark_finance_transaction_outlook($1,'failed',null,'rejected',$2,null,null,true)",[account.id,token]);
  assert.equal((await begin()).rows[0].allowed,true);
});
check('outbox retries use expiring account capabilities and cannot bypass JWT-backed backend authorization',async()=>{
  await finalize();await db.query('select release_finance_dispatch($1,$2)',[account.id,token]);
  assert.equal((await db.query('select finance_private.dispatch_outlook_jobs() n')).rows[0].n,1);
  assert.equal((await db.query('select finance_private.dispatch_outlook_jobs() n')).rows[0].n,0);
  const request=(await db.query('select body from net.requests')).rows[0].body;
  assert.equal((await db.query('select finance_authorize_outlook_job($1,$2) allowed',[account.id,request.outlookJobToken])).rows[0].allowed,true);
  assert.equal((await db.query('select finance_authorize_outlook_job($1,$2) allowed',[account.id,crypto.randomUUID()])).rows[0].allowed,false);
  await db.query("update finance_private.outlook_jobs set dispatched_at=now()-interval '16 minutes'");
  assert.equal((await db.query('select finance_authorize_outlook_job($1,$2) allowed',[account.id,request.outlookJobToken])).rows[0].allowed,false);
  await db.query("select set_config('test.role','authenticated',false)");
  await assert.rejects(recipients(),/backend_only/);
  assert.equal((await db.query("select has_function_privilege('anon','public.finance_transaction_recipients(uuid)','EXECUTE') allowed")).rows[0].allowed,false);
});
check('ready status closes the outbox while preserving original invoice metadata',async()=>{
  await finalize();await db.query("select mark_finance_transaction_outlook($1,'draft_ready','immutable-message',null,$2,'[\"a@example.test\"]','office@example.test')",[account.id,token]);
  const a=(await db.query('select * from finance_transaction_accounts')).rows[0];
  assert.equal(a.generated_filename,'original.pdf');assert.equal(a.pdf_sha256,'hash');assert.equal(a.outlook_message_id,'immutable-message');assert.deepEqual(a.outlook_recipients,['a@example.test']);
  assert.equal((await db.query('select state from finance_private.outlook_jobs')).rows[0].state,'ready');
  await db.query("select mark_finance_transaction_outlook($1,'failed',null,'verification failed',$2)",[account.id,token]);
  assert.equal((await db.query('select document_status from finance_transaction_accounts')).rows[0].document_status,'issued');
});

check('worker exhaustion becomes visible and the already-deployed Gefen month rule is preserved',async()=>{
  await finalize();await db.query("update finance_private.outlook_jobs set attempts=10,next_retry_at=now()-interval '1 minute'");
  assert.equal((await db.query('select finance_private.dispatch_outlook_jobs() n')).rows[0].n,0);
  assert.equal((await db.query('select outlook_status from finance_transaction_accounts')).rows[0].outlook_status,'failed');
  const rows=(await db.query("select finance_private.billing_rows(jsonb_populate_record(a,'{\"id\":-1,\"row_id\":\"unbilled\",\"date_1\":\"2026-10-01\",\"date_2\":\"2026-10-20\",\"date_3\":\"2026-11-01\"}'),null,'2026-12-01T00:00:00+02:00') r from activities a")).rows[0].r;
  assert.equal(rows.find(r=>r.period==='2026-10-01').eligible,false);
  assert.equal(rows.find(r=>r.period==='2026-11-01').eligible,true);
});
