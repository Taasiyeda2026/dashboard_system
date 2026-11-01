-- Quantity-billed services have no hourly rate or billed course hours.
-- Preserve all existing invoice/activity data and the course hours contract.
alter table public.finance_transaction_account_lines
  alter column hourly_rate_snapshot drop not null,
  drop constraint if exists finance_transaction_account_lines_billed_hours_check,
  drop constraint if exists finance_transaction_account_lines_billing_units_check;
alter table public.finance_transaction_account_lines
  add constraint finance_transaction_account_lines_billing_units_check check (
    (billed_hours > 0 and hourly_rate_snapshot is not null)
    or (billed_hours = 0 and hourly_rate_snapshot is null
      and quantity_snapshot is not null and quantity_snapshot > 0
      and unit_price_snapshot is not null and unit_price_snapshot > 0)
  );

CREATE OR REPLACE FUNCTION public.reserve_finance_transaction_account(p_idempotency_key uuid, p_cutoff_date date, p_institution_symbol text, p_customer_name text, p_customer_email text, p_lines jsonb)
 RETURNS public.finance_transaction_accounts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  account public.finance_transaction_accounts; a public.activities; req jsonb; row jsonb;
  line_id uuid; meeting jsonb; claim_total numeric; cumulative numeric; prior_cumulative numeric; mode text; payer uuid; period date; total numeric := 0; customer text; payer_key text; expired uuid;
