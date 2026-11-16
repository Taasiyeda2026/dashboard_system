begin;
CREATE OR REPLACE FUNCTION public.reserve_finance_transaction_account(p_idempotency_key uuid, p_cutoff_date date, p_institution_symbol text, p_customer_name text, p_customer_email text, p_lines jsonb)
 RETURNS finance_transaction_accounts
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
  if p_cutoff_date is distinct from (case when mode='automatic' then finance_private.gefen_cycle_cutoff() else (now() at time zone 'Asia/Jerusalem')::date end) then
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
    if req ? 'billing_range_end' and ((req->>'billing_range_end')::date<>date_trunc('month',(req->>'billing_range_end')::date)::date or (req->>'billing_range_end')::date>date_trunc('month',case when mode='automatic' then p_cutoff_date else date_trunc('month',now() at time zone 'Asia/Jerusalem')::date-1 end)::date or period>(req->>'billing_range_end')::date or period<make_date(substring(a.activity_season from 'school_([0-9]{4})')::int-1,9,1)) then raise exception 'invalid_monthly_billing_range'; end if;
    select s into row from jsonb_array_elements(finance_private.billing_rows(a,account.id)) s
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
      insert into public.finance_transaction_account_meetings(account_line_id,activity_row_id,meeting_slot,meeting_date,hours)
        values(line_id,a.row_id,(meeting->>'slot')::int,(meeting->>'date')::date,coalesce(nullif((meeting->>'remainingHours')::numeric,0),1.5));
    end loop;
    total := total+(row->>'issuableAmount')::numeric;
  end loop;
  -- Ignoring our own reservation enables several months per course. Enforce
  -- the total cap across every selected line, not just the individual period.
  if exists (
    select 1 from public.finance_transaction_account_lines l
    where l.account_id=account.id
    group by l.activity_row_id,l.funding_source_id
    having sum(l.amount)+coalesce((select sum(prior.amount) from public.finance_transaction_account_lines prior
      join public.finance_transaction_accounts h on h.id=prior.account_id
      where prior.activity_row_id=l.activity_row_id and prior.funding_source_id=l.funding_source_id
        and h.id<>account.id and h.document_status<>'cancelled'
        and (h.document_status<>'generating' or h.created_at>now()-interval '15 minutes')),0)>min(l.funding_amount_snapshot)
  ) then raise exception 'billing_funding_cap_exceeded'; end if;
  update public.finance_transaction_accounts set total_amount=total,customer_name_snapshot=customer,payer_key_snapshot=payer_key,authority_id_snapshot=(row->>'authorityId')::bigint,funding_source_id_snapshot=payer where id=account.id returning * into account;
  perform finance_private.finish_reservation(account.id);
  select * into account from public.finance_transaction_accounts where id=account.id;
  return account;
end $function$;

