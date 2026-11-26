begin;
-- Server-owned source periods and dates. No new table or activity writes.
create function finance_private.gefen_billing_periods(p_activity public.activities,p_funder uuid,p_ignore_account uuid default null)
returns jsonb language sql stable set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('month',(r->>'period')::date,'revision',md5(r::text)) order by (r->>'period')::date),'[]')
  from jsonb_array_elements(finance_private.billing_rows(p_activity,p_ignore_account)) r
  where (r->>'fundingSourceId')::uuid=p_funder and r->>'gefenFunding'='true' and r->>'eligible'='true'
    and (r->>'period')::date>=make_date(substring(p_activity.activity_season from 'school_([0-9]{4})')::int-1,9,1)
    and (r->>'period')::date<=date_trunc('month',finance_private.gefen_cycle_cutoff())::date;
$$;
revoke all on function finance_private.gefen_billing_periods(public.activities,uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.finance_gefen_billing_quote(p_cutoff_date date,p_groups jsonb) returns jsonb
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
    hours:=(g->>'hours')::numeric; rate:=(g->>'rate')::numeric;
    if hours is null or hours not between 0.000001 and 1000000 or hours<>round(hours,6)
      or rate is null or rate not between 0.000001 and 100000000 or rate<>round(rate,6) then raise exception 'invalid_gefen_billing_values'; end if;
    amount:=round(hours*rate,2); if amount<=0 then raise exception 'invalid_gefen_billing_values'; end if;
    select * into a from public.activities where row_id=g->>'activity' and activity_season='school_2027';
    if not found then raise exception 'activity_not_found'; end if;
    funder:=(g->>'funder')::uuid;
    if jsonb_typeof(g->'periods') is distinct from 'array' or jsonb_array_length(g->'periods') not between 1 and 100 then raise exception 'invalid_gefen_billing_periods'; end if;
    if (select jsonb_agg((x->>'month')::date order by (x->>'month')::date)
      from jsonb_array_elements(g->'periods') x) is distinct from (select jsonb_agg((x->>'month')::date order by (x->>'month')::date) from jsonb_array_elements(finance_private.gefen_billing_periods(a,funder)) x) then
      raise exception 'gefen_billing_periods_read_only'; end if;
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
    select sum(jsonb_array_length(x->'unbilledSlots')) into quantity from jsonb_array_elements(source_rows) x;
    if quantity is null or quantity<=0 then raise exception 'invalid_gefen_billing_periods'; end if;
    if g ? 'meetings' and (g->>'meetings')::numeric is distinct from quantity then
      raise exception 'gefen_billing_meetings_read_only'; end if;
    g:=jsonb_build_object('activity',a.row_id,'funder',funder,'meetings',quantity,'hours',hours,'rate',rate,'periods',g->'periods');
    select coalesce(sum(l.amount),0) into remaining from public.finance_transaction_account_lines l
      join public.finance_transaction_accounts h on h.id=l.account_id
      where l.activity_row_id=a.row_id and l.funding_source_id=funder and h.document_status<>'cancelled'
        and (h.document_status<>'generating' or h.created_at>now()-interval '15 minutes');
    remaining:=(source_rows->0->>'fundingAmount')::numeric-remaining;
    if amount>remaining then raise exception 'billing_funding_cap_exceeded'; end if;
    cumulative:=0;
    for r in select value from jsonb_array_elements(source_rows) order by value->>'period' loop
      previous:=cumulative; cumulative:=cumulative+(r->>'issuableAmount')::numeric;
      part_count:=jsonb_array_length(r->'unbilledSlots');
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


-- Also cover an existing generating reservation retried by an old client.
-- Issued documents and their history are never updated by this migration.
do $$ declare def text;
begin
  def:=pg_get_functiondef('finance_private.assert_current(uuid)'::regprocedure);
  if position('if l.billing_override_snapshot is not null then' in def)=0 then
    raise exception 'unexpected_assert_current_definition'; end if;
  execute replace(def,'if l.billing_override_snapshot is not null then',$branch$
    if l.billing_override_snapshot is not null then
      if l.quantity_snapshot is distinct from (jsonb_array_length(l.billing_override_snapshot->'source'->'unbilledSlots'))::numeric then
        perform finance_private.raise_stale_billing('מספר המפגשים חייב להתאים למועדים'); end if;
      if (select jsonb_agg(jsonb_build_object('month',x.performance_month,'revision',x.billing_override_snapshot->>'source_revision') order by x.performance_month)
        from public.finance_transaction_account_lines x where x.account_id=p_account_id and x.activity_row_id=l.activity_row_id and x.funding_source_id=l.funding_source_id)
        is distinct from finance_private.gefen_billing_periods(a,l.funding_source_id,p_account_id) then
        perform finance_private.raise_stale_billing('תקופת הביצוע חייבת להתאים למועדים'); end if;
  $branch$);
end $$;
notify pgrst,'reload schema';
commit;
