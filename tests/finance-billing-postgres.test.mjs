import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
const url = process.env.FINANCE_TEST_DATABASE_URL;
if (url) {
  const u = new URL(url);
  if (!['127.0.0.1','localhost'].includes(u.hostname) || u.pathname !== '/codex_finance_test') throw new Error('Use disposable localhost codex_finance_test only');
}
const db = url ? new pg.Client({ connectionString: url }) : null;
const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const gefen = '11111111-1111-4111-8111-111111111111';
const authority = '22222222-2222-4222-8222-222222222222';
const token = '33333333-3333-4333-8333-333333333333';
let clock;
async function rows(at) {
  return (await db.query('select finance_private.billing_rows(a,null,$1) value from activities a where row_id=\'a\'', [at || clock.now])).rows[0].value;
}
async function preview() { return (await db.query("select finance_billing_preview(array['a']) value")).rows[0].value; }
async function reserve(row, overrides = {}, key = crypto.randomUUID()) {
  const lines = [{ activity_row_id: 'a', funding_source_id: row.fundingSourceId, performance_month: row.period,
    expected_amount: row.issuableAmount, meeting_slots: row.unbilledSlots.map(s => s.slot), issue_mode: row.gefenFunding ? 'automatic' : 'manual', ...overrides }];
  return (await db.query('select (reserve_finance_transaction_account($1,$2,\'123\',\'ignored\',null,$3)).*',
    [key, row.gefenFunding ? clock.cutoff : clock.today, JSON.stringify(lines)])).rows[0];
}
async function finalize(id) {
  await db.query("select set_config('test.role','service_role',false)");
  await db.query('select acquire_finance_dispatch($1,$2)', [id,token]);
  const result = (await db.query("select (finalize_finance_billing($1,$2,'test.pdf','testhash','drive','folder','item','url')).*", [id,token])).rows[0];
  await db.query('select release_finance_dispatch($1,$2)', [id,token]);
  await db.query("select set_config('test.role','authenticated',false)");
  return result;
}
before(async () => {
  if (!db) return;
  await db.connect();
  await db.query('drop schema if exists finance_private cascade; drop schema if exists public cascade; drop schema if exists auth cascade; create schema public;');
  await db.query(await read('./fixtures/finance-billing-schema.sql'));
  await db.query(await read('../supabase/migrations/20260821190000_finance_transaction_accounts.sql'));
  await db.query(await read('../supabase/migrations/20260821203000_finance_transaction_issuance_modes.sql'));
  await db.query('alter function reserve_finance_transaction_account(uuid,date,text,text,text,jsonb) rename to reserve_finance_transaction_account_legacy_impl');
  await db.query(await read('../supabase/migrations/20261029222210_finance_funder_billing.sql'));
  await db.query(await read('../supabase/migrations/20261029224142_finance_receipts_manual_accounts.sql'));
  await db.query("select set_config('test.uid','44444444-4444-4444-8444-444444444444',false),set_config('test.app_role','admin',false)");
  clock = (await db.query(`select now()::text as now,(now() at time zone 'Asia/Jerusalem')::date::text today,
    (date_trunc('month',now() at time zone 'Asia/Jerusalem')::date-1)::text cutoff,
    (date_trunc('month',now() at time zone 'Asia/Jerusalem')::date-2)::text past,
    ((now() at time zone 'Asia/Jerusalem')::date+30)::text future`)).rows[0];
});
after(async () => { if (db) await db.end(); });
beforeEach(async () => {
  if (!db) return;
  await db.query(`truncate finance_private.payment_operations,finance_audit_events,finance_receipt_allocations,finance_receipts,finance_billing_claims,finance_transaction_account_meetings,finance_transaction_account_lines,finance_private.dispatch_leases,
    finance_transaction_accounts,activity_funding_sources,activities,schools,authorities,funding_sources,course_meeting_cancellations;
    select set_config('test.app_role','admin',false),set_config('test.permission','false',false),set_config('test.role','authenticated',false);
    insert into schools values(1,'123'); insert into authorities values(1,'רשות א');
    insert into funding_sources values('${gefen}','גפ״ן'),('${authority}','רשות');`);
  await db.query(`insert into activities(id,row_id,school_id,authority_id,school,authority,funding,price,sessions,end_time,activity_name,activity_no,status,date_1,date_2)
    values(1,'a',1,1,'בית ספר','רשות א','גפן + רשות',12000,'2','12:00','פעילות','123','פתוח',$1,$2)`,[clock.past,clock.future]);
  await db.query('insert into activity_funding_sources values(1,$1,5000),(1,$2,7000)',[gefen,authority]);
});
const check = (name,fn) => test(name, { skip: !url }, fn);
check('mixed funding: one monthly Gefen meeting; authority waits until last updated meeting',async () => {
  let r = await preview(); assert.equal(r.find(x=>x.fundingSourceId===gefen).issuableAmount,2500);
  assert.equal(r.find(x=>x.fundingSourceId===gefen).eligible,true);
  assert.equal(r.find(x=>x.fundingSourceId===authority).eligible,false);
  await db.query('update activities set date_2=$1',[clock.past]);
  r=await preview(); assert.equal(r.find(x=>x.fundingSourceId===authority).issuableAmount,7000);
  await db.query('update activities set date_2=$1',[clock.future]);
  assert.equal((await preview()).find(x=>x.fundingSourceId===authority).eligible,false);
});
check('same day slots retain identity; separate funders cannot double claim a participation',async () => {
  await db.query('update activities set date_2=date_1');
  const r=await preview(); const g=r.find(x=>x.fundingSourceId===gefen),a=r.find(x=>x.fundingSourceId===authority);
  assert.deepEqual(g.unbilledSlots.map(s=>s.slot),[1,2]);
  const ga=await reserve(g); await finalize(ga.id);
  assert.equal((await preview()).find(x=>x.fundingSourceId===gefen).eligible,false);
  const aa=await reserve(a); await finalize(aa.id);
  assert.equal(Number(ga.total_amount)+Number(aa.total_amount),12000);
  await assert.rejects(reserve(g),/billing_blocked/);
  assert.equal((await db.query('select count(*) n from finance_billing_claims')).rows[0].n,'4');
});
check('cancellations exclude value and do not redistribute the cancelled share',async () => {
  await db.query('update activities set date_2=date_1+1');
  await db.query("insert into course_meeting_cancellations select row_id,date_2 from activities");
  const r=await preview(); assert.equal(r.find(x=>x.fundingSourceId===authority).issuableAmount,3500);
  assert.equal(r.find(x=>x.fundingSourceId===gefen).issuableAmount,2500);
});
check('missing slots, additions beyond plan, removed slots and cancelled/deleted activities block completion',async () => {
  await db.query('update activities set date_2=null');
  assert.equal((await preview()).find(x=>x.fundingSourceId===authority).eligible,false);
  await db.query('update activities set date_2=date_1,date_3=date_1');
  assert.match((await preview())[0].blockedReason,/מספר המפגשים/);
  await db.query('update activities set sessions=\'3\'');
  assert.equal((await preview()).find(x=>x.fundingSourceId===authority).eligible,true);
  for(const status of ['נמחק','בוטל','מבוטל','deleted','cancelled']) {
    await db.query('update activities set status=$1',[status]);
    assert.ok((await preview()).every(x=>!x.eligible));
  }
});
check('today is completed strictly after Israel end time, including DST transition',async () => {
  await db.query("update activities set date_1='2026-10-25',date_2='2026-10-25',end_time='12:00'");
  assert.equal((await rows('2026-10-25T09:59:00Z'))[0].completedCount,0);
  assert.equal((await rows('2026-10-25T10:00:00Z'))[0].completedCount,0);
  assert.equal((await rows('2026-10-25T10:00:01Z'))[0].completedCount,2);
});
check('previous months remain distinct; current month Gefen cannot be issued manually',async () => {
  await db.query("update activities set date_1='2026-07-01',date_2='2026-08-01'");
  const g=(await preview()).filter(x=>x.gefenFunding);
  assert.deepEqual(g.map(x=>x.period),['2026-07-01','2026-08-01']);
  await assert.rejects(reserve(g[0],{issue_mode:'manual'}),/invalid_cutoff|wrong_billing_tab/);
  await db.query('update activities set date_1=$1,date_2=$1,end_time=\'00:00\'',[clock.today]);
  assert.equal((await preview()).find(x=>x.gefenFunding).eligible,false);
});
check('invalid allocation blocks without guessing and legacy documents remain unchanged',async () => {
  await db.query('update activity_funding_sources set amount=null where funding_source_id=$1',[gefen]);
  assert.ok((await preview()).every(x=>x.blockedReason.includes('חלוקת מימון')));
  await db.query('update activity_funding_sources set amount=6000 where funding_source_id=$1',[gefen]);
  assert.ok((await preview()).every(x=>!x.eligible));
  await db.query('update activity_funding_sources set amount=5000 where funding_source_id=$1',[gefen]);
  await db.query(`insert into finance_transaction_accounts(id,idempotency_key,cutoff_date,institution_symbol,customer_name_snapshot,total_amount,document_status,payment_due_date)
    values($1,$1,$2,'123','legacy',6000,'issued',$2)`,[token,clock.today]);
  await db.query(`insert into finance_transaction_account_lines(account_id,activity_row_id,activity_name_snapshot,activity_price_snapshot,planned_meeting_count_snapshot,hourly_rate_snapshot,billed_hours,amount)
    values($1,'a','legacy',12000,2,4000,1.5,6000)`,[token]);
  assert.ok((await preview()).every(x=>x.blockedReason.includes('חשבון קודם')));
  assert.equal((await db.query('select amount from finance_transaction_account_lines')).rows[0].amount,'6000.00');
});
check('server rejects tampered amount, slots, funder and stale reservation before finalization',async () => {
  const g=(await preview()).find(x=>x.gefenFunding);
  await assert.rejects(reserve(g,{expected_amount:1}),/stale_billing_preview/);
  await assert.rejects(reserve(g,{meeting_slots:[2]}),/stale_billing_preview/);
  await assert.rejects(reserve(g,{funding_source_id:token}),/billing_blocked/);
  const account=await reserve(g);
  await db.query('update activities set date_1=$1',[clock.future]);
  await assert.rejects(finalize(account.id),/stale_billing_reservation/);
  assert.equal((await db.query('select document_status from finance_transaction_accounts')).rows[0].document_status,'generating');
});
check('funding cap survives reduced allocation, claimed meetings and idempotent retry',async () => {
  const g=(await preview()).find(x=>x.gefenFunding);const key=crypto.randomUUID();
  const account=await reserve(g,{},key); assert.equal((await reserve(g,{},key)).id,account.id);
  await finalize(account.id);
  await db.query('update activity_funding_sources set amount=1000 where funding_source_id=$1',[gefen]);
  await db.query('update activity_funding_sources set amount=11000 where funding_source_id=$1',[authority]);
  assert.match((await preview()).find(x=>x.gefenFunding).blockedReason,/חורג/);
});
check('generated claims release on cancellation without changing issued snapshots',async () => {
  const g=(await preview()).find(x=>x.gefenFunding); const account=await reserve(g);
  await db.query('select cancel_generating_finance_transaction_account($1,\'test\')',[account.id]);
  assert.equal((await preview()).find(x=>x.gefenFunding).eligible,true);
  assert.equal((await db.query('select count(*) n from finance_billing_claims')).rows[0].n,'0');
});
check('permission gates and backend-only finalization preserve role separation',async () => {
  const g=(await preview()).find(x=>x.gefenFunding);
  await db.query("select set_config('test.app_role','',false),set_config('test.permission','false',false)");
  await assert.rejects(preview(),/finance_permission_denied/);
  await assert.rejects(reserve(g),/finance_transactions_permission_denied/);
  assert.equal((await db.query("select has_function_privilege('authenticated','public.finalize_finance_billing(uuid,uuid,text,text,text,text,text,text)','execute') ok")).rows[0].ok,false);
  assert.equal((await db.query("select has_function_privilege('service_role','public.reserve_finance_transaction_account_legacy_impl(uuid,date,text,text,text,jsonb)','execute') ok")).rows[0].ok,false);
});
check('completion month follows live last noncancelled slot and rejects a forged month',async () => {
  await db.query("update activities set date_1='2026-07-01',date_2='2026-08-12'");
  let a=(await preview()).find(x=>!x.gefenFunding);
  assert.equal(a.period,'2026-08-01');
  await assert.rejects(reserve(a,{performance_month:'2026-07-01'}),/billing_blocked/);
  await db.query("update activities set date_2='2026-09-12'");
  a=(await preview()).find(x=>!x.gefenFunding);assert.equal(a.period,'2026-09-01');
  await db.query("insert into course_meeting_cancellations values('a','2026-09-12')");
  a=(await preview()).find(x=>!x.gefenFunding);assert.equal(a.period,'2026-07-01');
  assert.equal(a.issuableAmount,3500);
});
check('per-funder rounding across monthly accounts and cancelled slots preserves exact prorata total',async () => {
  await db.query("update activities set sessions='3',price=200,date_1='2026-06-01',date_2='2026-07-01',date_3='2026-08-01'");
  await db.query('update activity_funding_sources set amount=100');
  await db.query("insert into course_meeting_cancellations values('a','2026-07-01')");
  const g=(await preview()).filter(x=>x.gefenFunding);
  assert.equal(g.reduce((n,r)=>n+Number(r.issuableAmount),0),66.67);
  for(const row of g) { const a=await reserve(row); await finalize(a.id); }
  const a=await reserve((await preview()).find(x=>!x.gefenFunding));await finalize(a.id);
  assert.equal((await db.query('select sum(amount) total from finance_transaction_account_lines where funding_source_id=$1',[gefen])).rows[0].total,'66.67');
  await assert.rejects(db.query("update finance_transaction_account_lines set amount=0"),/issued_snapshot_is_immutable/);
});
check('simultaneous reservations serialize and only one can claim a funder meeting',async () => {
  const row=(await preview()).find(x=>x.gefenFunding);
  const other=new pg.Client({connectionString:url}); await other.connect();
  try {
    await other.query("select set_config('test.uid','44444444-4444-4444-8444-444444444444',false),set_config('test.app_role','admin',false)");
    const line={activity_row_id:'a',funding_source_id:gefen,performance_month:row.period,expected_amount:row.issuableAmount,meeting_slots:[1],issue_mode:'automatic'};
    const call=client=>client.query("select reserve_finance_transaction_account($1,$2,'123','x',null,$3)",[crypto.randomUUID(),clock.cutoff,JSON.stringify([line])]);
    const result=await Promise.allSettled([call(db),call(other)]);
    assert.equal(result.filter(x=>x.status==='fulfilled').length,1);
    assert.equal((await db.query('select count(*) n from finance_billing_claims')).rows[0].n,'1');
  } finally {await other.end();}
});
check('abandoned reservation becomes visible and a fresh reservation safely reclaims its slots',async () => {
  const g=(await preview()).find(x=>x.gefenFunding);const stuck=await reserve(g);
  assert.equal((await preview()).find(x=>x.gefenFunding).billedCount,0);
  assert.match((await preview()).find(x=>x.gefenFunding).blockedReason,/הפקה בתהליך/);
  await db.query("update finance_transaction_accounts set created_at=now()-interval '16 minutes' where id=$1",[stuck.id]);
  const restored=(await preview()).find(x=>x.gefenFunding);assert.equal(restored.eligible,true);
  const retry=await reserve(restored);assert.notEqual(retry.id,stuck.id);
  assert.equal((await db.query('select document_status from finance_transaction_accounts where id=$1',[stuck.id])).rows[0].document_status,'cancelled');
});
check('partial monthly claims retain only remaining meetings and moved billed slots never reappear',async () => {
  await db.query("update activities set date_1='2025-12-01',date_2='2026-01-01'");
  const first=(await preview()).find(x=>x.gefenFunding&&x.period==='2025-12-01');
  const account=await reserve(first);await finalize(account.id);
  const snapshot=await db.query('select row_to_json(l) value from finance_transaction_account_lines l where account_id=$1',[account.id]);
  await db.query("update activities set date_1='2026-02-01'");
  const remaining=(await preview()).filter(x=>x.gefenFunding&&x.eligible);
  assert.deepEqual(remaining.flatMap(x=>x.unbilledSlots.map(s=>s.slot)),[2]);
  assert.equal(remaining[0].issuableAmount,2500);
  assert.deepEqual((await db.query('select row_to_json(l) value from finance_transaction_account_lines l where account_id=$1',[account.id])).rows,snapshot.rows);
});
check('authenticated RPC works through its permission gate and anonymous/private entrypoints stay denied',async () => {
  await db.query('set role authenticated');
  assert.ok((await preview()).length>0);
  await assert.rejects(db.query('select * from public.finance_billing_claims'),/permission denied/);
  await db.query('reset role; set role anon');
  await assert.rejects(preview(),/permission denied/);
  await db.query('reset role');
});
check('cancelled issued account preserves its history and reopens exactly the same funding participation',async () => {
  const row=(await preview()).find(x=>x.gefenFunding);const account=await reserve(row);await finalize(account.id);
  await db.query("update finance_transaction_accounts set document_status='cancelled' where id=$1",[account.id]);
  const remaining=(await preview()).find(x=>x.gefenFunding);assert.equal(remaining.issuableAmount,2500);
  const replacement=await reserve(remaining);assert.notEqual(replacement.id,account.id);
  assert.equal((await db.query('select amount from finance_transaction_account_lines where account_id=$1',[account.id])).rows[0].amount,'2500.00');
});
check('partially issued performance month keeps only its newly performed unbilled remainder',async () => {
  const first=(await preview()).find(x=>x.gefenFunding);const account=await reserve(first);await finalize(account.id);
  await db.query('update activities set date_2=date_1');
  const remaining=(await preview()).find(x=>x.gefenFunding);
  assert.equal(remaining.period,first.period);assert.equal(remaining.issuableAmount,2500);assert.deepEqual(remaining.unbilledSlots.map(s=>s.slot),[2]);
});
async function recordReceipt(extra={},allocations=[],key=crypto.randomUUID()) {
  const receipt={funding_source_id:gefen,payer_name:'בית ספר',activity_row_id:'a',amount:1000,received_date:clock.today,reference:crypto.randomUUID(),...extra};
  return (await db.query('select finance_record_receipt($1,$2,$3) id',[key,receipt,JSON.stringify(allocations)])).rows[0].id;
}
async function paymentContext(){return(await db.query('select finance_payment_context() value')).rows[0].value;}
check('payment terms are calculated per funder from issue-month end and saved in the invoice',async()=>{
  await db.query('update activities set date_2=date_1');
  const r=await preview();const g=await reserve(r.find(x=>x.gefenFunding));const a=await reserve(r.find(x=>!x.gefenFunding));
  assert.equal((new Date(a.payment_due_date)-new Date(g.payment_due_date))/86400000,15);
  assert.equal((await db.query("select ((date_trunc('month','2026-10-15'::date)+interval '1 month - 1 day')::date+finance_private.payment_days('ויצו'))::text due")).rows[0].due,'2026-12-15');
});
check('full manual invoice before performance closes only the selected funding share and never appears automatically again',async()=>{
  await db.query('update activities set date_1=$1,date_2=$1',[clock.future]);
  const draft={billing_basis:'full_funding'};
  const quote=(await db.query("select finance_manual_account_quote('a',$1,$2,$3) value",[authority,clock.future.slice(0,7)+'-01',draft])).rows[0].value;
  assert.equal(quote.total_amount,7000);assert.deepEqual(quote.selected_slots,[]);
  const account=(await db.query("select (reserve_finance_manual_account($1,'a',$2,$3,$4,$5)).*",[crypto.randomUUID(),authority,clock.future.slice(0,7)+'-01',draft,quote.revision])).rows[0];
  await finalize(account.id);
  await recordReceipt({funding_source_id:authority,payer_name:'רשות א',activity_row_id:'a',amount:7000},[{account_id:account.id,activity_row_id:'a',amount:7000}]);
  assert.equal((await paymentContext()).balances.find(x=>x.accountId===account.id).balance,0);
  await db.query('update activities set date_1=$1,date_2=$1',[clock.past]);
  const after=await preview();assert.equal(after.find(x=>!x.gefenFunding).eligible,false);assert.equal(after.find(x=>x.gefenFunding).issuableAmount,5000);
  await assert.rejects(db.query("select finance_manual_account_quote('a',$1,$2,$3)",[authority,clock.past.slice(0,7)+'-01',draft]),/billing_blocked/);
});
check('partial and late receipts update only the linked account, then full settlement archives it',async()=>{
  const account=await reserve((await preview()).find(x=>x.gefenFunding));await finalize(account.id);
  await db.query("update finance_transaction_accounts set payment_due_date='2026-01-01' where id=$1",[account.id]);
  await recordReceipt({amount:1000},[{account_id:account.id,activity_row_id:'a',amount:1000}]);
  let c=await paymentContext();assert.equal(c.balances.find(x=>x.accountId===account.id).balance,1500);
  assert.equal((await db.query('select collection_status from finance_transaction_accounts where id=$1',[account.id])).rows[0].collection_status,'partially_paid');
  await recordReceipt({amount:1500,received_date:clock.past},[{account_id:account.id,activity_row_id:'a',amount:1500}]);
  c=await paymentContext();assert.equal(c.balances.find(x=>x.accountId===account.id).balance,0);
});
check('unidentified activity remains unallocated until explicit association; voiding reopens the balance',async()=>{
  const account=await reserve((await preview()).find(x=>x.gefenFunding));await finalize(account.id);
  const receipt=await recordReceipt({activity_row_id:null,amount:1000});
  assert.equal((await paymentContext()).balances.find(x=>x.accountId===account.id).balance,2500);
  await db.query('select finance_allocate_receipt($1,$2)',[receipt,JSON.stringify([{account_id:account.id,activity_row_id:'a',amount:1000}])]);
  assert.equal((await paymentContext()).balances.find(x=>x.accountId===account.id).balance,1500);
  await db.query('select finance_void_receipt($1,\'שגיאת הזנה\')',[receipt]);
  assert.equal((await paymentContext()).balances.find(x=>x.accountId===account.id).balance,2500);
  await assert.rejects(db.query('select finance_void_receipt($1,\'שוב\')',[receipt]),/already_voided/);
});
check('one receipt may split across several invoices of the same stable payer without over-allocation',async()=>{
  await db.query("update activities set date_1='2026-07-01',date_2='2026-08-01'");
  const r=(await preview()).filter(x=>x.gefenFunding);const a=await reserve(r[0]);await finalize(a.id);const b=await reserve((await preview()).find(x=>x.gefenFunding&&x.eligible));await finalize(b.id);
  const receipt=await recordReceipt({activity_row_id:null,payer_key:'school:1',amount:3000},[{account_id:a.id,activity_row_id:'a',amount:1500},{account_id:b.id,activity_row_id:'a',amount:1500}]);
  const c=await paymentContext();assert.equal(c.balances.filter(x=>[a.id,b.id].includes(x.accountId)).reduce((n,x)=>n+x.balance,0),2000);
  await assert.rejects(db.query('select finance_allocate_receipt($1,$2)',[receipt,JSON.stringify([{account_id:b.id,activity_row_id:'a',amount:1}])]),/already_allocated/);
});
check('receipt idempotency, duplicate evidence and wrong funding participation cannot double-pay',async()=>{
  const key=crypto.randomUUID();const reference='bank-123';const id=await recordReceipt({reference},[],key);
  assert.equal(await recordReceipt({reference},[],key),id);
  await assert.rejects(recordReceipt({reference}),/unique/);
  const account=await reserve((await preview()).find(x=>x.gefenFunding));await finalize(account.id);
  const receipt=await recordReceipt({funding_source_id:authority,payer_name:'רשות א',activity_row_id:null,amount:500,payer_key:'authority:1'});
  await assert.rejects(db.query('select finance_allocate_receipt($1,$2)',[receipt,JSON.stringify([{account_id:account.id,activity_row_id:'a',amount:500}])]),/mismatch/);
});
check('cancelling a paid account preserves its PDF and payment evidence; reassignment to a replacement is explicit',async()=>{
  const account=await reserve((await preview()).find(x=>x.gefenFunding));await finalize(account.id);
  const receipt=await recordReceipt({amount:2500},[{account_id:account.id,activity_row_id:'a',amount:2500}]);
  await db.query('select finance_cancel_issued_account($1,\'תיקון מסמך\')',[account.id]);
  assert.equal((await db.query('select generated_filename from finance_transaction_accounts where id=$1',[account.id])).rows[0].generated_filename,'test.pdf');
  const replacement=await reserve((await preview()).find(x=>x.gefenFunding));await finalize(replacement.id);
  assert.equal((await paymentContext()).balances.find(x=>x.accountId===replacement.id).balance,2500);
  await db.query('select finance_allocate_receipt($1,$2)',[receipt,JSON.stringify([{account_id:replacement.id,activity_row_id:'a',amount:2500}])]);
  assert.equal((await paymentContext()).balances.find(x=>x.accountId===replacement.id).balance,0);
  assert.equal((await db.query('select count(*) n from finance_receipt_allocations where released_at is not null')).rows[0].n,'1');
});
async function manualQuote(draft={}) {
  const row=(await preview()).find(x=>x.gefenFunding);
  const q=(await db.query("select finance_manual_account_quote('a',$1,$2,$3) value",[gefen,row.period,draft])).rows[0].value;
  return {q,row};
}
check('editable invoice snapshots allow partial amount and keep unbilled cents available without editing activities',async()=>{
  const draft={description:'תיאור מותאם',customer_name:'שם לקוח במסמך',quantity:1,hours:1,unit_price:1000,amount:1000};const {q,row}=await manualQuote(draft);
  const account=(await db.query('select (reserve_finance_manual_account($1,\'a\',$2,$3,$4,$5)).*',[crypto.randomUUID(),gefen,row.period,draft,q.revision])).rows[0];
  await finalize(account.id);
  assert.equal((await db.query('select service_description_snapshot from finance_transaction_account_lines where account_id=$1',[account.id])).rows[0].service_description_snapshot,'תיאור מותאם');
  assert.equal((await db.query("select price,activity_name from activities where row_id='a'")).rows[0].price,'12000');
  assert.equal((await preview()).find(x=>x.gefenFunding).issuableAmount,1500);
});
check('manual editing rejects overfunding, future completion, nonexistent activities and unauthorized term exceptions',async()=>{
  await assert.rejects(manualQuote({amount:10000,unit_price:10000}),/חורגים/);
  await db.query("select set_config('test.app_role','finance',false),set_config('test.permission','true',false)");
  await assert.rejects(manualQuote({issue_date:'2026-01-01'}),/הרשאת מנהל/);
  await assert.rejects(db.query("select finance_manual_account_quote('not-found',$1,'2026-09-01','{}')",[gefen]),/activity_not_found/);
  await assert.rejects(db.query("select finance_manual_account_quote('a',$1,$2,'{}')",[authority,clock.future.slice(0,7)+'-01']),/billing_blocked/);
});
check('manual preview revision detects stale data and records approved admin exceptions',async()=>{
  const draft={issue_date:'2026-01-01',payment_due_date:'2026-03-01',override_reason:'תיקון מועד מאושר'};const {q,row}=await manualQuote(draft);
  await db.query('update activities set date_1=date_1-1');
  await assert.rejects(db.query('select reserve_finance_manual_account($1,\'a\',$2,$3,$4,$5)',[crypto.randomUUID(),gefen,row.period,draft,q.revision]),/המקדימה השתנתה/);
  const fresh=(await manualQuote(draft)).q;
  const account=(await db.query('select (reserve_finance_manual_account($1,\'a\',$2,$3,$4,$5)).*',[crypto.randomUUID(),gefen,row.period,draft,fresh.revision])).rows[0];
  assert.ok(account.manual_draft.override_reason);assert.equal((await db.query("select count(*) n from finance_audit_events where event_type='manual_account_reserved'")).rows[0].n,'1');
});
check('authority IDs separate payers, consolidate spelling variants, and missing identities block issuance',async()=>{
  await db.query("insert into authorities values(2,'עיריית רחובות'); update activities set date_2=date_1,authority='כתיב ישן';");
  let a=(await preview()).find(x=>!x.gefenFunding);assert.equal(a.payerKey,'authority:1');assert.equal(a.payerName,'רשות א');
  const issued=await reserve(a);await finalize(issued.id);
  await db.query("update activities set authority_id=2,authority='רחובות'");
  assert.equal((await db.query('select payer_key_snapshot from finance_transaction_accounts where id=$1',[issued.id])).rows[0].payer_key_snapshot,'authority:1');
  await db.query('update activities set authority_id=null');
  assert.match((await preview()).find(x=>!x.gefenFunding).blockedReason,/זהות הרשות/);
});
check('fully paid funding changes create an accounting difference, never a second automatic invoice',async()=>{
  await db.query('update activities set date_2=date_1');const a=await reserve((await preview()).find(x=>x.gefenFunding));await finalize(a.id);
  await recordReceipt({amount:5000},[{account_id:a.id,activity_row_id:'a',amount:5000}]);
  await db.query('update activities set price=13000');await db.query('update activity_funding_sources set amount=6000 where funding_source_id=$1',[gefen]);
  const row=(await preview()).find(x=>x.gefenFunding);assert.equal(row.eligible,false);assert.equal(row.financialAdjustment,1000);assert.match(row.blockedReason,/בדיקת כספים/);
  assert.equal((await db.query('select total_amount from finance_transaction_accounts where id=$1',[a.id])).rows[0].total_amount,'5000.00');
});
check('payment correction reopens a fully settled invoice and keeps the receipt audit trail',async()=>{
  const a=await reserve((await preview()).find(x=>x.gefenFunding));await finalize(a.id);
  const r=await recordReceipt({amount:2500,reference:''},[{account_id:a.id,activity_row_id:'a',amount:2500}]);
  assert.equal((await paymentContext()).balances.find(x=>x.accountId===a.id).balance,0);
  await db.query('select finance_void_receipt($1,\'תיקון מאושר\')',[r]);
  assert.equal((await paymentContext()).balances.find(x=>x.accountId===a.id).balance,2500);
  assert.equal((await db.query('select collection_status from finance_transaction_accounts where id=$1',[a.id])).rows[0].collection_status,'awaiting_payment');
  assert.equal((await db.query("select count(*) n from finance_audit_events where event_type='receipt_voided'")).rows[0].n,'1');
});
check('different authorities cannot allocate one another\'s receipt despite sharing the same funding source',async()=>{
  await db.query("insert into authorities values(2,'עיריית נהרייה'); update activities set date_2=date_1;");
  const account=await reserve((await preview()).find(x=>!x.gefenFunding));await finalize(account.id);
  const receipt=await recordReceipt({funding_source_id:authority,payer_name:'עיריית נהרייה',activity_row_id:null,payer_key:'authority:2',amount:500});
  await assert.rejects(db.query('select finance_allocate_receipt($1,$2)',[receipt,JSON.stringify([{account_id:account.id,activity_row_id:'a',amount:500}])]),/mismatch/);
});
check('Gefen can be manually covered in full before any meeting without suppressing another financier',async()=>{
  await db.query('update activities set date_1=$1,date_2=$1',[clock.future]);const draft={billing_basis:'full_funding'};
  const quote=(await db.query("select finance_manual_account_quote('a',$1,$2,$3) value",[gefen,clock.future.slice(0,7)+'-01',draft])).rows[0].value;
  const account=(await db.query("select (reserve_finance_manual_account($1,'a',$2,$3,$4,$5)).*",[crypto.randomUUID(),gefen,clock.future.slice(0,7)+'-01',draft,quote.revision])).rows[0];await finalize(account.id);
  await db.query('update activities set date_1=$1,date_2=$1',[clock.past]);const remaining=await preview();assert.equal(remaining.find(x=>x.gefenFunding).eligible,false);assert.equal(remaining.find(x=>!x.gefenFunding).issuableAmount,7000);
});
check('receipt and audit writes are RPC-only and preserve the acting finance user',async()=>{
  const receipt=await recordReceipt();assert.equal((await db.query('select created_by from finance_receipts where id=$1',[receipt])).rows[0].created_by,'44444444-4444-4444-8444-444444444444');
  await db.query('set role authenticated');
  await assert.rejects(db.query('select * from finance_receipts'),/permission denied/);await assert.rejects(db.query('select * from finance_audit_events'),/permission denied/);
  await db.query('reset role');
  assert.equal((await db.query("select count(*) n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='finance_private' and has_function_privilege('authenticated',p.oid,'execute')")).rows[0].n,'0');
});
check('allocation retries are idempotent even when both receipt and invoice still have unused balances',async()=>{
  const account=await reserve((await preview()).find(x=>x.gefenFunding));await finalize(account.id);
  const receipt=await recordReceipt({activity_row_id:null,payer_key:'school:1',amount:2500});
  const payload=JSON.stringify([{account_id:account.id,activity_row_id:'a',amount:1000}]);const operation=crypto.randomUUID();
  await db.query('select finance_allocate_receipt($1,$2,$3)',[receipt,payload,operation]);await db.query('select finance_allocate_receipt($1,$2,$3)',[receipt,payload,operation]);
  assert.equal((await paymentContext()).balances.find(x=>x.accountId===account.id).balance,1500);
  await assert.rejects(db.query('select finance_allocate_receipt($1,$2,$3)',[receipt,JSON.stringify([{account_id:account.id,activity_row_id:'a',amount:500}]),operation]),/operation_mismatch/);
});
check('cancellation after a fully paid invoice creates a visible difference without altering the document',async()=>{
  await db.query('update activities set date_2=date_1+1');const account=await reserve((await preview()).find(x=>x.gefenFunding));await finalize(account.id);
  await recordReceipt({amount:5000},[{account_id:account.id,activity_row_id:'a',amount:5000}]);
  await db.query("insert into course_meeting_cancellations select 'a',date_2 from activities");
  const row=(await preview()).find(x=>x.gefenFunding);assert.equal(row.financialAdjustment,-2500);assert.equal(row.eligible,false);assert.match(row.blockedReason,/בדיקת כספים/);
  assert.equal((await db.query('select total_amount from finance_transaction_accounts where id=$1',[account.id])).rows[0].total_amount,'5000.00');
});