begin
  if auth.uid() is null or not coalesce(public.app_current_role()='admin' or public.app_has_permission('manage_finance_transactions'),false) then
    raise exception 'finance_transactions_permission_denied' using errcode='42501'; end if;
  if p_idempotency_key is null or jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines)=0
    or (p_lines->0->>'issue_mode'='automatic' and nullif(btrim(p_institution_symbol),'') is null) then raise exception 'invalid_transaction_account'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
  select * into account from public.finance_transaction_accounts where idempotency_key=p_idempotency_key;
  if found then return account; end if;
  mode := p_lines->0->>'issue_mode';
  if mode is null or mode not in ('automatic','manual') then raise exception 'invalid_issue_mode'; end if;
  if p_cutoff_date is distinct from (case when mode='automatic' then date_trunc('month',now() at time zone 'Asia/Jerusalem')::date-1 else (now() at time zone 'Asia/Jerusalem')::date end) then
    raise exception 'invalid_cutoff'; end if;
  for expired in select id from public.finance_transaction_accounts stale where stale.document_status='generating'
    and stale.created_at<now()-interval '15 minutes'
    and exists(select 1 from public.finance_transaction_account_lines l where l.account_id=stale.id and l.activity_row_id in (select value->>'activity_row_id' from jsonb_array_elements(p_lines)))
    and not exists(select 1 from finance_private.dispatch_leases where account_id=stale.id and expires_at>now())
  loop perform finance_private.cancel_reservation(expired,'reservation_expired'); end loop;
  -- Stable global lock order for multi-activity accounts.
  perform 1 from public.activities where row_id in (select value->>'activity_row_id' from jsonb_array_elements(p_lines)) order by row_id for update;
  insert into public.finance_transaction_accounts(idempotency_key,cutoff_date,institution_symbol,customer_name_snapshot,customer_email_snapshot,total_amount,issue_mode,payment_due_date)
    values(p_idempotency_key,p_cutoff_date,nullif(btrim(p_institution_symbol),''),'',nullif(btrim(p_customer_email),''),0,mode,
      (date_trunc('month',now() at time zone 'Asia/Jerusalem')+interval '1 month - 1 day')::date+30) returning * into account;
  for req in select value from jsonb_array_elements(p_lines) order by value->>'activity_row_id',value->>'funding_source_id',value->>'performance_month' loop
    select * into a from public.activities where row_id=req->>'activity_row_id';
    if not found then raise exception 'activity_not_found'; end if;
    if req->>'issue_mode' is distinct from mode then raise exception 'mixed_issue_modes'; end if;
    payer := (req->>'funding_source_id')::uuid;
    period := nullif(req->>'performance_month','')::date;
    select s into row from jsonb_array_elements(finance_private.billing_rows(a)) s
      where (s->>'fundingSourceId')::uuid=payer and (s->>'period')::date is not distinct from period;
    if row is null or not coalesce((row->>'eligible')::boolean,false) then
      raise exception 'billing_blocked:%',coalesce(row->>'blockedReason','activity_not_eligible'); end if;
    if (row->>'gefenFunding')::boolean is distinct from (mode='automatic') then raise exception 'wrong_billing_tab'; end if;
    if mode='automatic' and row->>'institutionSymbol' is distinct from p_institution_symbol then raise exception 'activity_institution_mismatch'; end if;
    if payer_key is not null and payer_key is distinct from row->>'payerKey' then raise exception 'mixed_payers'; end if;
    payer_key:=row->>'payerKey';
    if exists(select 1 from public.finance_transaction_account_lines where account_id=account.id and funding_source_id<>payer) then raise exception 'mixed_funding_sources'; end if;
    customer := row->>'payerName';
    if req->'meeting_slots' is distinct from (select jsonb_agg((s->>'slot')::int order by (s->>'slot')::int) from jsonb_array_elements(row->'unbilledSlots') s)
      or (req->>'expected_amount')::numeric is distinct from (row->>'issuableAmount')::numeric then raise exception 'stale_billing_preview'; end if;
    insert into public.finance_transaction_account_lines(account_id,activity_row_id,activity_name_snapshot,gefen_number_snapshot,funding_snapshot,
      activity_price_snapshot,planned_meeting_count_snapshot,hourly_rate_snapshot,billed_hours,amount,funding_source_id,funding_amount_snapshot,performance_month,billing_rule,quantity_snapshot,unit_price_snapshot)
    values(account.id,a.row_id,a.activity_name,a.activity_no,row->>'funding',a.price,(row->>'plannedCount')::int,(row->>'hourlyRate')::numeric,
      (row->>'unbilledHours')::numeric,(row->>'issuableAmount')::numeric,payer,(row->>'fundingAmount')::numeric,period,case when mode='automatic' then 'monthly' else 'completion' end,
      case when lower(btrim(coalesce(a.activity_type,''))) in ('tour','workshop') then (row->>'unbilledCount')::numeric else null end,
      case when lower(btrim(coalesce(a.activity_type,''))) in ('tour','workshop') then (row->>'issuableAmount')::numeric/nullif((row->>'unbilledCount')::numeric,0) else null end)
    returning id into line_id;
    select sum((x->>'remainingAmount')::numeric) into claim_total from jsonb_array_elements(row->'unbilledSlots') x;
    cumulative:=0;
    for meeting in select value from jsonb_array_elements(row->'unbilledSlots') loop
      prior_cumulative:=cumulative;cumulative:=cumulative+(meeting->>'remainingAmount')::numeric;
      insert into public.finance_billing_claims values(a.row_id,payer,(meeting->>'slot')::int,account.id,
        round((row->>'issuableAmount')::numeric*cumulative/claim_total,2)-round((row->>'issuableAmount')::numeric*prior_cumulative/claim_total,2),true);
      insert into public.finance_transaction_account_meetings(account_line_id,activity_row_id,meeting_slot,meeting_date)
        values(line_id,a.row_id,(meeting->>'slot')::int,(meeting->>'date')::date);
    end loop;
    total := total+(row->>'issuableAmount')::numeric;
  end loop;
  update public.finance_transaction_accounts set total_amount=total,customer_name_snapshot=customer,payer_key_snapshot=payer_key,authority_id_snapshot=(row->>'authorityId')::bigint,funding_source_id_snapshot=payer where id=account.id returning * into account;
  perform finance_private.finish_reservation(account.id);
  select * into account from public.finance_transaction_accounts where id=account.id;
  return account;
end $function$;

