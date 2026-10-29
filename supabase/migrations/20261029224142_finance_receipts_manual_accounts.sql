-- Recorded receipts are accounting evidence entered by finance, never asserted
-- to be bank-verified. All changes use audited RPCs; no direct client writes.
alter table public.finance_transaction_accounts
  add column expected_collection_date date,
  add column finance_note text not null default '',
  add column manual_draft jsonb;
alter table public.finance_transaction_account_lines
  add column billing_coverage text not null default 'performance' check(billing_coverage in ('performance','full_funding')),
  add column school_name_snapshot text,
  add column service_description_snapshot text,
  add column quantity_snapshot numeric,
  add column unit_price_snapshot numeric;
create table public.finance_receipts (
  id uuid primary key default gen_random_uuid(), idempotency_key uuid not null unique,
  funding_source_id uuid references public.funding_sources(id),
  payer_key text, payer_name text not null check(btrim(payer_name)<>''),
  activity_row_id text references public.activities(row_id),
  amount numeric(14,2) not null check(amount>0), received_date date not null,
  reference text not null default '', document_reference text,
  created_at timestamptz not null default now(), created_by uuid not null default auth.uid(),
  voided_at timestamptz,voided_by uuid,void_reason text
);
create unique index finance_receipt_evidence_unique on public.finance_receipts
  (coalesce(funding_source_id,'00000000-0000-0000-0000-000000000000'::uuid),coalesce(payer_key,lower(btrim(payer_name))),received_date,reference,amount) where voided_at is null;
create index finance_receipts_activity_funder_idx on public.finance_receipts(activity_row_id,funding_source_id,received_date);
create table public.finance_receipt_allocations (
  id uuid primary key default gen_random_uuid(), receipt_id uuid not null references public.finance_receipts(id),
  account_id uuid not null references public.finance_transaction_accounts(id),
  activity_row_id text not null references public.activities(row_id),
  funding_source_id uuid not null references public.funding_sources(id),
  amount numeric(14,2) not null check(amount>0),created_at timestamptz not null default now(),created_by uuid default auth.uid(),
  released_at timestamptz, release_reason text
);
create index finance_allocations_receipt_idx on public.finance_receipt_allocations(receipt_id) where released_at is null;
create index finance_allocations_account_idx on public.finance_receipt_allocations(account_id) where released_at is null;
create table public.finance_audit_events (
  id bigint generated always as identity primary key,event_type text not null,account_id uuid,receipt_id uuid,
  actor_id uuid default auth.uid(),occurred_at timestamptz not null default now(),details jsonb not null default '{}'
);
alter table public.finance_receipts enable row level security;
alter table public.finance_receipt_allocations enable row level security;
alter table public.finance_audit_events enable row level security;
revoke all on public.finance_receipts,public.finance_receipt_allocations,public.finance_audit_events from public,anon,authenticated;
-- Public RPCs return only data behind the existing finance tool permission gate.
create function finance_private.can_collect() returns boolean language sql stable set search_path='' as $$
  select auth.uid() is not null and coalesce(public.app_current_role()='admin' or public.app_has_permission('view_finance_collection'),false)
$$;
create function finance_private.payment_days(p_funding text) returns integer language sql immutable set search_path='' as $$
  select case when lower(regexp_replace(p_funding,'["''׳״[:space:]]','','g')) in ('ויצו','wizo','רשות','רשויות','authority') then 45 else 30 end
$$;
create function finance_private.account_paid(p_id uuid) returns numeric language sql stable set search_path='' as $$
  select coalesce(sum(x.amount),0) from public.finance_receipt_allocations x join public.finance_receipts r on r.id=x.receipt_id
  where x.account_id=p_id and x.released_at is null and r.voided_at is null
$$;
create function finance_private.refresh_payment(p_id uuid) returns void language plpgsql set search_path='' as $$
declare paid numeric;
begin
  paid:=finance_private.account_paid(p_id);
  update public.finance_transaction_accounts set collection_status=case when paid>=total_amount then 'paid' when paid>0 then 'partially_paid' else 'awaiting_payment' end where id=p_id;
end $$;

