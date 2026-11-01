-- Run with psql -v ON_ERROR_STOP=1 -f tests/finance-service-billing-regression.sql.
-- Clones only finance dependencies into private test schemas, with independent
-- sequences. No real accounts, activity rows, numbering, PDFs or email are touched.
-- All test schemas, functions and records are rolled back, including on failure.
begin;
set local lock_timeout='5s';
create schema qa_service_public;
create schema qa_service_private;
create schema qa_service_auth;
revoke all on schema qa_service_public,qa_service_private,qa_service_auth from public;
set local search_path=qa_service_public,pg_catalog;

do $clone$
declare name text; item record; ddl text;
begin
  foreach name in array array['activities','schools','authorities','funding_sources',
    'activity_funding_sources','course_meeting_cancellations','finance_transaction_accounts',
    'finance_transaction_account_lines','finance_transaction_account_meetings',
    'finance_billing_claims','finance_receipts','finance_receipt_allocations','finance_audit_events']
  loop
    execute format('create table qa_service_public.%I (like public.%I including all)',name,name);
  end loop;
  create table qa_service_private.dispatch_leases (like finance_private.dispatch_leases including all);
  -- LIKE copies serial defaults: replace every copied nextval with a test sequence.
  for item in
    select c.relname,a.attname from pg_attrdef d
    join pg_class c on c.oid=d.adrelid join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=c.oid and a.attnum=d.adnum
    where n.nspname='qa_service_public' and pg_get_expr(d.adbin,d.adrelid) like 'nextval(%'
  loop
    name:=item.relname||'_'||item.attname||'_qa_seq';
    execute format('create sequence qa_service_public.%I',name);
    execute format('alter table qa_service_public.%I alter column %I set default nextval(%L)',
      item.relname,item.attname,'qa_service_public.'||name);
  end loop;
end $clone$;
create function qa_service_auth.uid() returns uuid language sql stable as
  $$select '44444444-4444-4444-8444-444444444444'::uuid$$;
create function qa_service_auth.role() returns text language sql stable as $$select 'authenticated'::text$$;
create function qa_service_public.app_current_role() returns text language sql stable as
  $$select coalesce(current_setting('test.service_role',true),'admin')$$;
create function qa_service_public.app_has_permission(text) returns boolean language sql stable as $$select false$$;
select set_config('test.service_role','admin',true);
do $functions$
declare item record; ddl text;
begin
  for item in
    select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='finance_private' and p.proname in
      ('account_paid','resolved_funding_rows','billing_rows','payment_days',
       'finish_reservation','assert_current','cancel_reservation','guard_document_snapshot',
       'guard_finance_school_2027_line','validate_finalization','sync_collection_lifecycle','manual_quote'))
    or (n.nspname='public' and p.proname in
      ('finance_is_gefen_funding','finance_transaction_can_issue','finance_manual_account_quote',
       'reserve_finance_transaction_account','reserve_finance_manual_account',
       'finance_funder_batch_quote','reserve_finance_funder_batch_account'))
    order by case when n.nspname='finance_private' then 0 else 1 end,p.oid
  loop
    ddl:=replace(replace(replace(pg_get_functiondef(item.oid),
      'public.','qa_service_public.'),'finance_private.','qa_service_private.'),'auth.','qa_service_auth.');
    execute ddl;
  end loop;
  for item in select t.oid from pg_trigger t where not t.tgisinternal
    and t.tgrelid in ('public.finance_transaction_accounts'::regclass,
      'public.finance_transaction_account_lines'::regclass,'public.finance_transaction_account_meetings'::regclass)
  loop
    ddl:=replace(replace(pg_get_triggerdef(item.oid),'public.','qa_service_public.'),'finance_private.','qa_service_private.');
    execute ddl;
  end loop;
end $functions$;

-- CANDIDATE_MIGRATION

insert into qa_service_public.schools(id,semel_mosad,school_name) values(1,123456,'בדיקת סדנאות');
insert into qa_service_public.funding_sources(id,name) values
  ('11111111-1111-4111-8111-111111111111','תמיר'),
  ('22222222-2222-4222-8222-222222222222','גפ״ן');
