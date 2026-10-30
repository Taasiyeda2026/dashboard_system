-- Finance: the activity price is the sole-funder's total funding amount.
-- No UPDATE/INSERT/DELETE of activity allocations, historical accounts or receipts.
-- Allocations split across multiple funders keep each explicit amount unchanged.

-- Single-source activities use the activity price as the funder amount when the
-- redundant allocation amount is missing or zero. Explicit nonzero mismatches
-- stay blocked for review. Multi-source shares are always preserved verbatim.
-- This function only computes effective amounts; it never rewrites activity data.
create function finance_private.resolved_funding_rows(p_activity public.activities)
returns table(funding_source_id uuid, amount numeric, name text)
language plpgsql stable set search_path='' as $effective$
declare
  allocation_count integer;
  match_count integer;
begin
  select count(*) into allocation_count
  from public.activity_funding_sources a where a.activity_id=p_activity.id;
  if allocation_count>0 then
    return query
    select a.funding_source_id,
      case when allocation_count=1
        and position('+' in coalesce(p_activity.funding,''))=0
        and p_activity.price>0
        and (a.amount is null or a.amount=0)
      then p_activity.price::numeric else a.amount end,
      s.name
    from public.activity_funding_sources a
    join public.funding_sources s on s.id=a.funding_source_id
    where a.activity_id=p_activity.id;
    return;
  end if;

  -- Never infer a missing funder for combined or unidentified financing.
  if nullif(btrim(p_activity.funding),'') is null
     or position('+' in p_activity.funding)>0 then
    return query select null::uuid,null::numeric,coalesce(p_activity.funding,'ללא מימון')::text;
    return;
  end if;

  select count(*) into match_count
  from public.funding_sources s
  where lower(regexp_replace(s.name,'["''׳״[:space:]]','','g'))
    = lower(regexp_replace(p_activity.funding,'["''׳״[:space:]]','','g'));

  -- Only use a funding source when its identity is unambiguous.
  if match_count=1 then
    return query
    select s.id,p_activity.price::numeric,s.name
    from public.funding_sources s
    where lower(regexp_replace(s.name,'["''׳״[:space:]]','','g'))
      = lower(regexp_replace(p_activity.funding,'["''׳״[:space:]]','','g'));
  else
    return query select null::uuid,null::numeric,p_activity.funding::text;
  end if;
end $effective$;

revoke all on function finance_private.resolved_funding_rows(public.activities)
from public,anon,authenticated;


-- Automatic billing, manual quotes, reservation/finalization all share billing_rows.
create or replace function finance_private.billing_rows(p_activity public.activities, p_ignore_account uuid default null, p_now timestamptz default now())
returns jsonb language plpgsql stable set search_path='' as $$
declare
  f record; period date; slot record; result jsonb := '[]'; base jsonb;
  slots jsonb; completion_month date; completed jsonb; unbilled jsonb; scoped jsonb;
  planned integer; scheduled integer; done integer; billed_count integer;
  today date := (p_now at time zone 'Asia/Jerusalem')::date;
  local_time time := (p_now at time zone 'Asia/Jerusalem')::time;
  reason text := ''; source_reason text; authority_funding boolean; finished boolean; monthly boolean;
  total_funding numeric; invalid_funding boolean; billed numeric; prior_funding numeric; cancelled_count integer; paid_coverage numeric; full_coverage boolean; adjustment numeric; amount numeric; target numeric;