CREATE OR REPLACE FUNCTION finance_private.manual_quote(p_activity text, p_funder uuid, p_month date, p_draft jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare a public.activities;r jsonb;selected jsonb;quantity int;hours numeric;unit_price numeric;amount numeric;cap numeric;
  issued date;due date;customer text;description text;result jsonb;reason text;full_funding boolean; service_activity boolean;
begin
  select * into a from public.activities where row_id=p_activity;
  if not found then raise exception 'activity_not_found'; end if;
  service_activity:=lower(btrim(coalesce(a.activity_type,''))) in ('tour','workshop');
  full_funding:=coalesce(p_draft->>'billing_basis','performance')='full_funding';
  select x into r from jsonb_array_elements(finance_private.billing_rows(a)) x where (x->>'fundingSourceId')::uuid=p_funder
    and (full_funding or (x->>'period')::date=p_month) order by x->>'period' limit 1;
  if r is null or (case when full_funding then coalesce(r->>'fullFundingBlockedReason','')<>'' or coalesce((r->>'fullFundingAmount')::numeric,0)<=0 else not coalesce((r->>'eligible')::boolean,false) end) then raise exception 'billing_blocked:%',coalesce(r->>'blockedReason','הפעילות אינה זכאית להפקה'); end if;
  quantity:=coalesce(nullif(p_draft->>'quantity','')::int,(r->>case when full_funding then 'plannedCount' else 'unbilledCount' end)::int);
  if quantity<1 or quantity>(r->>case when full_funding then 'plannedCount' else 'unbilledCount' end)::int then raise exception 'הכמות חורגת ממספר המפגשים הזכאים'; end if;
  select jsonb_agg(s order by (s->>'slot')::int),sum((s->>'remainingAmount')::numeric) into selected,cap
    from (select value s from jsonb_array_elements(r->'unbilledSlots') order by (value->>'slot')::int limit quantity) chosen;
  if full_funding then selected:='[]'::jsonb;cap:=(r->>'fullFundingAmount')::numeric; end if;
  hours:=case when service_activity then 0 else coalesce(nullif(p_draft->>'hours','')::numeric,quantity*1.5) end;
  amount:=coalesce(nullif(p_draft->>'amount','')::numeric,least(cap,(r->>case when full_funding then 'fullFundingAmount' else 'issuableAmount' end)::numeric));
  unit_price:=coalesce(nullif(p_draft->>'unit_price','')::numeric,amount/quantity);
  if amount<=0 or amount>least(cap,(r->>case when full_funding then 'fullFundingAmount' else 'issuableAmount' end)::numeric) or unit_price<=0 or round(unit_price*quantity,2)<>round(amount,2)
    or (not service_activity and (hours<=0 or hours>quantity*1.5)) then raise exception 'הסכום או השעות חורגים מהיתרה המותרת'; end if;
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
  result:=jsonb_build_object('transaction_account_number','טיוטה','issue_date',issued,'payment_due_date',due,'institution_symbol',coalesce(nullif(p_draft->>'institution_symbol',''),case when (r->>'gefenFunding')::boolean then r->>'institutionSymbol' else null end),
    'customer_name_snapshot',customer,'payer_identity_snapshot',r->>'payerName','payer_key_snapshot',r->>'payerKey','customer_email_snapshot',coalesce(p_draft->>'customer_email',r->>'customerEmail'),
    'total_amount',round(amount,2),
    'finance_transaction_account_lines',jsonb_build_array(jsonb_build_object('activity_row_id',a.row_id,'activity_name_snapshot',a.activity_name,
      'school_name_snapshot',coalesce(nullif(p_draft->>'school_name',''),a.school),'gefen_number_snapshot',coalesce(p_draft->>'program_number',a.activity_no),
      'service_description_snapshot',description,'funding_source_id',p_funder,'funding_snapshot',r->>'funding','performance_month',case when full_funding then null::date else p_month end,'billing_coverage',case when full_funding then 'full_funding' else 'performance' end,
      'billing_rule',case when (r->>'gefenFunding')::boolean then 'monthly' else 'completion' end,'billed_hours',hours,'quantity_snapshot',quantity,
      'unit_price_snapshot',unit_price,'hourly_rate_snapshot',case when service_activity then null else amount/hours end,'amount',round(amount,2),
      'finance_transaction_account_meetings',(select jsonb_agg(jsonb_build_object('meeting_slot',(s->>'slot')::int,'meeting_date',s->>'date','hours',1.5)) from jsonb_array_elements(selected) s))),
    'billing_basis',case when full_funding then 'full_funding' else 'performance' end,'source',r,'override_reason',reason,'selected_slots',selected);
  return result || jsonb_build_object('revision',md5(result::text));
end $function$;
