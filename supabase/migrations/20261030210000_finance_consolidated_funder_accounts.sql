-- Consolidated non-Gefen invoices: one payer, multiple activity lines.
-- Keeps Gefen monthly invoicing and the existing single-activity manual path unchanged.
create or replace function public.finance_funder_batch_quote(p_items jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  item jsonb; q jsonb; a public.activities;
  first_q jsonb; first_source jsonb; payer_key text; funder_id uuid;
  activity_id text; previous_ids text[] := '{}'; items jsonb := '[]'; lines jsonb := '[]';
  total numeric := 0; result jsonb; recipient text;
begin
  if not public.finance_transaction_can_issue() then
    raise exception 'finance_transactions_permission_denied' using errcode='42501';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) not between 2 and 100 then
    raise exception 'יש לבחור בין 2 ל-100 פעילויות לחשבון מרוכז';
  end if;
  for item in select value from jsonb_array_elements(p_items)
      order by value->>'activity', value->>'funder' loop
    activity_id := nullif(btrim(item->>'activity'),'');
    if activity_id is null or activity_id=any(previous_ids) then
      raise exception 'רשימת הפעילויות כוללת כפילות או פעילות חסרה';
    end if;
    previous_ids := array_append(previous_ids,activity_id);
    select * into a from public.activities where row_id=activity_id and activity_season='school_2027';
    if not found then raise exception 'finance_year_mismatch'; end if;
    q := finance_private.manual_quote(activity_id,(item->>'funder')::uuid,
        (item->>'month')::date,coalesce(item->'draft','{}'::jsonb));
    if coalesce((q->'source'->>'gefenFunding')::boolean,true) then
      raise exception 'חשבונות גפן מופקים במסלול נפרד';
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
end $$;

create or replace function public.reserve_finance_funder_batch_account(
  p_idempotency_key uuid, p_items jsonb, p_expected_revision text)
returns public.finance_transaction_accounts
language plpgsql security definer set search_path='' as $$
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
      nullif(sl->>'performance_month','')::date,'completion',
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
          account_line_id,activity_row_id,meeting_slot,meeting_date)
        values(line_id,activity_id,(sl->>'slot')::int,(sl->>'date')::date);
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
end $$;

revoke all on function public.finance_funder_batch_quote(jsonb) from public,anon;
revoke all on function public.reserve_finance_funder_batch_account(uuid,jsonb,text) from public,anon;
grant execute on function public.finance_funder_batch_quote(jsonb) to authenticated;
grant execute on function public.reserve_finance_funder_batch_account(uuid,jsonb,text) to authenticated;