CREATE OR REPLACE FUNCTION public.finance_funder_batch_quote(p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  item jsonb; q jsonb; a public.activities;
  first_q jsonb; first_source jsonb; payer_key text; funder_id uuid;
  activity_id text; previous_ids text[] := '{}'; items jsonb := '[]'; lines jsonb := '[]';
  total numeric := 0; result jsonb; recipient text; automatic_preview boolean; identity_key text;
begin
  if not public.finance_transaction_can_issue() then
    raise exception 'finance_transactions_permission_denied' using errcode='42501';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) not between 2 and 100 then
    raise exception 'יש לבחור בין 2 ל-100 פעילויות לחשבון מרוכז';
  end if;
  automatic_preview := not exists(select 1 from jsonb_array_elements(p_items) x where x->'draft'->>'automatic_cumulative_preview' is distinct from 'true');
  for item in select value from jsonb_array_elements(p_items)
      order by value->>'activity', value->>'funder', value->>'month' loop
    activity_id := nullif(btrim(item->>'activity'),'');
    identity_key := case when automatic_preview then jsonb_build_array(activity_id,item->>'funder',item->>'month')::text else activity_id end;
    if activity_id is null or identity_key=any(previous_ids) then
      raise exception 'רשימת הפעילויות כוללת כפילות או פעילות חסרה';
    end if;
    previous_ids := array_append(previous_ids,identity_key);
    select * into a from public.activities where row_id=activity_id and activity_season='school_2027';
    if not found then raise exception 'finance_year_mismatch'; end if;
    q := finance_private.manual_quote(activity_id,(item->>'funder')::uuid,
        (item->>'month')::date,coalesce(item->'draft','{}'::jsonb));
    -- A manual batch may contain Gefen activities ONLY when each is billed
    -- for its full funding share. Performance/monthly partial claims stay
    -- on their existing separate, meeting-scoped issuance path.
    if automatic_preview and (not coalesce((q->'source'->>'gefenFunding')::boolean,false) or q->>'billing_basis' is distinct from 'performance') then
      raise exception 'תצוגת הפקה אוטומטית מחייבת חיובי גפ״ן לפי ביצוע';
    elsif not automatic_preview and coalesce((q->'source'->>'gefenFunding')::boolean,true)
       and q->>'billing_basis' is distinct from 'full_funding' then
      raise exception 'איחוד גפן ידני מחייב חיוב מלא לכל קורס';
    end if;
    if first_q is null then
      first_q := q; first_source := q->'source';
      payer_key := q->>'payer_key_snapshot';
      funder_id := (item->>'funder')::uuid;
    elsif (item->>'funder')::uuid is distinct from funder_id
       or q->>'payer_key_snapshot' is distinct from payer_key
       or q->>'customer_name_snapshot' is distinct from first_q->>'customer_name_snapshot'
       or q->>'issue_date' is distinct from first_q->>'issue_date'
       or q->>'payment_due_date' is distinct from first_q->>'payment_due_date'
       or coalesce(q->>'institution_symbol','') is distinct from coalesce(first_q->>'institution_symbol','')
       or (nullif(q->>'customer_email_snapshot','') is not null
          and nullif(first_q->>'customer_email_snapshot','') is not null
          and lower(q->>'customer_email_snapshot') is distinct from lower(first_q->>'customer_email_snapshot')) then
      raise exception 'כל הפעילויות חייבות להשתייך לאותו משלם, עם פרטי חשבון ומועדי תשלום זהים';
    end if;
    if coalesce(nullif(q->>'customer_email_snapshot',''),'')<>'' then
      if recipient is null then recipient := q->>'customer_email_snapshot';
      elsif lower(recipient)<>lower(q->>'customer_email_snapshot') then
        raise exception 'כתובות הנמען אינן זהות בכל הפעילויות';
      end if;
    end if;
    total := total + (q->>'total_amount')::numeric;
    lines := lines || (q->'finance_transaction_account_lines');
    items := items || jsonb_build_array(jsonb_build_object('activity',activity_id,
      'funder',(item->>'funder')::uuid,'quote',q));
  end loop;
  result := jsonb_build_object(
    'transaction_account_number','טיוטה',
    'issue_date', first_q->>'issue_date',
    'payment_due_date', first_q->>'payment_due_date',
    'institution_symbol',first_q->>'institution_symbol',
    'customer_name_snapshot',first_q->>'customer_name_snapshot',
    'payer_identity_snapshot',first_q->>'payer_identity_snapshot',
    'payer_key_snapshot',payer_key,
    'funding_source_id_snapshot',funder_id,
    'customer_email_snapshot',coalesce(recipient,first_q->>'customer_email_snapshot'),
    'total_amount',round(total,2),
    'finance_transaction_account_lines',lines,
    'billing_basis','consolidated',
    'items',items);
  return result || jsonb_build_object('revision',md5(result::text));
end $function$;

CREATE OR REPLACE FUNCTION public.reserve_finance_funder_batch_account(p_idempotency_key uuid, p_items jsonb, p_expected_revision text)
 RETURNS finance_transaction_accounts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  quote jsonb; entry jsonb; q jsonb; s jsonb; sl jsonb;
  account public.finance_transaction_accounts; activity public.activities;
  funder uuid; activity_id text; item_amount numeric;
  cumulative numeric; before_sum numeric; cap numeric; line_id uuid;
  stale_id uuid;
