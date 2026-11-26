begin;

-- Nullable additions preserve every issued snapshot and all existing clients.
alter table public.finance_transaction_account_lines add column billing_override_snapshot jsonb;

-- A split accounting period may receive zero of the chosen hours/count. Only
-- overridden lines may do this; the aggregate group remains strictly positive.
alter table public.finance_transaction_account_lines drop constraint finance_transaction_account_lines_billing_units_check;
alter table public.finance_transaction_account_lines add constraint finance_transaction_account_lines_billing_units_check check (
  (billing_override_snapshot is not null and billed_hours>=0 and quantity_snapshot>=0 and hourly_rate_snapshot>0)
  or (billed_hours>0 and hourly_rate_snapshot is not null)
  or (billed_hours=0 and hourly_rate_snapshot is null and quantity_snapshot>0 and unit_price_snapshot>0));

-- Include a server revision for the untouched source row. No browser hashing.
create or replace function public.finance_billing_preview(p_activity_ids text[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not coalesce(public.app_current_role()='admin'
    or public.app_has_permission('view_finance_collection')
    or public.app_has_permission('manage_finance_transactions'),false) then
    raise exception 'finance_permission_denied' using errcode='42501'; end if;
  if cardinality(p_activity_ids)>10000 then raise exception 'too_many_activities'; end if;
  return (select coalesce(jsonb_agg(r.value || jsonb_build_object('billingSourceRevision',md5(r.value::text)) ||
    case when r.value->>'eligible'='true' and r.value->>'payerKey' is not null
      then jsonb_build_object('payerEmailMissing',coalesce(r.value->>'customerEmail','')='') else '{}'::jsonb end
    order by a.row_id,r.ordinality),'[]')
    from public.activities a cross join lateral jsonb_array_elements(finance_private.billing_rows(a)) with ordinality r
    where a.row_id=any(p_activity_ids) and a.activity_season='school_2027');
end $$;

-- A previous account's intentionally edited rate must not block later periods.
-- Keep the original mismatch rule for all accounts without this provenance.
do $$ declare def text;
begin
  def:=pg_get_functiondef('finance_private.billing_rows(public.activities,uuid,timestamp with time zone)'::regprocedure);
  if position('and l.hourly_rate_snapshot is distinct from explicit_gefen_rate' in def)=0 then
    raise exception 'unexpected_billing_rows_definition'; end if;
  execute replace(def,'and l.hourly_rate_snapshot is distinct from explicit_gefen_rate',
    'and l.billing_override_snapshot is null and l.hourly_rate_snapshot is distinct from explicit_gefen_rate');
end $$;

-- Canonical quote for both PDF preview and reservation. All periods refer to
-- real eligible source slots; invoice quantities never manufacture meetings.
create function public.finance_gefen_billing_quote(p_cutoff_date date,p_groups jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  g jsonb; p jsonb; r jsonb; a public.activities; source_rows jsonb; s jsonb;
  result jsonb; lines jsonb:='[]'; source_lines jsonb:='[]'; seen text[]:='{}'; group_key text;
  payer_key text; institution text; customer text; email text; funding text; funder uuid;
  quantity numeric; hours numeric; rate numeric; amount numeric; total numeric:=0;
  weight numeric; cumulative numeric; previous numeric; part_hours numeric; part_count numeric; part_amount numeric;
  remaining numeric; period date; range_end date;
begin
  if not public.finance_transaction_can_issue() then raise exception 'finance_transactions_permission_denied' using errcode='42501'; end if;
  if p_cutoff_date is distinct from finance_private.gefen_cycle_cutoff() then raise exception 'invalid_cutoff'; end if;
  if jsonb_typeof(p_groups) is distinct from 'array' or jsonb_array_length(p_groups) not between 1 and 100 then raise exception 'invalid_gefen_billing_groups'; end if;
  for g in select value from jsonb_array_elements(p_groups) order by value->>'activity',value->>'funder' loop
    group_key:=jsonb_build_array(g->>'activity',g->>'funder')::text;
    if group_key=any(seen) then raise exception 'duplicate_billing_group'; end if; seen:=array_append(seen,group_key);
    quantity:=(g->>'meetings')::numeric; hours:=(g->>'hours')::numeric; rate:=(g->>'rate')::numeric;
    if quantity is null or quantity<>trunc(quantity) or quantity not between 1 and 1000000
      or hours is null or hours not between 0.000001 and 1000000 or hours<>round(hours,6)
      or rate is null or rate not between 0.000001 and 100000000 or rate<>round(rate,6) then raise exception 'invalid_gefen_billing_values'; end if;
    amount:=round(hours*rate,2); if amount<=0 then raise exception 'invalid_gefen_billing_values'; end if;
    select * into a from public.activities where row_id=g->>'activity' and activity_season='school_2027';
    if not found then raise exception 'activity_not_found'; end if;
    funder:=(g->>'funder')::uuid;
    if jsonb_typeof(g->'periods') is distinct from 'array' or jsonb_array_length(g->'periods') not between 1 and 100 then raise exception 'invalid_gefen_billing_periods'; end if;
    source_rows:='[]'; weight:=0; range_end:=null;
    for p in select value from jsonb_array_elements(g->'periods') order by value->>'month' loop
      period:=(p->>'month')::date;
      if period is null or period<>date_trunc('month',period)::date or period>date_trunc('month',p_cutoff_date)::date
        or exists(select 1 from jsonb_array_elements(source_rows) x where x->>'period'=period::text) then raise exception 'invalid_gefen_billing_periods'; end if;
      select x into r from jsonb_array_elements(finance_private.billing_rows(a)) x where (x->>'fundingSourceId')::uuid=funder and (x->>'period')::date=period;
      if r is null or r->>'gefenFunding' is distinct from 'true' or r->>'eligible' is distinct from 'true' or coalesce(r->>'blockedReason','')<>'' then
        raise exception 'billing_blocked:%',coalesce(r->>'blockedReason','activity_not_eligible'); end if;
      if md5(r::text) is distinct from p->>'revision' then raise exception 'stale_billing_preview'; end if;
      if coalesce(r->>'customerEmail','')='' then raise exception 'no_valid_payer_email'; end if;
      if payer_key is not null and (payer_key is distinct from r->>'payerKey' or institution is distinct from r->>'institutionSymbol') then raise exception 'mixed_payers'; end if;
      payer_key:=r->>'payerKey';institution:=r->>'institutionSymbol';customer:=r->>'payerName';email:=r->>'customerEmail';funding:=r->>'funding';
      source_rows:=source_rows||jsonb_build_array(r);weight:=weight+(r->>'issuableAmount')::numeric;
      range_end:=greatest(range_end,period);
    end loop;
    select coalesce(sum(l.amount),0) into remaining from public.finance_transaction_account_lines l
      join public.finance_transaction_accounts h on h.id=l.account_id
      where l.activity_row_id=a.row_id and l.funding_source_id=funder and h.document_status<>'cancelled'
        and (h.document_status<>'generating' or h.created_at>now()-interval '15 minutes');
    remaining:=(source_rows->0->>'fundingAmount')::numeric-remaining;
    if amount>remaining then raise exception 'billing_funding_cap_exceeded'; end if;
    cumulative:=0;
    for r in select value from jsonb_array_elements(source_rows) order by value->>'period' loop
      previous:=cumulative; cumulative:=cumulative+(r->>'issuableAmount')::numeric;
      part_count:=round(quantity*cumulative/weight)-round(quantity*previous/weight);
      part_hours:=round(hours*cumulative/weight,6)-round(hours*previous/weight,6);
      part_amount:=round(amount*cumulative/weight,2)-round(amount*previous/weight,2);
      source_lines:=source_lines||jsonb_build_array(jsonb_build_object('activity_row_id',a.row_id,'funding_source_id',funder,
        'performance_month',r->>'period','billing_range_end',range_end,'expected_amount',r->'issuableAmount',
        'meeting_slots',(select jsonb_agg(x->'slot' order by (x->>'slot')::int) from jsonb_array_elements(r->'unbilledSlots') x),'issue_mode','automatic'));
      lines:=lines||jsonb_build_array(jsonb_build_object('activity_row_id',a.row_id,'activity_name_snapshot',a.activity_name,
        'school_name_snapshot',a.school,'service_description_snapshot',a.activity_name,'gefen_number_snapshot',a.activity_no,
        'activity_price_snapshot',a.price,'planned_meeting_count_snapshot',(r->>'plannedCount')::int,
        'funding_snapshot',funding,'funding_source_id',funder,'funding_amount_snapshot',(r->>'fundingAmount')::numeric,
        'performance_month',r->>'period','billing_rule','monthly','billing_coverage','performance',
        'quantity_snapshot',part_count,'billed_hours',part_hours,'hourly_rate_snapshot',rate,'unit_price_snapshot',rate,'amount',part_amount,
        'billing_override_snapshot',jsonb_build_object('source',r,'chosen',g-'periods','source_revision',md5(r::text)),
        'finance_transaction_account_meetings',(select jsonb_agg(jsonb_build_object('meeting_slot',x->'slot','meeting_date',x->'date','hours',x->'remainingHours') order by (x->>'slot')::int) from jsonb_array_elements(r->'unbilledSlots') x)));
    end loop;
    total:=total+amount;
  end loop;
  result:=jsonb_build_object('transaction_account_number','טיוטה','issue_date',(now() at time zone 'Asia/Jerusalem')::date,
    'payment_due_date',(date_trunc('month',now() at time zone 'Asia/Jerusalem')+interval '1 month - 1 day')::date+finance_private.payment_days(funding),
    'customer_name_snapshot',customer,'payer_identity_snapshot',customer,'payer_key_snapshot',payer_key,'institution_symbol',institution,
    'customer_email_snapshot',email,'total_amount',total,'source_lines',source_lines,'finance_transaction_account_lines',lines);
  return result||jsonb_build_object('revision',md5(result::text));
end $$;
revoke all on function public.finance_gefen_billing_quote(date,jsonb) from public,anon;
grant execute on function public.finance_gefen_billing_quote(date,jsonb) to authenticated;

create function public.reserve_finance_gefen_billing_account(p_idempotency_key uuid,p_cutoff_date date,p_groups jsonb,p_expected_revision text)
returns public.finance_transaction_accounts language plpgsql security definer set search_path='' as $$
declare account public.finance_transaction_accounts; q jsonb; sl jsonb; l public.finance_transaction_account_lines;
  m record; cap numeric; cumulative numeric; previous numeric;
begin
  if not public.finance_transaction_can_issue() then raise exception 'finance_transactions_permission_denied' using errcode='42501'; end if;
  if p_idempotency_key is null then raise exception 'invalid_idempotency_key'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
  select * into account from public.finance_transaction_accounts where idempotency_key=p_idempotency_key;
  if found then return account; end if;
  perform 1 from public.activities where row_id in (select x->>'activity' from jsonb_array_elements(p_groups) x) order by row_id for update;
  q:=public.finance_gefen_billing_quote(p_cutoff_date,p_groups);
  if q->>'revision' is distinct from p_expected_revision then raise exception 'stale_billing_preview'; end if;
  -- Reuse all existing permission, slot, locking, numbering and funding checks.
  account:=public.reserve_finance_transaction_account(p_idempotency_key,p_cutoff_date,q->>'institution_symbol',q->>'customer_name_snapshot',q->>'customer_email_snapshot',q->'source_lines');
  for sl in select value from jsonb_array_elements(q->'finance_transaction_account_lines') loop
    select * into strict l from public.finance_transaction_account_lines where account_id=account.id
      and activity_row_id=sl->>'activity_row_id' and funding_source_id=(sl->>'funding_source_id')::uuid and performance_month=(sl->>'performance_month')::date;
    update public.finance_transaction_account_lines set quantity_snapshot=(sl->>'quantity_snapshot')::numeric,
      billed_hours=(sl->>'billed_hours')::numeric,hourly_rate_snapshot=(sl->>'hourly_rate_snapshot')::numeric,
      unit_price_snapshot=(sl->>'unit_price_snapshot')::numeric,amount=(sl->>'amount')::numeric,
      billing_override_snapshot=sl->'billing_override_snapshot' where id=l.id;
    select sum(c.claimed_amount) into cap from public.finance_billing_claims c where c.account_id=account.id and c.activity_row_id=l.activity_row_id and c.funding_source_id=l.funding_source_id
      and c.meeting_slot in (select meeting_slot from public.finance_transaction_account_meetings where account_line_id=l.id);
    cumulative:=0;
    for m in select c.* from public.finance_billing_claims c where c.account_id=account.id and c.activity_row_id=l.activity_row_id and c.funding_source_id=l.funding_source_id
      and c.meeting_slot in (select meeting_slot from public.finance_transaction_account_meetings where account_line_id=l.id) order by c.meeting_slot loop
      previous:=cumulative;cumulative:=cumulative+m.claimed_amount;
      update public.finance_billing_claims set claimed_amount=round((sl->>'amount')::numeric*cumulative/cap,2)-round((sl->>'amount')::numeric*previous/cap,2)
        where account_id=account.id and activity_row_id=l.activity_row_id and funding_source_id=l.funding_source_id and meeting_slot=m.meeting_slot;
    end loop;
  end loop;
  update public.finance_transaction_accounts set total_amount=(q->>'total_amount')::numeric where id=account.id returning * into account;
  insert into public.finance_audit_events(event_type,account_id,details) values('gefen_billing_values_reserved',account.id,
    jsonb_build_object('revision',p_expected_revision,'groups',p_groups));
  return account;
end $$;
revoke all on function public.reserve_finance_gefen_billing_account(uuid,date,jsonb,text) from public,anon;
grant execute on function public.reserve_finance_gefen_billing_account(uuid,date,jsonb,text) to authenticated;

-- Extend only the new provenance branch. Existing/manual account validation
-- stays byte-for-byte unchanged; it remains mandatory at actual dispatch.
do $$ declare def text;
begin
  def:=pg_get_functiondef('finance_private.assert_current(uuid)'::regprocedure);
  if position('if l.billing_coverage = ''full_funding'' then' in def)=0 then raise exception 'unexpected_assert_current_definition'; end if;
  execute replace(def,'if l.billing_coverage = ''full_funding'' then',$branch$
    if l.billing_override_snapshot is not null then
      if account.issue_mode<>'automatic' or r is null or r->>'eligible' is distinct from 'true'
        or md5(r::text) is distinct from l.billing_override_snapshot->>'source_revision' then
        perform finance_private.raise_stale_billing('נתוני המקור לחשבון גפ״ן'); end if;
      if (select sum(x.amount) from public.finance_transaction_account_lines x where x.account_id=p_account_id and x.activity_row_id=l.activity_row_id and x.funding_source_id=l.funding_source_id)
        >(r->>'fullFundingAmount')::numeric then perform finance_private.raise_stale_billing('יתרת המימון'); end if;
      continue;
    end if;
    if l.billing_coverage = 'full_funding' then
  $branch$);
end $$;

notify pgrst,'reload schema';
commit;