create function finance_private.allocate_receipt(p_receipt uuid,p_account uuid,p_activity text,p_amount numeric,p_automatic boolean default false) returns void
language plpgsql set search_path='' as $$
declare r public.finance_receipts; a public.finance_transaction_accounts; f uuid; line_amount numeric; used numeric;
begin
  -- Receipts first, accounts second: the same order is used by every payment path.
  select * into r from public.finance_receipts where id=p_receipt for update;
  select * into a from public.finance_transaction_accounts where id=p_account for update;
  if r.id is null or r.voided_at is not null or a.id is null or a.document_status='cancelled'
    or (not p_automatic and a.document_status='generating') or p_amount is null or p_amount<=0 then raise exception 'invalid_payment_allocation'; end if;
  select l.funding_source_id,sum(l.amount) into f,line_amount from public.finance_transaction_account_lines l where l.account_id=p_account and l.activity_row_id=p_activity group by l.funding_source_id;
  if r.payer_key is distinct from a.payer_key_snapshot or f is null or f is distinct from r.funding_source_id or (r.activity_row_id is not null and r.activity_row_id<>p_activity) then raise exception 'payment_payer_or_activity_mismatch'; end if;
  select coalesce(sum(amount),0) into used from public.finance_receipt_allocations where receipt_id=p_receipt and released_at is null;
  if used+p_amount>r.amount then raise exception 'receipt_already_allocated'; end if;
  select coalesce(sum(amount),0) into used from public.finance_receipt_allocations where account_id=p_account and activity_row_id=p_activity and funding_source_id=f and released_at is null;
  if used+p_amount>line_amount then raise exception 'payment_exceeds_account_balance'; end if;
  insert into public.finance_receipt_allocations(receipt_id,account_id,activity_row_id,funding_source_id,amount) values(p_receipt,p_account,p_activity,f,p_amount);
  insert into public.finance_audit_events(event_type,account_id,receipt_id,details) values('receipt_allocated',p_account,p_receipt,jsonb_build_object('amount',p_amount,'activity',p_activity,'automatic',p_automatic));
  perform finance_private.refresh_payment(p_account);
end $$;
create function public.finance_record_receipt(p_idempotency_key uuid,p_receipt jsonb,p_allocations jsonb default '[]') returns uuid
language plpgsql security definer set search_path='' as $$
declare r public.finance_receipts; x jsonb; aid uuid; payer_key text; src text; activity public.activities;
begin
  if not finance_private.can_collect() then raise exception 'finance_collection_permission_denied' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
  select * into r from public.finance_receipts where idempotency_key=p_idempotency_key;
  if found then return r.id; end if;
  if (p_receipt->>'received_date')::date>(now() at time zone 'Asia/Jerusalem')::date or p_idempotency_key is null then raise exception 'invalid_receipt_date'; end if;
  if nullif(p_receipt->>'activity_row_id','') is not null and not exists(select 1 from public.activities a join public.activity_funding_sources f on f.activity_id=a.id where a.row_id=p_receipt->>'activity_row_id' and f.funding_source_id=(p_receipt->>'funding_source_id')::uuid) then raise exception 'payment_payer_or_activity_mismatch'; end if;
  select name into src from public.funding_sources where id=nullif(p_receipt->>'funding_source_id','')::uuid;
  payer_key:=nullif(p_receipt->>'payer_key','');
  if nullif(p_receipt->>'activity_row_id','') is not null then
    select * into activity from public.activities where row_id=p_receipt->>'activity_row_id';
    payer_key:=case when public.finance_is_gefen_funding(src) then 'school:'||activity.school_id::text
      when lower(btrim(src)) in ('רשות','רשויות','authority') then 'authority:'||activity.authority_id::text
      else 'funding:'||(p_receipt->>'funding_source_id') end;
  end if;
  if payer_key is not null and not (
    (public.finance_is_gefen_funding(src) and exists(select 1 from public.schools where 'school:'||id::text=payer_key))
    or (lower(btrim(src)) in ('רשות','רשויות','authority') and exists(select 1 from public.authorities where 'authority:'||id::text=payer_key))
    or (not public.finance_is_gefen_funding(src) and lower(btrim(src)) not in ('רשות','רשויות','authority') and payer_key='funding:'||(p_receipt->>'funding_source_id')))
    then raise exception 'invalid_payer_identity'; end if;
  insert into public.finance_receipts(idempotency_key,funding_source_id,payer_key,payer_name,activity_row_id,amount,received_date,reference,document_reference)
  values(p_idempotency_key,nullif(p_receipt->>'funding_source_id','')::uuid,payer_key,btrim(p_receipt->>'payer_name'),nullif(p_receipt->>'activity_row_id',''),(p_receipt->>'amount')::numeric,(p_receipt->>'received_date')::date,coalesce(btrim(p_receipt->>'reference'),''),nullif(btrim(p_receipt->>'document_reference'),'')) returning * into r;
  insert into public.finance_audit_events(event_type,receipt_id,details) values('receipt_recorded',r.id,to_jsonb(r));
  for x in select value from jsonb_array_elements(p_allocations) loop
    perform finance_private.allocate_receipt(r.id,(x->>'account_id')::uuid,x->>'activity_row_id',(x->>'amount')::numeric);
  end loop;
  return r.id;