begin
  if not public.finance_transaction_can_issue() then
    raise exception 'finance_transactions_permission_denied' using errcode='42501';
  end if;
  if p_idempotency_key is null then raise exception 'invalid_idempotency_key'; end if;
  if jsonb_typeof(p_items) is distinct from 'array'
    or jsonb_array_length(p_items) not between 2 and 100 then
    raise exception 'invalid_funder_batch'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) x where x->'draft'->>'automatic_cumulative_preview'='true') then raise exception 'automatic_preview_only'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
  select * into account from public.finance_transaction_accounts where idempotency_key=p_idempotency_key;
  if found then return account; end if;
  -- Cancel stale reservations before checking available funding.
  for stale_id in
    select distinct h.id from public.finance_transaction_accounts h
    join public.finance_transaction_account_lines l on l.account_id=h.id
    where h.document_status='generating'
      and h.created_at<now()-interval '15 minutes'
      and l.activity_row_id in (select x->>'activity' from jsonb_array_elements(p_items) x)
      and not exists(select 1 from finance_private.dispatch_leases d
        where d.account_id=h.id and d.expires_at>now())
  loop
    perform finance_private.cancel_reservation(stale_id,'reservation_expired');
  end loop;
  -- Shared global lock order with the existing reservation RPC.
  perform 1 from public.activities
    where row_id in (select x->>'activity' from jsonb_array_elements(p_items) x)
    order by row_id for update;
  quote := public.finance_funder_batch_quote(p_items);
  if quote->>'revision' is distinct from p_expected_revision then
    raise exception 'התצוגה המקדימה השתנתה; יש לעדכן אותה';
  end if;
  insert into public.finance_transaction_accounts(
    idempotency_key,cutoff_date,institution_symbol,customer_name_snapshot,
    customer_email_snapshot,total_amount,issue_mode,payment_due_date,
    issue_date,manual_draft,payer_key_snapshot,authority_id_snapshot,
    funding_source_id_snapshot,payer_identity_snapshot)
  values(
    p_idempotency_key,(now() at time zone 'Asia/Jerusalem')::date,
    nullif(quote->>'institution_symbol',''),
    quote->>'customer_name_snapshot',nullif(quote->>'customer_email_snapshot',''),
    (quote->>'total_amount')::numeric,'manual',
    (quote->>'payment_due_date')::date,(quote->>'issue_date')::date,
    quote,quote->>'payer_key_snapshot',
    nullif(quote->'items'->0->'quote'->'source'->>'authorityId','')::bigint,
    (quote->>'funding_source_id_snapshot')::uuid,
    quote->>'payer_identity_snapshot')
  returning * into account;
  for entry in select value from jsonb_array_elements(quote->'items')
       order by value->>'activity' loop
    activity_id := entry->>'activity';
    funder := (entry->>'funder')::uuid;
    q := entry->'quote';
    s := q->'source';
    sl := q->'finance_transaction_account_lines'->0;
    select * into activity from public.activities where row_id=activity_id;
    item_amount := (q->>'total_amount')::numeric;
    insert into public.finance_transaction_account_lines(
      account_id,activity_row_id,activity_name_snapshot,gefen_number_snapshot,
      funding_snapshot,activity_price_snapshot,planned_meeting_count_snapshot,
      hourly_rate_snapshot,billed_hours,amount,funding_source_id,funding_amount_snapshot,
      performance_month,billing_rule,billing_coverage,
      school_name_snapshot,service_description_snapshot,quantity_snapshot,unit_price_snapshot)
    values(
      account.id,activity_id,activity.activity_name,sl->>'gefen_number_snapshot',
      s->>'funding',activity.price,(s->>'plannedCount')::int,
      (sl->>'hourly_rate_snapshot')::numeric,(sl->>'billed_hours')::numeric,
      item_amount,funder,(s->>'fundingAmount')::numeric,
      nullif(sl->>'performance_month','')::date,
      case when coalesce((s->>'gefenFunding')::boolean,false) then 'monthly' else 'completion' end,
      q->>'billing_basis',sl->>'school_name_snapshot',
      sl->>'service_description_snapshot',
      (sl->>'quantity_snapshot')::numeric,(sl->>'unit_price_snapshot')::numeric)
    returning id into line_id;
    if q->>'billing_basis'='performance' then
      select sum((x->>'remainingAmount')::numeric) into cap
      from jsonb_array_elements(q->'selected_slots') x;
      if cap is null or cap<=0 then raise exception 'invalid_billing_claim'; end if;
      cumulative := 0;
      for sl in select value from jsonb_array_elements(q->'selected_slots') loop
        before_sum := cumulative;
        cumulative := cumulative+(sl->>'remainingAmount')::numeric;
        insert into public.finance_billing_claims(
          activity_row_id,funding_source_id,meeting_slot,account_id,claimed_amount,settles_meeting)
        values(activity_id,funder,(sl->>'slot')::int,account.id,
          round(item_amount*cumulative/cap,2)-round(item_amount*before_sum/cap,2),
          item_amount=cap);
        insert into public.finance_transaction_account_meetings(
          account_line_id,activity_row_id,meeting_slot,meeting_date,hours)
        values(line_id,activity_id,(sl->>'slot')::int,(sl->>'date')::date,coalesce(nullif((sl->>'remainingHours')::numeric,0),1.5));
      end loop;
    end if;
  end loop;
  perform finance_private.finish_reservation(account.id);
  -- Preserve administrator-approved due-date overrides from the preview.
  update public.finance_transaction_accounts
    set payment_due_date=(quote->>'payment_due_date')::date
    where id=account.id returning * into account;
  insert into public.finance_audit_events(event_type,account_id,details)
  values('funder_consolidated_reserved',account.id,
      jsonb_build_object('activity_count',jsonb_array_length(quote->'items'),
        'payer_key',quote->>'payer_key_snapshot','revision',p_expected_revision));
  return account;
end $function$;
commit;
