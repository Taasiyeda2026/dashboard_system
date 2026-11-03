import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
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
  for(const name of ['20260821190000_finance_transaction_accounts','20260821203000_finance_transaction_issuance_modes'])await db.query(await read(`../supabase/migrations/${name}.sql`));
  await db.query('alter function reserve_finance_transaction_account(uuid,date,text,text,text,jsonb) rename to reserve_finance_transaction_account_legacy_impl');
  for(const name of ['20261029222210_finance_funder_billing','20261029224142_finance_receipts_manual_accounts',
    '20261030210000_finance_consolidated_funder_accounts','20261030044100_finance_single_funder_price_fallback','20261030051500_finance_optional_customer_identifier',
    '20261101192545_finance_service_quantity_snapshots','20261102191847_finance_gefen_course_monthly_minimum',
    '20261102202405_finance_automatic_outlook_drafts','20261103191835_finance_original_issuer_outlook_mailbox','20261103211803_finance_delegated_invoice_drafts','20261103221311_finance_manual_payer_first','20261103231056_finance_course_performance_hours'])await db.query(await read(`../supabase/migrations/${name}.sql`));
});
after(async()=>{if(db)await db.end();});
beforeEach(async()=>{
  if(!db)return;
  await db.query(`truncate public.users,auth.users,finance_private.outlook_jobs,net.requests,finance_private.payment_operations,finance_audit_events,
    finance_receipt_allocations,finance_receipts,finance_billing_claims,finance_transaction_account_meetings,
    finance_transaction_account_lines,finance_private.dispatch_leases,finance_transaction_accounts,activity_funding_sources,
    activities,schools,authorities,funding_sources,course_meeting_cancellations,contacts_schools,contact_emails,finance_school_invoice_recipients;
    select set_config('test.uid','44444444-4444-4444-8444-444444444444',false),set_config('test.app_role','admin',false),set_config('test.role','service_role',false);
    insert into auth.users values('44444444-4444-4444-8444-444444444444','idann@think.org.il',now()),('55555555-5555-4555-8555-555555555555','toni@think.org.il',now());
    insert into public.users values('44444444-4444-4444-8444-444444444444','idann@think.org.il',true,'admin','{}'),('55555555-5555-4555-8555-555555555555','toni@think.org.il',true,'finance','{"manage_finance_transactions":"yes","finance_access":"yes"}');
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
const direct='66666666-6666-4666-8666-666666666666',sponsor='77777777-7777-4777-8777-777777777777';
async function seedPayerActivity(id,rowId,schoolId,funder,amount=8000,meetings=10){
  await db.query("insert into funding_sources values($1,$2) on conflict do nothing",[funder,funder===direct?'חוזה עצמאי':funder===sponsor?'מממן חיצוני':'גפ״ן']);
  await db.query("insert into schools values($1,$2) on conflict do nothing",[schoolId,String(schoolId===1?123:248724)]);
  await db.query(`insert into activities(id,row_id,school_id,authority_id,school,funding,price,sessions,activity_name,status,date_1,date_2)
    values($1,$2,$3,1,$4,$5,$6,$7,'יישומי AI בשיתוף GOOGLE','פתוח','2026-10-01','2026-10-02')`,[id,rowId,schoolId,schoolId===1?'מוסד':'המשיח האנגליקאני',funder===direct?'חוזה עצמאי':funder===sponsor?'מממן חיצוני':'גפ״ן',amount,String(meetings)]);
  await db.query('insert into activity_funding_sources values($1,$2,$3)',[id,funder,amount]);
}
const manualItem=(id,funder,basis='full_funding',extra={})=>({activity:id,funder,month:'2026-10-01',draft:{billing_basis:basis,...extra}});
async function quoteManual(item){return(await db.query('select finance_manual_account_quote($1,$2,$3,$4) q',[item.activity,item.funder,item.month,item.draft])).rows[0].q;}
async function reserveManual(item){const q=await quoteManual(item);return(await db.query('select (reserve_finance_manual_account($1,$2,$3,$4,$5,$6)).*',[crypto.randomUUID(),item.activity,item.funder,item.month,item.draft,q.revision])).rows[0];}
async function finishManual(id){const lease=crypto.randomUUID();await db.query('select acquire_finance_dispatch($1,$2)',[id,lease]);await db.query("select finalize_finance_billing($1,$2,'manual.pdf','hash','drive','folder','item','url')",[id,lease]);await db.query('select release_finance_dispatch($1,$2)',[id,lease]);}
check('school self-funding is a school payer with 8000 total, ten meetings, fifteen hours and automatic contacts',async()=>{
  await seedPayerActivity(2,'ai',2,direct);
  await db.query("insert into contacts_schools values(51,2,null,'school',null,'School@Example.test','פעיל');insert into contact_emails values(51,'principal@example.test',true)");
  const q=await quoteManual(manualItem('ai',direct)),line=q.finance_transaction_account_lines[0];
  assert.equal(q.payer_key_snapshot,'school:2');assert.equal(q.customer_name_snapshot,'המשיח האנגליקאני');
  assert.equal(Number(q.total_amount),8000);assert.equal(Number(line.quantity_snapshot),10);assert.equal(Number(line.billed_hours),15);
  assert.equal(q.customer_email_snapshot,'principal@example.test;school@example.test');assert.equal(q.source.gefenFunding,false,'school payer does not mean monthly Gefen');
});
check('one school can consolidate independent activities and a second issue cannot charge the funding again',async()=>{
  await seedPayerActivity(2,'b',1,direct);await seedPayerActivity(3,'c',1,direct);
  const items=[manualItem('b',direct),manualItem('c',direct)];
  const q=(await db.query('select finance_funder_batch_quote($1) q',[JSON.stringify(items)])).rows[0].q;
  assert.equal(q.payer_key_snapshot,'school:1');assert.equal(Number(q.total_amount),16000);
  const a=(await db.query('select (reserve_finance_funder_batch_account($1,$2,$3)).*',[crypto.randomUUID(),JSON.stringify(items),q.revision])).rows[0];
  await finishManual(a.id);assert.equal((await db.query('select count(*)::int n from finance_transaction_account_lines where account_id=$1',[a.id])).rows[0].n,2);
  await assert.rejects(db.query('select reserve_finance_funder_batch_account($1,$2,$3)',[crypto.randomUUID(),JSON.stringify(items),q.revision]),/billing_blocked/);
});
check('external sponsor consolidates different schools and uses sponsor contacts rather than school contacts',async()=>{
  await seedPayerActivity(2,'b',1,sponsor);await seedPayerActivity(3,'c',2,sponsor);
  await db.query("insert into contacts_schools values(51,1,null,'school',null,'school@example.test','פעיל'),(52,null,null,'other','מממן חיצוני','sponsor@example.test','פעיל')");
  const q=(await db.query('select finance_funder_batch_quote($1) q',[JSON.stringify([manualItem('b',sponsor),manualItem('c',sponsor)])])).rows[0].q;
  assert.equal(q.payer_key_snapshot,'funding:'+sponsor);assert.equal(q.customer_email_snapshot,'sponsor@example.test');assert.equal(q.finance_transaction_account_lines.length,2);
});
check('partial performance leaves the correct funding balance and a school receipt uses the same payer identity',async()=>{
  await seedPayerActivity(2,'b',1,direct,8000,2);
  const a=await reserveManual(manualItem('b',direct,'performance',{quantity:1,hours:1.5,amount:4000,unit_price:4000}));await finishManual(a.id);
  const q=await quoteManual(manualItem('b',direct));assert.equal(Number(q.total_amount),4000);
  const b=await reserveManual(manualItem('b',direct));await finishManual(b.id);
  await assert.rejects(quoteManual(manualItem('b',direct)),/billing_blocked/);
  const receipt={funding_source_id:direct,payer_key:'school:1',payer_name:'מוסד',activity_row_id:'b',amount:3000,received_date:'2026-11-01',reference:'school-payment'};
  const id=(await db.query('select finance_record_receipt($1,$2) id',[crypto.randomUUID(),receipt])).rows[0].id;
  assert.equal((await db.query('select payer_key from finance_receipts where id=$1',[id])).rows[0].payer_key,'school:1');
});
check('mixed funding keeps Gefen separate and a manual override cannot bypass the three calendar meetings',async()=>{
  await seedPayerActivity(2,'b',1,direct,8000,10);
  await db.query('update activity_funding_sources set amount=4000 where activity_id=2');
  await db.query('insert into activity_funding_sources values(2,$1,4000)',[gefen]);
  const school=await quoteManual(manualItem('b',direct));assert.equal(Number(school.total_amount),4000);
  await assert.rejects(quoteManual(manualItem('b',gefen,'full_funding',{override_reason:'admin test'})),/billing_blocked/);
  const rows=(await db.query("select finance_private.billing_rows(a) r from activities a where row_id='b'")).rows[0].r;
  assert.ok(rows.filter(r=>r.gefenFunding).every(r=>!r.eligible));assert.ok(rows.filter(r=>!r.gefenFunding).every(r=>r.fundingSourceId===direct));
});
check('server resolver includes current active school contacts, additional addresses and designated billing recipient only',async()=>{
  await db.query(`insert into contacts_schools values
    (1,1,1,'school',null,'Teacher@Example.test;old@example.test; invalid','פעיל'),(2,1,1,'school',null,'admin@example.test','פעיל'),
    (3,1,1,'school',null,'inactive@example.test','לא פעיל'),(4,2,2,'school',null,'other-school@example.test','פעיל');
    insert into contact_emails values(1,'SECOND@example.test',true),(1,'teacher@example.test',true),(1,'old@example.test',false);
    insert into finance_school_invoice_recipients values(1,'billing@example.test',null),(1,'old@example.test',1);`);
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
  await finalize();const begin=()=>db.query("select begin_finance_outlook_creation($1,$2,'idann@think.org.il','[\"a@example.test\"]') allowed",[account.id,token]);
  assert.equal((await begin()).rows[0].allowed,true);assert.equal((await begin()).rows[0].allowed,false);
  await db.query("select mark_finance_transaction_outlook($1,'needs_review',null,'uncertain',$2)",[account.id,token]);
  assert.equal((await begin()).rows[0].allowed,false);
  await db.query("select mark_finance_transaction_outlook($1,'failed',null,'rejected',$2,null,null,true)",[account.id,token]);
  assert.equal((await begin()).rows[0].allowed,true);
});
check('retired cron and job capabilities cannot reach Outlook; pending accounts belong only to the original session',async()=>{
  assert.equal((await db.query("select count(*)::int n from cron.job where jobname='finance-outlook-drafts'")).rows[0].n,0);
  await finalize();await db.query('select release_finance_dispatch($1,$2)',[account.id,token]);
  assert.equal((await db.query('select finance_private.dispatch_outlook_jobs() n')).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from net.requests')).rows[0].n,0);
  assert.equal((await db.query('select finance_authorize_outlook_job($1,$2) allowed',[account.id,crypto.randomUUID()])).rows[0].allowed,false);
  assert.equal((await db.query('select finance_delegated_account_owner($1) allowed',[account.id])).rows[0].allowed,true);
  let pending=(await db.query('select finance_pending_delegated_accounts() r')).rows[0].r;assert.equal(pending.length,1);
  await db.query("select set_config('test.uid','55555555-5555-4555-8555-555555555555',false)");
  assert.equal((await db.query('select finance_delegated_account_owner($1) allowed',[account.id])).rows[0].allowed,false);
  pending=(await db.query('select finance_pending_delegated_accounts() r')).rows[0].r;assert.deepEqual(pending,[]);
});
check('waiting Microsoft connection preserves claims and reconnect immediately releases the original user pending work',async()=>{
  await finalize();await db.query("select mark_finance_transaction_outlook($1,'waiting_connection',null,'invoice_microsoft_connection_required',$2)",[account.id,token]);
  assert.equal((await db.query('select document_status from finance_transaction_accounts where id=$1',[account.id])).rows[0].document_status,'issued');
  assert.equal((await db.query('select count(*)::int n from finance_billing_claims')).rows[0].n,3);
  assert.deepEqual((await db.query('select finance_pending_delegated_accounts() r')).rows[0].r,[]);
  assert.equal((await db.query('select finance_pending_delegated_accounts(true) r')).rows[0].r.length,1);
  assert.equal((await db.query("select has_function_privilege('anon','public.finance_pending_delegated_accounts(boolean)','EXECUTE') allowed")).rows[0].allowed,false);
});
check('correcting a mismatched Microsoft session safely reopens only the original issuer account',async()=>{
  await finalize();await db.query("select mark_finance_transaction_outlook($1,'failed',null,'invoice_microsoft_account_mismatch',$2)",[account.id,token]);
  assert.equal((await db.query('select state from finance_private.outlook_jobs where account_id=$1',[account.id])).rows[0].state,'blocked');
  assert.equal((await db.query('select finance_pending_delegated_accounts(true) r')).rows[0].r.length,1);
  assert.equal((await db.query('select attempts from finance_private.outlook_jobs where account_id=$1',[account.id])).rows[0].attempts,0);
});
check('ready status closes the outbox while preserving original invoice metadata',async()=>{
  await finalize();await db.query("select mark_finance_transaction_outlook($1,'draft_ready','immutable-message',null,$2,'[\"a@example.test\"]','idann@think.org.il')",[account.id,token]);
  const a=(await db.query('select * from finance_transaction_accounts')).rows[0];
  assert.equal(a.generated_filename,'original.pdf');assert.equal(a.pdf_sha256,'hash');assert.equal(a.outlook_message_id,'immutable-message');assert.deepEqual(a.outlook_recipients,['a@example.test']);
  assert.equal((await db.query('select state from finance_private.outlook_jobs')).rows[0].state,'ready');
  await db.query("select mark_finance_transaction_outlook($1,'failed',null,'verification failed',$2)",[account.id,token]);
  assert.equal((await db.query('select document_status from finance_transaction_accounts')).rows[0].document_status,'issued');
});

check('worker exhaustion becomes visible and the already-deployed Gefen month rule is preserved',async()=>{
  await finalize();await db.query("update finance_private.outlook_jobs set attempts=10,next_retry_at=now()-interval '1 minute'");
  assert.equal((await db.query('select finance_private.dispatch_outlook_jobs() n')).rows[0].n,0);
  await db.query("select mark_finance_transaction_outlook($1,'failed',null,'automatic_retry_exhausted',$2)",[account.id,token]);
  assert.equal((await db.query('select outlook_status from finance_transaction_accounts')).rows[0].outlook_status,'failed');
  const rows=(await db.query("select finance_private.billing_rows(jsonb_populate_record(a,'{\"id\":-1,\"row_id\":\"unbilled\",\"date_1\":\"2026-10-01\",\"date_2\":\"2026-10-20\",\"date_3\":\"2026-11-01\"}'),null,'2026-12-01T00:00:00+02:00') r from activities a")).rows[0].r;
  assert.equal(rows.find(r=>r.period==='2026-10-01').eligible,false);
  assert.equal(rows.find(r=>r.period==='2026-11-01').eligible,true);
});

const resolveMailbox=async()=> (await db.query('select resolve_finance_outlook_mailbox($1,$2) mailbox',[account.id,token])).rows[0].mailbox;
check('reservation captures the server actor and mailbox; forged owner fields and later actor changes cannot redirect it',async()=>{
  assert.equal(account.outlook_owner_id,'44444444-4444-4444-8444-444444444444');assert.equal(account.outlook_owner_mailbox,'idann@think.org.il');
  const forged=(await db.query(`insert into finance_transaction_accounts(idempotency_key,cutoff_date,institution_symbol,customer_name_snapshot,total_amount,payment_due_date,
    outlook_owner_id,outlook_owner_mailbox) values($1,current_date,'123','בדיקה',0,current_date,'55555555-5555-4555-8555-555555555555','toni@think.org.il') returning *`,[crypto.randomUUID()])).rows[0];
  assert.equal(forged.outlook_owner_id,account.outlook_owner_id);assert.equal(forged.outlook_owner_mailbox,'idann@think.org.il');
  await db.query("select set_config('test.uid','55555555-5555-4555-8555-555555555555',false)");
  assert.equal(await resolveMailbox(),'idann@think.org.il');
  await db.query("select set_config('test.uid','',false)");assert.equal(await resolveMailbox(),'idann@think.org.il','background worker has no user session');
  await assert.rejects(db.query("update finance_transaction_accounts set outlook_owner_id='55555555-5555-4555-8555-555555555555' where id=$1",[account.id]),/invoice_mailbox_owner_immutable/);
  await assert.rejects(db.query("update finance_transaction_accounts set outlook_owner_mailbox='toni@think.org.il' where id=$1",[account.id]),/invoice_mailbox_owner_immutable/);
});
check('finance issuer mailbox requires the same active finance permissions and a confirmed organizational Auth email',async()=>{
  const lookup=async()=> (await db.query("select finance_private.issuer_outlook_mailbox('55555555-5555-4555-8555-555555555555') mailbox")).rows[0].mailbox;
  assert.equal(await lookup(),'toni@think.org.il');
  await db.query("update public.users set permissions='{}' where role='finance'");assert.equal(await lookup(),null);
  await db.query("update public.users set permissions='{\"manage_finance_transactions\":\"yes\",\"finance_access\":\"no\"}' where role='finance'");assert.equal(await lookup(),null);
  await db.query("update public.users set permissions='{\"manage_finance_transactions\":\"yes\",\"finance_access\":\"yes\"}',is_active=false where role='finance'");assert.equal(await lookup(),null);
  await db.query("update public.users set is_active=true where role='finance'; update auth.users set email_confirmed_at=null where email='toni@think.org.il'");assert.equal(await lookup(),null);
  await db.query("update auth.users set email_confirmed_at=now(),email='other@think.org.il' where email='toni@think.org.il'");assert.equal(await lookup(),null);
  await db.query("update auth.users set email='toni@gmail.com' where email='other@think.org.il';update public.users set email='toni@gmail.com' where role='finance'");assert.equal(await lookup(),null);
});
check('revoked issuer and changed email stop retries rather than use the retrying user mailbox',async()=>{
  await db.query("update public.users set is_active=false where role='admin'");await assert.rejects(resolveMailbox(),/invoice_mailbox_not_authorized/);
  await db.query("update public.users set is_active=true,email='new@think.org.il' where role='admin';update auth.users set email='new@think.org.il' where email='idann@think.org.il'");
  await assert.rejects(resolveMailbox(),/invoice_mailbox_identity_changed/);
});
check('an unknown legacy owner and an existing draft in another mailbox fail closed without changing message IDs',async()=>{
  await finalize();
  await db.query("update finance_transaction_accounts set outlook_message_id='legacy',outlook_mailbox='office@think.org.il' where id=$1",[account.id]);
  await assert.rejects(resolveMailbox(),/invoice_mailbox_existing_draft_mismatch/);
  assert.equal((await db.query('select outlook_message_id from finance_transaction_accounts where id=$1',[account.id])).rows[0].outlook_message_id,'legacy');
  // Simulate a pre-migration account with no recorded creator, without disabling guards.
  await db.query("select set_config('test.uid','',false)");
  const legacy=(await db.query("insert into finance_transaction_accounts(idempotency_key,cutoff_date,institution_symbol,customer_name_snapshot,total_amount,payment_due_date,document_status) values($1,current_date,'123','legacy',0,current_date,'issued') returning id",[crypto.randomUUID()])).rows[0];
  const lease=crypto.randomUUID();await db.query('select acquire_finance_dispatch($1,$2)',[legacy.id,lease]);
  await assert.rejects(db.query('select resolve_finance_outlook_mailbox($1,$2)',[legacy.id,lease]),/invoice_mailbox_not_authorized/);
});
check('missing mailbox can be repaired only for the original issuer and then remains frozen',async()=>{
  await db.query("update public.users set email=null where role='finance';select set_config('test.uid','55555555-5555-4555-8555-555555555555',false)");
  const row=(await db.query("insert into finance_transaction_accounts(idempotency_key,cutoff_date,institution_symbol,customer_name_snapshot,total_amount,payment_due_date,document_status) values($1,current_date,'123','repair',0,current_date,'issued') returning *",[crypto.randomUUID()])).rows[0];
  assert.equal(row.outlook_owner_mailbox,null);
  const lease=crypto.randomUUID();await db.query('select acquire_finance_dispatch($1,$2)',[row.id,lease]);
  await assert.rejects(db.query('select resolve_finance_outlook_mailbox($1,$2)',[row.id,lease]),/invoice_mailbox_not_authorized/);
  await db.query("update public.users set email='toni@think.org.il' where role='finance';select set_config('test.uid','44444444-4444-4444-8444-444444444444',false)");
  assert.equal((await db.query('select resolve_finance_outlook_mailbox($1,$2) mailbox',[row.id,lease])).rows[0].mailbox,'toni@think.org.il');
});
check('intent and status writes reject another mailbox and resolver requires backend role and a valid lease',async()=>{
  await finalize();await assert.rejects(db.query("select begin_finance_outlook_creation($1,$2,'toni@think.org.il','[]')",[account.id,token]),/invoice_mailbox_identity_changed/);
  await assert.rejects(db.query("select mark_finance_transaction_outlook($1,'draft_ready','id',null,$2,'[]','toni@think.org.il')",[account.id,token]),/invoice_mailbox_identity_changed/);
  await assert.rejects(db.query('select resolve_finance_outlook_mailbox($1,$2)',[account.id,crypto.randomUUID()]),/dispatch_lease_expired/);
  await db.query("select set_config('test.role','authenticated',false)");await assert.rejects(resolveMailbox(),/backend_only/);
  for(const role of ['anon','authenticated'])assert.equal((await db.query("select has_function_privilege($1,'public.resolve_finance_outlook_mailbox(uuid,uuid)','EXECUTE') allowed",[role])).rows[0].allowed,false);
  assert.equal((await db.query("select has_function_privilege('service_role','public.resolve_finance_outlook_mailbox(uuid,uuid)','EXECUTE') allowed")).rows[0].allowed,true);
});

check('Google performance bills three of ten course meetings as 4.5 hours and 2400, rejecting forged prices and duplicate charges',async()=>{
  await seedPayerActivity(2,'google',2,gefen);
  await db.query("update activities set date_3='2026-10-03' where row_id='google'");
  const request=manualItem('google',gefen,'performance'),q=await quoteManual(request),line=q.finance_transaction_account_lines[0];
  assert.equal(Number(q.total_amount),2400);assert.equal(Number(line.billed_hours),4.5);assert.equal(Number(line.hourly_rate_snapshot),8000/15);
  if(process.env.FINANCE_ACCEPTANCE_QUOTE_PATH)await writeFile(process.env.FINANCE_ACCEPTANCE_QUOTE_PATH,JSON.stringify(q));
  assert.equal(Number(q.source.activityPrice),8000);assert.equal(Number(q.source.plannedHours),15);
  assert.equal(line.finance_transaction_account_meetings.length,3);assert.ok(line.finance_transaction_account_meetings.every(m=>Number(m.hours)===1.5));
  for(const draft of [{hours:3,amount:2400},{hours:4.5,amount:4000},{hours:4.5,amount:1600}])await assert.rejects(quoteManual(manualItem('google',gefen,'performance',draft)),/course_performance_mismatch|חורג/);
  const a=await reserveManual(request);await finishManual(a.id);
  assert.equal(Number((await db.query("select price from activities where row_id='google'")).rows[0].price),8000);
  await assert.rejects(quoteManual(request),/billing_blocked/);
  assert.equal((await db.query('select count(*)::int n from finance_billing_claims where account_id=$1',[a.id])).rows[0].n,3);
});
check('cancelled course meetings never enter billed hours and the cumulative Gefen minimum remains enforced',async()=>{
  await seedPayerActivity(2,'cancelled',2,gefen);
  await db.query("update activities set date_3='2026-10-03' where row_id='cancelled';insert into course_meeting_cancellations values('cancelled','2026-10-02')");
  await assert.rejects(quoteManual(manualItem('cancelled',gefen,'performance')),/billing_blocked/);
  await db.query("update activities set date_4='2026-10-04' where row_id='cancelled'");
  const q=await quoteManual(manualItem('cancelled',gefen,'performance'));
  assert.equal(Number(q.total_amount),2400);assert.equal(Number(q.finance_transaction_account_lines[0].billed_hours),4.5);
  assert.deepEqual(q.selected_slots.map(s=>s.slot),[1,3,4]);
});
check('open monthly invoices can finalize without a school symbol and preserve sponsor separation',async()=>{
  await seedPayerActivity(2,'open',2,sponsor,8000,2);
  const r=(await db.query("select finance_private.billing_rows(a) r from activities a where row_id='open'")).rows[0].r[0];
  const payload=[{activity_row_id:'open',funding_source_id:sponsor,performance_month:r.period,expected_amount:r.issuableAmount,meeting_slots:[1,2],issue_mode:'manual'}];
  const a=(await db.query("select (reserve_finance_transaction_account($1,(now() at time zone 'Asia/Jerusalem')::date,'','',null,$2)).*",[crypto.randomUUID(),JSON.stringify(payload)])).rows[0];
  await finishManual(a.id);assert.equal((await db.query('select document_status from finance_transaction_accounts where id=$1',[a.id])).rows[0].document_status,'issued');
});
check('course rounding allocates 100 across three meetings without exceeding funding',async()=>{
  await seedPayerActivity(2,'rounding',2,direct,100,3);await db.query("update activities set date_3='2026-10-03' where row_id='rounding'");
  const first=await reserveManual(manualItem('rounding',direct,'performance',{quantity:1}));await finishManual(first.id);
  assert.equal(Number(first.total_amount),33.33);
  const q=await quoteManual(manualItem('rounding',direct,'performance'));assert.equal(Number(q.total_amount),66.67);assert.equal(Number(q.finance_transaction_account_lines[0].billed_hours),3);
  const second=await reserveManual(manualItem('rounding',direct,'performance'));await finishManual(second.id);
  assert.equal(Number((await db.query("select sum(amount) amount from finance_transaction_account_lines where activity_row_id='rounding'")).rows[0].amount),100);
});

check('monthly range rejects current-month non-Gefen completion and accepts closed-period completion',async()=>{
  await seedPayerActivity(2,'range',2,sponsor,8000,2);
  await db.query("update activities set date_1='2026-11-01',date_2='2026-11-02' where row_id='range'");
  const payload=[{activity_row_id:'range',funding_source_id:sponsor,performance_month:'2026-11-01',billing_range_end:'2026-10-01',expected_amount:8000,meeting_slots:[1,2],issue_mode:'manual'}];
  await assert.rejects(db.query("select reserve_finance_transaction_account($1,(now() at time zone 'Asia/Jerusalem')::date,'','',null,$2)",[crypto.randomUUID(),JSON.stringify(payload)]),/invalid_monthly_billing_range/);
  await db.query("update activities set date_1='2026-10-01',date_2='2026-10-02' where row_id='range'");payload[0].performance_month='2026-10-01';
  const a=(await db.query("select (reserve_finance_transaction_account($1,(now() at time zone 'Asia/Jerusalem')::date,'','',null,$2)).*",[crypto.randomUUID(),JSON.stringify(payload)])).rows[0];await finishManual(a.id);
});

check('legacy partial monetary claims retain their history and only the remaining hours and money can be billed',async()=>{
  await seedPayerActivity(2,'legacy-partial',2,direct,8000,2);
  const old=(await db.query("insert into finance_transaction_accounts(idempotency_key,cutoff_date,institution_symbol,customer_name_snapshot,total_amount,payment_due_date,document_status,payer_key_snapshot) values($1,current_date,'248724','legacy',3000,current_date,'issued','school:2') returning id",[crypto.randomUUID()])).rows[0].id;
  const line=(await db.query("insert into finance_transaction_account_lines(account_id,activity_row_id,activity_name_snapshot,funding_snapshot,activity_price_snapshot,planned_meeting_count_snapshot,hourly_rate_snapshot,billed_hours,amount,funding_source_id,funding_amount_snapshot,performance_month,billing_rule,quantity_snapshot,unit_price_snapshot) values($1,'legacy-partial','old','חוזה עצמאי',8000,2,1000,3,3000,$2,8000,'2026-10-01','completion',2,1500) returning id",[old,direct])).rows[0].id;
  await db.query("insert into finance_billing_claims values('legacy-partial',$1,1,$2,1500,false),('legacy-partial',$1,2,$2,1500,false)",[direct,old]);
  const before=(await db.query('select to_jsonb(a) snapshot from finance_transaction_account_lines a where id=$1',[line])).rows[0].snapshot;
  const q=await quoteManual(manualItem('legacy-partial',direct,'performance'));
  assert.equal(Number(q.total_amount),5000);assert.equal(Number(q.finance_transaction_account_lines[0].billed_hours),1.875);
  const a=await reserveManual(manualItem('legacy-partial',direct,'performance'));await finishManual(a.id);
  assert.deepEqual((await db.query('select to_jsonb(a) snapshot from finance_transaction_account_lines a where id=$1',[line])).rows[0].snapshot,before);
  await assert.rejects(quoteManual(manualItem('legacy-partial',direct,'performance')),/billing_blocked/);
});

check('workshops and tours retain unit pricing and zero billed course hours under performance issuance',async()=>{
  for(const [id,type,meetings] of [[2,'workshop',2],[3,'tour',1]]){
    await seedPayerActivity(id,type,2,direct,8000,meetings);
    await db.query('update activities set activity_type=$1,date_2=case when $1=\'tour\' then null else date_2 end where row_id=$1',[type]);
    const request=manualItem(type,direct,'performance'),q=await quoteManual(request);assert.equal(Number(q.total_amount),8000);assert.equal(Number(q.finance_transaction_account_lines[0].billed_hours),0);assert.equal(q.finance_transaction_account_lines[0].hourly_rate_snapshot,null);
    const a=await reserveManual(request);await finishManual(a.id);
  }
});