end $$;
create table finance_private.payment_operations(operation_id uuid primary key,receipt_id uuid not null references public.finance_receipts(id),request_hash text not null,actor_id uuid not null default auth.uid(),created_at timestamptz not null default now());
alter table finance_private.payment_operations enable row level security;
create function public.finance_allocate_receipt(p_receipt_id uuid,p_allocations jsonb,p_operation_id uuid default null) returns void
language plpgsql security definer set search_path='' as $$
declare x jsonb; r public.finance_receipts; a public.finance_transaction_accounts; operation uuid; request_hash text; previous_hash text;
begin
  if not finance_private.can_collect() then raise exception 'finance_collection_permission_denied' using errcode='42501'; end if;
  request_hash:=md5(p_receipt_id::text||p_allocations::text);operation:=coalesce(p_operation_id,request_hash::uuid);
  perform pg_advisory_xact_lock(hashtextextended(operation::text,0));
  select op.request_hash into previous_hash from finance_private.payment_operations op where op.operation_id=operation;
  if found then
    if previous_hash<>request_hash then raise exception 'allocation_operation_mismatch'; end if;
    return;
  end if;
  select * into r from public.finance_receipts where id=p_receipt_id for update;
  if r.id is null or r.voided_at is not null then raise exception 'receipt_not_available'; end if;
  insert into finance_private.payment_operations(operation_id,receipt_id,request_hash) values(operation,p_receipt_id,request_hash);
  if r.payer_key is null then
    select * into a from public.finance_transaction_accounts where id=(p_allocations->0->>'account_id')::uuid;
    if a.payer_key_snapshot is null or (r.funding_source_id is not null and r.funding_source_id<>a.funding_source_id_snapshot) then raise exception 'payment_payer_or_activity_mismatch'; end if;
    update public.finance_receipts set payer_key=a.payer_key_snapshot,funding_source_id=a.funding_source_id_snapshot where id=p_receipt_id;
    insert into public.finance_audit_events(event_type,receipt_id,details) values('receipt_payer_identified',p_receipt_id,jsonb_build_object('payer_key',a.payer_key_snapshot));
  end if;
  for x in select value from jsonb_array_elements(p_allocations) loop
    perform finance_private.allocate_receipt(p_receipt_id,(x->>'account_id')::uuid,x->>'activity_row_id',(x->>'amount')::numeric);
  end loop;
end $$;
create function public.finance_void_receipt(p_receipt_id uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare r public.finance_receipts; aid uuid;
begin
  if not finance_private.can_collect() or nullif(btrim(p_reason),'') is null then raise exception 'payment_correction_reason_required' using errcode='42501'; end if;
  select * into r from public.finance_receipts where id=p_receipt_id for update;
  if r.id is null then raise exception 'receipt_not_found'; end if;
  if r.voided_at is not null then raise exception 'receipt_already_voided'; end if;
  if r.created_by is distinct from auth.uid() and public.app_current_role() is distinct from 'admin' then raise exception 'payment_correction_permission_denied' using errcode='42501'; end if;
  update public.finance_receipts set voided_at=now(),voided_by=auth.uid(),void_reason=btrim(p_reason) where id=p_receipt_id;
  for aid in select distinct account_id from public.finance_receipt_allocations where receipt_id=p_receipt_id and released_at is null loop
    update public.finance_receipt_allocations set released_at=now(),release_reason=btrim(p_reason) where receipt_id=p_receipt_id and account_id=aid and released_at is null;
    perform finance_private.refresh_payment(aid);
  end loop;
  insert into public.finance_audit_events(event_type,receipt_id,details) values('receipt_voided',p_receipt_id,jsonb_build_object('reason',p_reason));
end $$;

create function public.finance_payment_context() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not finance_private.can_collect() and not public.finance_transaction_can_issue() then raise exception 'finance_collection_permission_denied' using errcode='42501'; end if;
  return jsonb_build_object('receipts',(select coalesce(jsonb_agg(to_jsonb(r) order by r.received_date desc,r.id),'[]') from public.finance_receipts r),
    'allocations',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.finance_receipt_allocations x),
    'balances',(select coalesce(jsonb_agg(jsonb_build_object('accountId',a.id,'paidAmount',finance_private.account_paid(a.id),'balance',greatest(0,a.total_amount-finance_private.account_paid(a.id)))),'[]') from public.finance_transaction_accounts a where a.document_status<>'generating'));