insert into qa_service_public.activities(id,row_id,school_id,school,activity_type,activity_season,
  activity_name,activity_no,funding,price,sessions,status,date_1,date_2,end_time,instruction_language)
select n,'service-test-'||n,1,'בדיקת סדנאות',
  case when n=4 then 'tour' when n=5 then 'course' else 'workshop' end,
  'school_2027','פעילות בדיקה','60025',case when n=5 then 'גפ״ן' else 'תמיר' end,
  case when n=4 then 900 when n=5 then 1200 else 435 end,
  case when n=4 then null when n=5 then '2' else '1' end,'סגור',
  date_trunc('month',now() at time zone 'Asia/Jerusalem')::date-3,
  case when n=5 then date_trunc('month',now() at time zone 'Asia/Jerusalem')::date-2 end,'12:00'::time,'he'
from generate_series(1,9) n;
insert into qa_service_public.activity_funding_sources(activity_id,funding_source_id,amount)
select id,case when id=5 then '22222222-2222-4222-8222-222222222222'::uuid
  else '11111111-1111-4111-8111-111111111111'::uuid end,price
from qa_service_public.activities;

create temporary table service_test_results(name text,passed boolean) on commit drop;
do $tests$
declare r jsonb; req jsonb; quote jsonb; draft jsonb; items jsonb; a qa_service_public.finance_transaction_accounts;
  l qa_service_public.finance_transaction_account_lines; key uuid; test_today date;