begin
  select coalesce(jsonb_agg(jsonb_build_object('slot',n,'date',(to_jsonb(p_activity)->>format('date_%s',n))::date) order by n),'[]')
    into slots from generate_series(1,35) n
    where nullif(to_jsonb(p_activity)->>format('date_%s',n),'') is not null;
  scheduled := jsonb_array_length(slots);
  planned := case when btrim(coalesce(p_activity.sessions,'')) ~ '^[1-9][0-9]?$' then btrim(p_activity.sessions)::integer when nullif(btrim(p_activity.sessions),'') is null then scheduled else 0 end;
  if lower(btrim(coalesce(p_activity.status,''))) in ('נמחק','בוטל','מבוטל','deleted','cancelled','canceled') then return '[]'::jsonb;
  elsif p_activity.price is null or p_activity.price<=0 then reason := 'מחיר פעילות אינו תקין';
  elsif planned<1 or planned>35 or scheduled>planned then reason := 'מספר המפגשים אינו תואם לתכנון'; end if;
  select coalesce(sum(afs.amount),0), coalesce(bool_or(afs.amount is null or afs.amount<0),true)
    into total_funding,invalid_funding from finance_private.resolved_funding_rows(p_activity) afs;
  if reason='' and (invalid_funding or total_funding<>p_activity.price) then reason := 'חסרה חלוקת מימון תקינה התואמת למחיר הפעילות'; end if;
  -- A combined funding label cannot be treated as a single payer.
  if reason='' and position('+' in coalesce(p_activity.funding,''))>0
    and (select count(*) from public.activity_funding_sources a where a.activity_id=p_activity.id)<2
  then reason := 'גורם מימון משולב מחייב חלוקה למממנים נפרדים'; end if;
  if reason='' and exists(select 1 from public.finance_transaction_account_lines l join public.finance_transaction_accounts a on a.id=l.account_id
    where l.activity_row_id=p_activity.row_id and l.funding_source_id is null and a.document_status<>'cancelled' and (a.document_status<>'generating' or a.created_at>p_now-interval '15 minutes')) then
    reason := 'חשבון קודם ללא שיוך למממן — נדרש בירור לפני חיוב נוסף';
  end if;
  select coalesce(jsonb_agg(s order by (s->>'slot')::int),'[]') into completed
    from jsonb_array_elements(slots) s
    where not exists(select 1 from public.course_meeting_cancellations c where c.activity_id=p_activity.row_id and c.meeting_date=(s->>'date')::date)
    and ((s->>'date')::date<today or ((s->>'date')::date=today and p_activity.end_time is not null and local_time>p_activity.end_time));
  done := jsonb_array_length(completed);
  select date_trunc('month',max((s->>'date')::date))::date into completion_month from jsonb_array_elements(slots) s
    where not exists(select 1 from public.course_meeting_cancellations c where c.activity_id=p_activity.row_id and c.meeting_date=(s->>'date')::date);
  finished := planned>0 and scheduled=planned and not exists(
    select 1 from jsonb_array_elements(slots) s where not completed @> jsonb_build_array(s)
      and not exists(select 1 from public.course_meeting_cancellations c where c.activity_id=p_activity.row_id and c.meeting_date=(s->>'date')::date));
  for f in select afs.funding_source_id,afs.amount,afs.name
    from finance_private.resolved_funding_rows(p_activity) afs
  loop
    monthly := public.finance_is_gefen_funding(f.name) and position('+' in f.name)=0;
    source_reason := reason;
    authority_funding:=lower(regexp_replace(f.name,'["''׳״[:space:]]','','g')) in ('רשות','רשויות','authority');
    if source_reason='' and authority_funding and not exists(select 1 from public.authorities where id=p_activity.authority_id and nullif(btrim(authority_name),'') is not null) then source_reason:='חסרה זהות הרשות המקומית'; end if;
    if source_reason='' and f.name in ('תעשיינים','תורם','תורמים','מימון אחר') then source_reason:='חסרה זהות ספציפית של הגורם המשלם'; end if;
    if source_reason='' and position('+' in f.name)>0 then source_reason := 'גורם מימון משולב מחייב חלוקה למממנים נפרדים'; end if;
    if source_reason='' and not monthly and scheduled<planned then source_reason := 'חסרים מועדי מפגשים מתוכננים'; end if;
    select coalesce(sum(l.amount),0),coalesce(sum((select count(*) from public.finance_transaction_account_meetings m where m.account_line_id=l.id)),0)::int
      into billed,billed_count from public.finance_transaction_account_lines l join public.finance_transaction_accounts a on a.id=l.account_id
      where l.activity_row_id=p_activity.row_id and l.funding_source_id=f.funding_source_id
        and a.document_status<>'cancelled' and (a.document_status<>'generating' or a.created_at>p_now-interval '15 minutes') and (p_ignore_account is null or a.id<>p_ignore_account);
    select max(l.funding_amount_snapshot),coalesce(sum(l.amount) filter(where h.collection_status='paid'),0),coalesce(bool_or(l.billing_coverage='full_funding'),false)
      into prior_funding,paid_coverage,full_coverage from public.finance_transaction_account_lines l join public.finance_transaction_accounts h on h.id=l.account_id
      where l.activity_row_id=p_activity.row_id and l.funding_source_id=f.funding_source_id and h.document_status in ('issued','mail_draft_ready','sent') and (p_ignore_account is null or h.id<>p_ignore_account);
    select count(*)::int into cancelled_count from jsonb_array_elements(slots) cancelled_slot where exists(select 1 from public.course_meeting_cancellations c where c.activity_id=p_activity.row_id and c.meeting_date=(cancelled_slot->>'date')::date);
    adjustment:=case when (full_coverage or paid_coverage>=prior_funding) and (f.amount is distinct from prior_funding or cancelled_count>0)
      then round(f.amount*greatest(0,planned-cancelled_count)/nullif(planned,0),2)-prior_funding else 0 end;
    if source_reason='' and adjustment<>0 then source_reason:='הפרש לאחר חיוב מלא — נדרשת בדיקת כספים'; end if;
    if source_reason='' and billed>f.amount then source_reason := 'החיוב הקיים חורג מחלק המממן — נדרש בירור'; end if;
    select coalesce(jsonb_agg(s || jsonb_build_object('remainingAmount',remaining) order by (s->>'slot')::int),'[]') into unbilled
    from (
      select s,case when exists(select 1 from public.finance_billing_claims settled join public.finance_transaction_accounts settled_account on settled_account.id=settled.account_id
        where settled.activity_row_id=p_activity.row_id and settled.funding_source_id=f.funding_source_id and settled.meeting_slot=(s->>'slot')::int and settled.settles_meeting
        and (p_ignore_account is null or settled.account_id<>p_ignore_account) and settled_account.document_status<>'cancelled'
        and (settled_account.document_status<>'generating' or settled_account.created_at>p_now-interval '15 minutes')) then 0 else greatest(0,round(f.amount*ordinality/nullif(planned,0),2)-round(f.amount*(ordinality-1)/nullif(planned,0),2)-coalesce((
        select sum(c.claimed_amount) from public.finance_billing_claims c join public.finance_transaction_accounts claim on claim.id=c.account_id
        where c.activity_row_id=p_activity.row_id and c.funding_source_id=f.funding_source_id and c.meeting_slot=(s->>'slot')::int
        and (p_ignore_account is null or c.account_id<>p_ignore_account) and claim.document_status<>'cancelled'
        and (claim.document_status<>'generating' or claim.created_at>p_now-interval '15 minutes')),0)) end remaining
      from jsonb_array_elements(completed) with ordinality performed(s,ordinality)
    ) remaining_slots where remaining>0;
    if source_reason='' and exists(select 1 from public.finance_transaction_account_lines l join public.finance_transaction_accounts h on h.id=l.account_id
      where l.activity_row_id=p_activity.row_id and l.funding_source_id=f.funding_source_id and h.document_status='generating' and h.created_at>p_now-interval '15 minutes'
      and (p_ignore_account is null or h.id<>p_ignore_account)) then source_reason := 'הפקה בתהליך'; end if;
    base := jsonb_build_object('activityRowId',p_activity.row_id,'activityName',p_activity.activity_name,'gefenNumber',p_activity.activity_no,
      'customerName',p_activity.school,'customerEmail',case when monthly then p_activity.contact_email else null end,'fundingSourceId',f.funding_source_id,'funding',f.name,
      'fundingAmount',f.amount,'gefenFunding',monthly,'plannedCount',planned,'scheduledCount',scheduled,'completedCount',done,
      'billedCount',(select count(distinct m.meeting_slot) from public.finance_transaction_account_meetings m join public.finance_transaction_account_lines l on l.id=m.account_line_id
        join public.finance_transaction_accounts h on h.id=l.account_id where l.activity_row_id=p_activity.row_id and l.funding_source_id=f.funding_source_id and h.document_status in ('issued','mail_draft_ready','sent')),
      'billedAmount',(select coalesce(sum(l.amount),0) from public.finance_transaction_account_lines l join public.finance_transaction_accounts h on h.id=l.account_id where l.activity_row_id=p_activity.row_id and l.funding_source_id=f.funding_source_id and h.document_status in ('issued','mail_draft_ready','sent')),'finished',finished,'completionMonth',completion_month,
      'financialAdjustment',adjustment,'fullFundingAmount',greatest(0,f.amount-billed),
      'fullFundingBlockedReason',case when source_reason not in ('','חסרים מועדי מפגשים מתוכננים') then source_reason when billed>=f.amount then 'חלק המממן חויב במלואו' when cancelled_count>0 then 'קיימים מפגשים שבוטלו; יש לעדכן את מסגרת המימון' else '' end,
      'manualMonth',coalesce(completion_month,date_trunc('month',today)::date),
      'institutionSymbol',(select s.semel_mosad::text from public.schools s where s.id=p_activity.school_id),
      'authorityId',case when authority_funding then p_activity.authority_id else null end,
      'payerKey',case when monthly then 'school:'||p_activity.school_id::text when authority_funding then 'authority:'||p_activity.authority_id::text else 'funding:'||f.funding_source_id::text end,
      'payerName',case when monthly then p_activity.school when authority_funding then (select authority_name from public.authorities where id=p_activity.authority_id) else f.name end);
    if source_reason='' and coalesce(base->>'institutionSymbol','')='' then source_reason := 'חסר סמל מוסד'; end if;
    if source_reason='' and coalesce(base->>'payerName','')='' then source_reason := 'חסר גורם משלם'; end if;
    for period in
      select distinct case when monthly then date_trunc('month',(s->>'date')::date)::date else completion_month end
        from jsonb_array_elements(unbilled) s
      union select case when monthly then null::date else completion_month end where jsonb_array_length(unbilled)=0
      order by 1 nulls last
    loop
      select coalesce(jsonb_agg(s order by (s->>'slot')::int),'[]') into scoped from jsonb_array_elements(unbilled) s
        where not monthly or date_trunc('month',(s->>'date')::date)::date=period;
      select coalesce(sum((s->>'remainingAmount')::numeric),0) into amount from jsonb_array_elements(scoped) s;
      target := round(f.amount*done/nullif(planned,0),2);
      if finished and jsonb_array_length(scoped)=jsonb_array_length(unbilled) then amount := target-billed; end if;
      amount := greatest(0,least(amount,f.amount-billed,target-billed));
      result := result || jsonb_build_array(base || jsonb_build_object(
        'period',period,'unbilledSlots',scoped,'unbilledCount',jsonb_array_length(scoped),'unbilledHours',jsonb_array_length(scoped)*1.5,
        'unbilledAmount',amount,'amount',amount,'hourlyRate',f.amount/nullif(planned*1.5,0),
        'blockedReason',source_reason,'eligible',source_reason='' and amount>0 and jsonb_array_length(scoped)>0
          and (case when monthly then period<date_trunc('month',today)::date else finished end),
        'issuableAmount',case when source_reason='' and (case when monthly then period<date_trunc('month',today)::date else finished end) then amount else 0 end));
    end loop;
  end loop;
  return result;
end $$;

-- A receipt can be linked to a sole-funder activity whose funding identity
-- is resolved from the activity, even if no redundant allocation row existed.
create or replace function public.finance_record_receipt(p_idempotency_key uuid,p_receipt jsonb,p_allocations jsonb default '[]') returns uuid
language plpgsql security definer set search_path='' as $$
declare r public.finance_receipts; x jsonb; aid uuid; payer_key text; src text; activity public.activities;
begin
  if not finance_private.can_collect() then raise exception 'finance_collection_permission_denied' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
  select * into r from public.finance_receipts where idempotency_key=p_idempotency_key;
  if found then return r.id; end if;
  if (p_receipt->>'received_date')::date>(now() at time zone 'Asia/Jerusalem')::date or p_idempotency_key is null then raise exception 'invalid_receipt_date'; end if;
  if nullif(p_receipt->>'activity_row_id','') is not null and not exists(
    select 1 from public.activities a
      cross join lateral finance_private.resolved_funding_rows(a) f
    where a.row_id=p_receipt->>'activity_row_id'
      and a.activity_season='school_2027'
      and f.funding_source_id=(p_receipt->>'funding_source_id')::uuid
  ) then raise exception 'payment_payer_or_activity_mismatch'; end if;
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