end $$;
create function public.finance_update_account_tracking(p_account_id uuid,p_expected_date date,p_note text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not finance_private.can_collect() then raise exception 'finance_collection_permission_denied' using errcode='42501'; end if;
  update public.finance_transaction_accounts set expected_collection_date=p_expected_date,finance_note=coalesce(p_note,'') where id=p_account_id and document_status in ('issued','mail_draft_ready','sent');
  if not found then raise exception 'account_not_collectible'; end if;
  insert into public.finance_audit_events(event_type,account_id,details) values('collection_tracking_updated',p_account_id,jsonb_build_object('expected_date',p_expected_date,'note',p_note));
end $$;

alter table public.finance_transaction_accounts add column payer_identity_snapshot text;
create function finance_private.finish_reservation(p_id uuid) returns void language plpgsql set search_path='' as $$
declare a public.finance_transaction_accounts; funding text; paid numeric;
begin
  select * into a from public.finance_transaction_accounts where id=p_id for update;
  if a.document_status<>'generating' then raise exception 'issued_snapshot_is_immutable'; end if;
  select funding_snapshot into funding from public.finance_transaction_account_lines where account_id=p_id limit 1;
  update public.finance_transaction_account_lines l set school_name_snapshot=coalesce(l.school_name_snapshot,src.school),
    service_description_snapshot=coalesce(l.service_description_snapshot,l.activity_name_snapshot),
    quantity_snapshot=coalesce(l.quantity_snapshot,(select count(*) from public.finance_transaction_account_meetings m where m.account_line_id=l.id)),
    unit_price_snapshot=coalesce(l.unit_price_snapshot,l.hourly_rate_snapshot*1.5)
    from public.activities src where src.row_id=l.activity_row_id and l.account_id=p_id;
  update public.finance_transaction_accounts set payer_identity_snapshot=coalesce(payer_identity_snapshot,customer_name_snapshot),
    payment_due_date=(date_trunc('month',issue_date)+interval '1 month - 1 day')::date+finance_private.payment_days(funding) where id=p_id;
end $$;

create function finance_private.manual_quote(p_activity text,p_funder uuid,p_month date,p_draft jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
declare a public.activities;r jsonb;selected jsonb;quantity int;hours numeric;unit_price numeric;amount numeric;cap numeric;
  issued date;due date;customer text;description text;result jsonb;reason text;full_funding boolean;
begin
  select * into a from public.activities where row_id=p_activity;
  if not found then raise exception 'activity_not_found'; end if;
  full_funding:=coalesce(p_draft->>'billing_basis','performance')='full_funding';
  select x into r from jsonb_array_elements(finance_private.billing_rows(a)) x where (x->>'fundingSourceId')::uuid=p_funder
    and (full_funding or (x->>'period')::date=p_month) order by x->>'period' limit 1;
  if r is null or (case when full_funding then coalesce(r->>'fullFundingBlockedReason','')<>'' or coalesce((r->>'fullFundingAmount')::numeric,0)<=0 else not coalesce((r->>'eligible')::boolean,false) end) then raise exception 'billing_blocked:%',coalesce(r->>'blockedReason','הפעילות אינה זכאית להפקה'); end if;
  quantity:=coalesce(nullif(p_draft->>'quantity','')::int,(r->>case when full_funding then 'plannedCount' else 'unbilledCount' end)::int);
  if quantity<1 or quantity>(r->>case when full_funding then 'plannedCount' else 'unbilledCount' end)::int then raise exception 'הכמות חורגת ממספר המפגשים הזכאים'; end if;
  select jsonb_agg(s order by (s->>'slot')::int),sum((s->>'remainingAmount')::numeric) into selected,cap
    from (select value s from jsonb_array_elements(r->'unbilledSlots') order by (value->>'slot')::int limit quantity) chosen;
  if full_funding then selected:='[]'::jsonb;cap:=(r->>'fullFundingAmount')::numeric; end if;
  hours:=coalesce(nullif(p_draft->>'hours','')::numeric,quantity*1.5);
  amount:=coalesce(nullif(p_draft->>'amount','')::numeric,least(cap,(r->>case when full_funding then 'fullFundingAmount' else 'issuableAmount' end)::numeric));
  unit_price:=coalesce(nullif(p_draft->>'unit_price','')::numeric,amount/quantity);
  if amount<=0 or amount>least(cap,(r->>case when full_funding then 'fullFundingAmount' else 'issuableAmount' end)::numeric) or unit_price<=0 or round(unit_price*quantity,2)<>round(amount,2)
    or hours<=0 or hours>quantity*1.5 then raise exception 'הסכום או השעות חורגים מהיתרה המותרת'; end if;
  if full_funding and amount<>cap then raise exception 'חיוב מראש חייב לכסות את מלוא יתרת המממן'; end if;
  issued:=coalesce(nullif(p_draft->>'issue_date','')::date,(now() at time zone 'Asia/Jerusalem')::date);
  due:=(date_trunc('month',issued)+interval '1 month - 1 day')::date+finance_private.payment_days(r->>'funding');
  reason:=nullif(btrim(p_draft->>'override_reason'),'');
  if issued>(now() at time zone 'Asia/Jerusalem')::date then raise exception 'תאריך הפקה עתידי אינו מותר'; end if;
  if issued<>(now() at time zone 'Asia/Jerusalem')::date or (nullif(p_draft->>'payment_due_date','') is not null and (p_draft->>'payment_due_date')::date<>due) then
    if public.app_current_role() is distinct from 'admin' or reason is null then raise exception 'שינוי מועד דורש הרשאת מנהל וסיבה' using errcode='42501'; end if;
    due:=coalesce(nullif(p_draft->>'payment_due_date','')::date,due);
  end if;
  if due<issued then raise exception 'מועד התשלום קודם להפקה'; end if;
  customer:=coalesce(nullif(btrim(p_draft->>'customer_name'),''),r->>'payerName');
  description:=coalesce(nullif(btrim(p_draft->>'description'),''),a.activity_name);
  result:=jsonb_build_object('transaction_account_number','טיוטה','issue_date',issued,'payment_due_date',due,'institution_symbol',coalesce(nullif(p_draft->>'institution_symbol',''),r->>'institutionSymbol'),
    'customer_name_snapshot',customer,'payer_identity_snapshot',r->>'payerName','payer_key_snapshot',r->>'payerKey','customer_email_snapshot',coalesce(p_draft->>'customer_email',r->>'customerEmail'),
    'total_amount',round(amount,2),
    'finance_transaction_account_lines',jsonb_build_array(jsonb_build_object('activity_row_id',a.row_id,'activity_name_snapshot',a.activity_name,
      'school_name_snapshot',coalesce(nullif(p_draft->>'school_name',''),a.school),'gefen_number_snapshot',coalesce(p_draft->>'program_number',a.activity_no),
      'service_description_snapshot',description,'funding_source_id',p_funder,'funding_snapshot',r->>'funding','performance_month',case when full_funding then null::date else p_month end,'billing_coverage',case when full_funding then 'full_funding' else 'performance' end,
      'billing_rule',case when (r->>'gefenFunding')::boolean then 'monthly' else 'completion' end,'billed_hours',hours,'quantity_snapshot',quantity,
      'unit_price_snapshot',unit_price,'hourly_rate_snapshot',amount/hours,'amount',round(amount,2),
      'finance_transaction_account_meetings',(select jsonb_agg(jsonb_build_object('meeting_slot',(s->>'slot')::int,'meeting_date',s->>'date','hours',1.5)) from jsonb_array_elements(selected) s))),
    'billing_basis',case when full_funding then 'full_funding' else 'performance' end,'source',r,'override_reason',reason,'selected_slots',selected);
  return result || jsonb_build_object('revision',md5(result::text));
end $$;
create function public.finance_manual_account_quote(p_activity text,p_funder uuid,p_month date,p_draft jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.finance_transaction_can_issue() then raise exception 'finance_transactions_permission_denied' using errcode='42501'; end if;
  return finance_private.manual_quote(p_activity,p_funder,p_month,p_draft);
end $$;
create function public.reserve_finance_manual_account(p_idempotency_key uuid,p_activity text,p_funder uuid,p_month date,p_draft jsonb,p_expected_revision text)
returns public.finance_transaction_accounts language plpgsql security definer set search_path='' as $$
declare q jsonb;r jsonb;account public.finance_transaction_accounts;l uuid;slot jsonb;cumulative numeric:=0;prior numeric;cap numeric;amount numeric;quantity int;
begin
  if not public.finance_transaction_can_issue() then raise exception 'finance_transactions_permission_denied' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
  select * into account from public.finance_transaction_accounts where idempotency_key=p_idempotency_key;
  if found then return account; end if;
  perform 1 from public.activities where row_id=p_activity for update;
  q:=finance_private.manual_quote(p_activity,p_funder,p_month,p_draft);
  if q->>'revision' is distinct from p_expected_revision then raise exception 'התצוגה המקדימה השתנתה; יש לעדכן אותה'; end if;
  r:=q->'source';
  if q->>'billing_basis'='full_funding' then
    insert into public.finance_transaction_accounts(idempotency_key,cutoff_date,institution_symbol,customer_name_snapshot,customer_email_snapshot,total_amount,issue_mode,payment_due_date,issue_date,manual_draft,payer_key_snapshot,authority_id_snapshot,funding_source_id_snapshot,payer_identity_snapshot)
    values(p_idempotency_key,(now() at time zone 'Asia/Jerusalem')::date,q->>'institution_symbol',q->>'customer_name_snapshot',q->>'customer_email_snapshot',(q->>'total_amount')::numeric,'manual',(q->>'payment_due_date')::date,(q->>'issue_date')::date,q,r->>'payerKey',(r->>'authorityId')::bigint,p_funder,r->>'payerName') returning * into account;
    insert into public.finance_transaction_account_lines(account_id,activity_row_id,activity_name_snapshot,gefen_number_snapshot,funding_snapshot,activity_price_snapshot,planned_meeting_count_snapshot,hourly_rate_snapshot,billed_hours,amount,funding_source_id,funding_amount_snapshot,billing_rule,billing_coverage,
      school_name_snapshot,service_description_snapshot,quantity_snapshot,unit_price_snapshot)
    select account.id,p_activity,a.activity_name,q->'finance_transaction_account_lines'->0->>'gefen_number_snapshot',r->>'funding',a.price,(r->>'plannedCount')::int,
      (q->'finance_transaction_account_lines'->0->>'hourly_rate_snapshot')::numeric,(q->'finance_transaction_account_lines'->0->>'billed_hours')::numeric,(q->>'total_amount')::numeric,p_funder,(r->>'fundingAmount')::numeric,
      case when (r->>'gefenFunding')::boolean then 'monthly' else 'completion' end,'full_funding',q->'finance_transaction_account_lines'->0->>'school_name_snapshot',q->'finance_transaction_account_lines'->0->>'service_description_snapshot',
      (q->'finance_transaction_account_lines'->0->>'quantity_snapshot')::numeric,(q->'finance_transaction_account_lines'->0->>'unit_price_snapshot')::numeric from public.activities a where a.row_id=p_activity;
    insert into public.finance_audit_events(event_type,account_id,details) values('manual_full_funding_reserved',account.id,jsonb_build_object('draft',p_draft,'source',r,'revision',p_expected_revision));
    return account;
  end if;
  account:=public.reserve_finance_transaction_account(p_idempotency_key,
    case when (r->>'gefenFunding')::boolean then date_trunc('month',now() at time zone 'Asia/Jerusalem')::date-1 else (now() at time zone 'Asia/Jerusalem')::date end,
    r->>'institutionSymbol',r->>'payerName',q->>'customer_email_snapshot',jsonb_build_array(jsonb_build_object('activity_row_id',p_activity,
      'funding_source_id',p_funder,'performance_month',p_month,'expected_amount',r->'issuableAmount','issue_mode',case when (r->>'gefenFunding')::boolean then 'automatic' else 'manual' end,
      'meeting_slots',(select jsonb_agg((s->>'slot')::int order by (s->>'slot')::int) from jsonb_array_elements(r->'unbilledSlots') s))));
  select id into l from public.finance_transaction_account_lines where account_id=account.id;
  delete from public.finance_transaction_account_meetings where account_line_id=l and meeting_slot not in(select (s->>'slot')::int from jsonb_array_elements(q->'selected_slots') s);
  delete from public.finance_billing_claims where account_id=account.id;
  select sum((s->>'remainingAmount')::numeric) into cap from jsonb_array_elements(q->'selected_slots') s;
  amount:=(q->>'total_amount')::numeric;
  for slot in select value from jsonb_array_elements(q->'selected_slots') loop
    prior:=cumulative;cumulative:=cumulative+(slot->>'remainingAmount')::numeric;
    insert into public.finance_billing_claims values(p_activity,p_funder,(slot->>'slot')::int,account.id,round(amount*cumulative/cap,2)-round(amount*prior/cap,2),amount=cap);
  end loop;
  update public.finance_transaction_account_lines set amount=(q->>'total_amount')::numeric,
    service_description_snapshot=q->'finance_transaction_account_lines'->0->>'service_description_snapshot',
    school_name_snapshot=q->'finance_transaction_account_lines'->0->>'school_name_snapshot',
    gefen_number_snapshot=q->'finance_transaction_account_lines'->0->>'gefen_number_snapshot',
    billed_hours=(q->'finance_transaction_account_lines'->0->>'billed_hours')::numeric,
    hourly_rate_snapshot=(q->'finance_transaction_account_lines'->0->>'hourly_rate_snapshot')::numeric,
    quantity_snapshot=(q->'finance_transaction_account_lines'->0->>'quantity_snapshot')::numeric,
    unit_price_snapshot=(q->'finance_transaction_account_lines'->0->>'unit_price_snapshot')::numeric where id=l;
  update public.finance_receipt_allocations set released_at=now(),release_reason='manual_draft_recalculated' where account_id=account.id and released_at is null;
  update public.finance_transaction_accounts set total_amount=(q->>'total_amount')::numeric,issue_date=(q->>'issue_date')::date,
    customer_name_snapshot=q->>'customer_name_snapshot',customer_email_snapshot=q->>'customer_email_snapshot',institution_symbol=q->>'institution_symbol',manual_draft=q where id=account.id;
  perform finance_private.finish_reservation(account.id);
  update public.finance_transaction_accounts set payment_due_date=(q->>'payment_due_date')::date where id=account.id;
  insert into public.finance_audit_events(event_type,account_id,details) values('manual_account_reserved',account.id,jsonb_build_object('draft',p_draft,'source',r,'revision',p_expected_revision));
  select * into account from public.finance_transaction_accounts where id=account.id;
  return account;
end $$;

create or replace function finance_private.assert_current(p_account_id uuid) returns void
language plpgsql set search_path='' as $$
declare l public.finance_transaction_account_lines;a public.activities;r jsonb;account public.finance_transaction_accounts;selected jsonb;cap numeric;
begin
  select * into account from public.finance_transaction_accounts where id=p_account_id;
  perform 1 from public.activities where row_id in(select activity_row_id from public.finance_transaction_account_lines where account_id=p_account_id) order by row_id for update;
  if not exists(select 1 from public.finance_transaction_account_lines where account_id=p_account_id) then raise exception 'empty_account'; end if;
  for l in select * from public.finance_transaction_account_lines where account_id=p_account_id loop
    if l.funding_source_id is null then raise exception 'legacy_reservation_requires_review'; end if;
    select * into a from public.activities where row_id=l.activity_row_id;
    select s into r from jsonb_array_elements(finance_private.billing_rows(a,p_account_id)) s where
      (s->>'fundingSourceId')::uuid=l.funding_source_id and (l.billing_coverage='full_funding' or (s->>'period')::date=l.performance_month) order by s->>'period' limit 1;
    if l.billing_coverage='full_funding' then
      if r is null or coalesce(r->>'fullFundingBlockedReason','')<>'' or (r->>'fullFundingAmount')::numeric is distinct from l.amount or r->>'payerKey' is distinct from account.payer_key_snapshot
        or (r->>'fundingAmount')::numeric is distinct from l.funding_amount_snapshot then raise exception 'stale_billing_reservation'; end if;
      continue;
    end if;
    if r is null or not coalesce((r->>'eligible')::boolean,false) or r->>'payerKey' is distinct from account.payer_key_snapshot or (r->>'fundingAmount')::numeric is distinct from l.funding_amount_snapshot
      or (r->>'plannedCount')::int is distinct from l.planned_meeting_count_snapshot or r->>'funding' is distinct from l.funding_snapshot then raise exception 'stale_billing_reservation'; end if;
    select jsonb_agg(jsonb_build_object('slot',m.meeting_slot,'date',m.meeting_date) order by m.meeting_slot) into selected from public.finance_transaction_account_meetings m where m.account_line_id=l.id;
    if account.manual_draft is null then
      if (r->>'issuableAmount')::numeric is distinct from l.amount or r->>'payerName' is distinct from account.customer_name_snapshot or r->>'institutionSymbol' is distinct from account.institution_symbol
        or selected is distinct from (select jsonb_agg(s-'remainingAmount' order by (s->>'slot')::int) from jsonb_array_elements(r->'unbilledSlots') s) then raise exception 'stale_billing_reservation'; end if;
    else
      if exists(select 1 from jsonb_array_elements(selected) s where not exists(select 1 from jsonb_array_elements(r->'unbilledSlots') eligible where eligible-'remainingAmount'=s)) then raise exception 'stale_billing_reservation'; end if;
      select sum((s->>'remainingAmount')::numeric) into cap from jsonb_array_elements(r->'unbilledSlots') s where selected @> jsonb_build_array(s-'remainingAmount');
      if l.amount>least(cap,(r->>'issuableAmount')::numeric) or account.payer_identity_snapshot is distinct from r->>'payerName' then raise exception 'stale_billing_reservation'; end if;
    end if;
  end loop;
end $$;
create function finance_private.sync_collection_lifecycle() returns trigger language plpgsql set search_path='' as $$
begin
  if OLD.document_status='generating' and NEW.document_status in ('issued','mail_draft_ready','sent') then
    NEW.expected_collection_date:=coalesce(NEW.expected_collection_date,NEW.payment_due_date);
    NEW.collection_status:=case when finance_private.account_paid(NEW.id)>=NEW.total_amount then 'paid' when finance_private.account_paid(NEW.id)>0 then 'partially_paid' else 'awaiting_payment' end;
    insert into public.finance_audit_events(event_type,account_id) values('account_issued',NEW.id);
  end if;
  if NEW.document_status='cancelled' and OLD.document_status<>'cancelled' then
    update public.finance_receipt_allocations set released_at=now(),release_reason='account_cancelled' where account_id=NEW.id and released_at is null;
    NEW.collection_status:='awaiting_payment';
    insert into public.finance_audit_events(event_type,account_id,details) values('account_cancelled',NEW.id,jsonb_build_object('reason',NEW.cancellation_reason));
  end if;
  return NEW;
end $$;
create trigger finance_collection_lifecycle before update of document_status on public.finance_transaction_accounts for each row execute function finance_private.sync_collection_lifecycle();
create function public.finance_cancel_issued_account(p_account_id uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or public.app_current_role() is distinct from 'admin' or nullif(btrim(p_reason),'') is null then raise exception 'cancellation_requires_admin_and_reason' using errcode='42501'; end if;
  perform 1 from public.finance_transaction_accounts where id=p_account_id for update;
  if exists(select 1 from finance_private.dispatch_leases where account_id=p_account_id and expires_at>now()) then raise exception 'dispatch_in_progress'; end if;
  update public.finance_transaction_accounts set document_status='cancelled',cancelled_at=now(),cancelled_by=auth.uid(),cancellation_reason=btrim(p_reason) where id=p_account_id and document_status in ('issued','mail_draft_ready','sent');
  if not found then raise exception 'account_not_cancellable'; end if;
end $$;
create or replace function public.mark_finance_transaction_outlook(p_account_id uuid,p_status text,p_message_id text default null,p_error text default null)
returns void language plpgsql security definer set search_path='' as $$
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'backend_only' using errcode='42501'; end if;
  if p_status not in ('draft_ready','failed','missing_recipient') then raise exception 'invalid_outlook_status'; end if;
  update public.finance_transaction_accounts set outlook_status=p_status,outlook_message_id=p_message_id,outlook_error=p_error,
    document_status=case when p_status='draft_ready' then 'mail_draft_ready' else document_status end where id=p_account_id and document_status in ('issued','mail_draft_ready','sent');
  if not found then raise exception 'account_not_dispatchable'; end if;
end $$;

revoke all on all functions in schema finance_private from public,anon,authenticated,service_role;
revoke all on function public.finance_record_receipt(uuid,jsonb,jsonb),public.finance_allocate_receipt(uuid,jsonb,uuid),public.finance_void_receipt(uuid,text),public.finance_payment_context(),public.finance_update_account_tracking(uuid,date,text),public.finance_manual_account_quote(text,uuid,date,jsonb),public.reserve_finance_manual_account(uuid,text,uuid,date,jsonb,text),public.finance_cancel_issued_account(uuid,text) from public,anon,authenticated;
grant execute on function public.finance_record_receipt(uuid,jsonb,jsonb),public.finance_allocate_receipt(uuid,jsonb,uuid),public.finance_void_receipt(uuid,text),public.finance_payment_context(),public.finance_update_account_tracking(uuid,date,text),public.finance_manual_account_quote(text,uuid,date,jsonb),public.reserve_finance_manual_account(uuid,text,uuid,date,jsonb,text),public.finance_cancel_issued_account(uuid,text) to authenticated;