begin
  test_today:=(now() at time zone 'Asia/Jerusalem')::date;
  select jsonb_agg(jsonb_build_object('activity_row_id',x->>'activityRowId',
    'funding_source_id',x->>'fundingSourceId','performance_month',x->>'period',
    'expected_amount',x->'issuableAmount','meeting_slots',jsonb_build_array(1),'issue_mode','manual'))
  into req from qa_service_public.activities src
    cross join lateral jsonb_array_elements(qa_service_private.billing_rows(src)) x where src.id in (1,2,3);
  key:=gen_random_uuid();
  a:=qa_service_public.reserve_finance_transaction_account(key,test_today,'123456','ignored',null,req);
  if a.total_amount<>1305 then raise exception 'workshop total mismatch'; end if;
  if (select count(*) from qa_service_public.finance_transaction_account_lines where account_id=a.id
    and quantity_snapshot=1 and unit_price_snapshot=435 and billed_hours=0 and hourly_rate_snapshot is null)<>3
    then raise exception 'workshop quantity snapshots invalid'; end if;
  if (qa_service_public.reserve_finance_transaction_account(key,test_today,'123456','ignored',null,req)).id<>a.id
    then raise exception 'idempotent retry duplicated account'; end if;
  update qa_service_public.finance_transaction_accounts set document_status='issued' where id=a.id;
  if exists(select 1 from qa_service_public.activities src
    cross join lateral jsonb_array_elements(qa_service_private.billing_rows(src)) x
    where src.id in (1,2,3) and (x->>'eligible')::boolean) then raise exception 'issued workshops still billable'; end if;
  begin
    perform qa_service_public.reserve_finance_transaction_account(gen_random_uuid(),test_today,'123456','ignored',null,req);
    raise exception 'duplicate workshop billing accepted';
  exception when raise_exception then if sqlerrm not like 'billing_blocked:%' then raise; end if; end;
  insert into service_test_results values('3 workshops: 1305, quantity, finalization, idempotency, duplicate guard',true);

  for r in select x from qa_service_public.activities src
    cross join lateral jsonb_array_elements(qa_service_private.billing_rows(src)) x where src.id in (4,5)
  loop
    req:=jsonb_build_array(jsonb_build_object('activity_row_id',r->>'activityRowId',
      'funding_source_id',r->>'fundingSourceId','performance_month',r->>'period',
      'expected_amount',r->'issuableAmount',
      'meeting_slots',(select jsonb_agg((s->>'slot')::int) from jsonb_array_elements(r->'unbilledSlots') s),
      'issue_mode',case when (r->>'gefenFunding')::boolean then 'automatic' else 'manual' end));
    a:=qa_service_public.reserve_finance_transaction_account(gen_random_uuid(),
      case when (r->>'gefenFunding')::boolean then date_trunc('month',test_today)::date-1 else test_today end,
      '123456','ignored',null,req);
    select * into l from qa_service_public.finance_transaction_account_lines where account_id=a.id;
    if r->>'activityType'='tour' then
      if l.billed_hours<>0 or l.hourly_rate_snapshot is not null or l.quantity_snapshot<>1 or l.unit_price_snapshot<>900
        then raise exception 'tour snapshot invalid'; end if;
    else
      if l.billed_hours<>3 or l.hourly_rate_snapshot<>400 then raise exception 'course hours changed'; end if;
    end if;
    update qa_service_public.finance_transaction_accounts set document_status='issued' where id=a.id;
    insert into service_test_results values(r->>'activityType'||': reservation and finalization',true);
  end loop;

  select x into r from qa_service_public.activities src
    cross join lateral jsonb_array_elements(qa_service_private.billing_rows(src)) x where src.id=6;
  draft:='{"quantity":1,"hours":1.5,"amount":250,"unit_price":250}'::jsonb;
  quote:=qa_service_public.finance_manual_account_quote(r->>'activityRowId',(r->>'fundingSourceId')::uuid,(r->>'period')::date,draft);
  if (quote->'finance_transaction_account_lines'->0->>'billed_hours')::numeric<>0
    or quote->'finance_transaction_account_lines'->0->>'hourly_rate_snapshot' is not null then raise exception 'manual workshop invented hours'; end if;
  a:=qa_service_public.reserve_finance_manual_account(gen_random_uuid(),r->>'activityRowId',
    (r->>'fundingSourceId')::uuid,(r->>'period')::date,draft,quote->>'revision');
  update qa_service_public.finance_transaction_accounts set document_status='issued' where id=a.id;
  if (select (x->>'issuableAmount')::numeric from qa_service_public.activities src
    cross join lateral jsonb_array_elements(qa_service_private.billing_rows(src)) x where src.id=6)<>185
    then raise exception 'manual partial remainder lost'; end if;
  insert into service_test_results values('editable workshop: zero hours, finalization, exact partial remainder',true);

  select jsonb_agg(jsonb_build_object('activity',x->>'activityRowId','funder',x->>'fundingSourceId',
    'month',x->>'period','draft',jsonb_build_object('quantity',1,'hours',0,'amount',435,'unit_price',435)))
  into items from qa_service_public.activities src
    cross join lateral jsonb_array_elements(qa_service_private.billing_rows(src)) x where src.id in (7,8);
  quote:=qa_service_public.finance_funder_batch_quote(items);
  a:=qa_service_public.reserve_finance_funder_batch_account(gen_random_uuid(),items,quote->>'revision');
  if a.total_amount<>870 or (select count(*) from qa_service_public.finance_transaction_account_lines
    where account_id=a.id and billed_hours=0 and hourly_rate_snapshot is null and unit_price_snapshot=435)<>2
    then raise exception 'consolidated services invalid'; end if;
  update qa_service_public.finance_transaction_accounts set document_status='issued' where id=a.id;
  insert into service_test_results values('consolidated editable workshops: 870, quantity, finalization',true);

  select x into r from qa_service_public.activities src
    cross join lateral jsonb_array_elements(qa_service_private.billing_rows(src)) x where src.id=9;
  begin
    perform qa_service_public.finance_manual_account_quote(r->>'activityRowId',(r->>'fundingSourceId')::uuid,
      (r->>'period')::date,'{"amount":436,"unit_price":436}');
    raise exception 'overbilling accepted';
  exception when raise_exception then if sqlerrm not like '%חורגים%' then raise; end if; end;
  perform set_config('test.service_role','instructor',true);
  begin
    perform qa_service_public.finance_manual_account_quote(r->>'activityRowId',(r->>'fundingSourceId')::uuid,
      (r->>'period')::date,'{}');
    raise exception 'unauthorized invoice accepted';
  exception when insufficient_privilege then null; end;
  insert into service_test_results values('overbilling and unauthorized issuance stay blocked',true);
end $tests$;
select * from service_test_results order by name;
rollback;
