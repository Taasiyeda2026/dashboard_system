-- Two fixed Gefen openings, evaluated on load in Israel time; no scheduled job.
-- No historical documents, claims, receipts, amounts or payment terms are rewritten.
-- billing_rows is shared by preview, reservation, manual quotes and assert_current,
-- which is called by validate_finance_dispatch and finalization.
begin;

create or replace function finance_private.gefen_cycle_cutoff(p_now timestamptz default now())
returns date language sql stable set search_path='' as $$
  select case when extract(day from p_now at time zone 'Asia/Jerusalem')>=15
    then date_trunc('month',p_now at time zone 'Asia/Jerusalem')::date+13
    else date_trunc('month',p_now at time zone 'Asia/Jerusalem')::date-1 end
$$;
revoke all on function finance_private.gefen_cycle_cutoff(timestamptz) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION finance_private.billing_rows(p_activity activities, p_ignore_account uuid DEFAULT NULL::uuid, p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  gefen_cutoff date := finance_private.gefen_cycle_cutoff(p_now);
  calendar_completed jsonb; course_monthly boolean; threshold_month date; period_done integer; period_reason text;
  f record; period date; slot record; result jsonb := '[]'; base jsonb;
  slots jsonb; completion_month date; completed jsonb; unbilled jsonb; scoped jsonb;
  planned integer; scheduled integer; done integer; billed_count integer;
  today date := (p_now at time zone 'Asia/Jerusalem')::date;
  local_time time := (p_now at time zone 'Asia/Jerusalem')::time;
  reason text := ''; source_reason text; authority_funding boolean; school_funding boolean; finished boolean; monthly boolean;
  total_funding numeric; invalid_funding boolean;
  matched_order_number text; matched_order_amount numeric; matched_order_rate numeric;
  order_matched boolean := false; effective_activity_price numeric; billed numeric; prior_funding numeric; cancelled_count integer; paid_coverage numeric; full_coverage boolean; adjustment numeric; amount numeric; target numeric;
begin
  -- Revalidate a pending automatic account against its reserved cutoff, while
  -- keeping p_now as the real clock for leases and reservation expiry.
  if p_ignore_account is not null then
    gefen_cutoff := coalesce((select h.cutoff_date from public.finance_transaction_accounts h
      where h.id=p_ignore_account and h.issue_mode='automatic' and h.document_status='generating'),gefen_cutoff);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('slot',n,'date',(to_jsonb(p_activity)->>format('date_%s',n))::date) order by n),'[]')
    into slots from generate_series(1,35) n
    where nullif(to_jsonb(p_activity)->>format('date_%s',n),'') is not null;
  scheduled := jsonb_array_length(slots);
  effective_activity_price := p_activity.price;
  -- Explicit unique order-to-activity evidence; no implicit match on school alone.
  if p_activity.activity_season='school_2027'
     and lower(btrim(coalesce(p_activity.activity_type,'')))='course'
     and btrim(coalesce(p_activity.funding,''))='גפן'
     and btrim(coalesce(p_activity.sessions,'')) ~ '^[0-9]+$'
     and (select count(*) from finance_private.resolved_funding_rows(p_activity))=1
     and (select count(*) from finance_private.resolved_funding_rows(p_activity) src
          where public.finance_is_gefen_funding(src.name) and src.amount=p_activity.price)=1
  then
    select matched.order_number, matched.order_total, matched.order_hourly_rate
      into matched_order_number, matched_order_amount, matched_order_rate
    from finance_private.gefen_order_billing_matches matched
    where matched.activity_row_id=p_activity.row_id
      and matched.order_hours=btrim(p_activity.sessions)::numeric*1.5
      and matched.program_code=(case when p_activity.activity_no='3604' then '52279' else p_activity.activity_no end)
      and round(matched.order_hourly_rate*matched.order_hours,2)=matched.order_total;
    order_matched := found;
    if order_matched then effective_activity_price := matched_order_amount; end if;
  end if;
  -- Unpriced tours are pending cost agreement, not invoices ready for billing.
  if lower(btrim(coalesce(p_activity.activity_type,'')))='tour'
     and (p_activity.price is null or p_activity.price<=0) then
    return '[]'::jsonb;
  end if;
  planned := case when lower(btrim(coalesce(p_activity.activity_type,'')))='tour' then 1 when btrim(coalesce(p_activity.sessions,'')) ~ '^[1-9][0-9]?$' then btrim(p_activity.sessions)::integer when nullif(btrim(p_activity.sessions),'') is null then scheduled else 0 end;
  if lower(btrim(coalesce(p_activity.status,''))) in ('נמחק','בוטל','מבוטל','deleted','cancelled','canceled') then return '[]'::jsonb;
  elsif p_activity.price is null or p_activity.price<=0 then reason := 'מחיר פעילות אינו תקין';
  elsif planned<1 or planned>35 or scheduled>planned then reason := 'מספר המפגשים אינו תואם לתכנון'; end if;
  select coalesce(sum(afs.amount),0), coalesce(bool_or(afs.amount is null or afs.amount<0),true)
    into total_funding,invalid_funding from finance_private.resolved_funding_rows(p_activity) afs;
  if order_matched and not invalid_funding and total_funding=p_activity.price then
    total_funding := matched_order_amount;
  end if;
  if reason='' and (invalid_funding or total_funding<>effective_activity_price) then reason := 'חסרה חלוקת מימון תקינה התואמת למחיר הפעילות'; end if;
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
  calendar_completed := completed;
  select date_trunc('month',max((s->>'date')::date))::date into completion_month from jsonb_array_elements(slots) s
    where not exists(select 1 from public.course_meeting_cancellations c where c.activity_id=p_activity.row_id and c.meeting_date=(s->>'date')::date);
  finished := planned>0 and scheduled=planned and not exists(
    select 1 from jsonb_array_elements(slots) s where not completed @> jsonb_build_array(s)
      and not exists(select 1 from public.course_meeting_cancellations c where c.activity_id=p_activity.row_id and c.meeting_date=(s->>'date')::date));
  for f in select afs.funding_source_id,
      case when order_matched and public.finance_is_gefen_funding(afs.name) then matched_order_amount else afs.amount end as amount,
      afs.name from finance_private.resolved_funding_rows(p_activity) afs
  loop
    monthly := public.finance_is_gefen_funding(f.name) and position('+' in f.name)=0;
    school_funding := monthly or finance_private.is_school_direct_funding(f.name);
    course_monthly := monthly and lower(btrim(coalesce(p_activity.activity_type,'')))='course';
    completed := calendar_completed;
    if monthly then
      -- All Gefen activity types share the fixed opening cutoff. Non-Gefen
      -- funding keeps its existing completion and same-day rules.
      select coalesce(jsonb_agg(s order by (s->>'slot')::int),'[]') into completed
        from jsonb_array_elements(calendar_completed) s where (s->>'date')::date<=gefen_cutoff;
    end if;
    done := jsonb_array_length(completed);
    finished := planned>0 and scheduled=planned and not exists(
      select 1 from jsonb_array_elements(slots) s where not completed @> jsonb_build_array(s)
        and not exists(select 1 from public.course_meeting_cancellations c where c.activity_id=p_activity.row_id and c.meeting_date=(s->>'date')::date));
    -- Slot identity distinguishes legitimate same-day meetings. No attendance join.
    select date_trunc('month',(s->>'date')::date)::date into threshold_month
      from jsonb_array_elements(completed) s
      order by (s->>'date')::date,(s->>'slot')::int offset 2 limit 1;
    source_reason := reason;
    authority_funding:=lower(regexp_replace(f.name,'["''׳״[:space:]]','','g')) in ('רשות','רשויות','authority');
    if source_reason='' and authority_funding and not exists(select 1 from public.authorities where id=p_activity.authority_id and nullif(btrim(authority_name),'') is not null) then source_reason:='חסרה זהות הרשות המקומית'; end if;
    if source_reason='' and f.name in ('תעשיינים','תורם','תורמים','מימון אחר') then source_reason:='חסרה זהות ספציפית של הגורם המשלם'; end if;
    if source_reason='' and position('+' in f.name)>0 then source_reason := 'גורם מימון משולב מחייב חלוקה למממנים נפרדים'; end if;
    if source_reason='' and not monthly and scheduled<planned and lower(btrim(coalesce(p_activity.activity_type,'')))<>'tour' then source_reason := 'חסרים מועדי מפגשים מתוכננים'; end if;
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
    select coalesce(jsonb_agg(s || jsonb_build_object('remainingAmount',remaining,'remainingHours',case when lower(btrim(coalesce(p_activity.activity_type,''))) in ('workshop','tour') then 0 else 1.5*remaining/nullif(gross_amount,0) end) order by (s->>'slot')::int),'[]') into unbilled
    from (
      select s,round(f.amount*ordinality/nullif(planned,0),2)-round(f.amount*(ordinality-1)/nullif(planned,0),2) gross_amount,case when exists(select 1 from public.finance_billing_claims settled join public.finance_transaction_accounts settled_account on settled_account.id=settled.account_id
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
      'customerName',case when school_funding then coalesce((select nullif(to_jsonb(s)->>'school_name','') from public.schools s where s.id=p_activity.school_id),p_activity.school) else p_activity.school end,'activityType',p_activity.activity_type,'customerEmail',finance_private.manual_payer_emails(p_activity,f.funding_source_id,school_funding,authority_funding),'fundingSourceId',f.funding_source_id,'funding',f.name,
      'fundingAmount',f.amount,'gefenFunding',monthly,'activityPrice',effective_activity_price,
      'billingBasis',case when order_matched and monthly then 'gefen_matched_order' else 'activity_data' end,
      'matchedGefenOrderNumber',case when order_matched and monthly then matched_order_number else null end,
      'matchedGefenOrderHourlyRate',case when order_matched and monthly then matched_order_rate else null end,'plannedHours',case when lower(btrim(coalesce(p_activity.activity_type,''))) in ('workshop','tour') then 0 else planned*1.5 end,'plannedCount',planned,'scheduledCount',scheduled,'completedCount',done,
      'billedCount',(select count(distinct m.meeting_slot) from public.finance_transaction_account_meetings m join public.finance_transaction_account_lines l on l.id=m.account_line_id
        join public.finance_transaction_accounts h on h.id=l.account_id where l.activity_row_id=p_activity.row_id and l.funding_source_id=f.funding_source_id and h.document_status in ('issued','mail_draft_ready','sent')),
      'billedAmount',(select coalesce(sum(l.amount),0) from public.finance_transaction_account_lines l join public.finance_transaction_accounts h on h.id=l.account_id where l.activity_row_id=p_activity.row_id and l.funding_source_id=f.funding_source_id and h.document_status in ('issued','mail_draft_ready','sent')),'finished',finished,'completionMonth',completion_month,
      'billingCutoff',case when monthly then gefen_cutoff else today end,
      'nextBillingUpdate',case when monthly then case when extract(day from gefen_cutoff)=14 then (date_trunc('month',gefen_cutoff)+interval '1 month')::date else gefen_cutoff+15 end else null end,
      'financialAdjustment',adjustment,'fullFundingAmount',greatest(0,f.amount-billed),
      'fullFundingBlockedReason',case when source_reason not in ('','חסרים מועדי מפגשים מתוכננים') then source_reason when billed>=f.amount then 'חלק המממן חויב במלואו' when cancelled_count>0 then 'קיימים מפגשים שבוטלו; יש לעדכן את מסגרת המימון' else '' end,
      'manualMonth',coalesce(completion_month,date_trunc('month',today)::date),
      'institutionSymbol',(select s.semel_mosad::text from public.schools s where s.id=p_activity.school_id),
      'authorityId',case when authority_funding then p_activity.authority_id else null end,
      'payerKey',case when school_funding then 'school:'||p_activity.school_id::text when authority_funding then 'authority:'||p_activity.authority_id::text else 'funding:'||f.funding_source_id::text end,
      'payerName',case when school_funding then coalesce((select nullif(to_jsonb(s)->>'school_name','') from public.schools s where s.id=p_activity.school_id),p_activity.school) when authority_funding then (select authority_name from public.authorities where id=p_activity.authority_id) else f.name end);
    if source_reason='' and school_funding and not exists(select 1 from public.schools where id=p_activity.school_id) then source_reason := 'חסר שיוך לבית ספר'; end if;
    if source_reason='' and monthly and coalesce(base->>'institutionSymbol','')='' then source_reason := 'חסר סמל מוסד'; end if;
    if source_reason='' and coalesce(base->>'payerName','')='' then source_reason := 'חסר גורם משלם'; end if;
    for period in
      select distinct case when monthly then date_trunc('month',(s->>'date')::date)::date else completion_month end
        from jsonb_array_elements(unbilled) s
      union select threshold_month where course_monthly and threshold_month is not null and jsonb_array_length(unbilled)>0
      union select m::date from generate_series(
        (select min(date_trunc('month',(s->>'date')::date)) from jsonb_array_elements(slots) s),
        date_trunc('month',today),interval '1 month') m where course_monthly
      union select case when monthly then null::date else completion_month end where jsonb_array_length(unbilled)=0
      order by 1 nulls last
    loop
      period_done := done;
      period_reason := source_reason;
      if course_monthly then
        select count(*)::int into period_done from jsonb_array_elements(completed) s
          where (s->>'date')::date < period + interval '1 month';
        if period_reason='' and period_done<3 then
          period_reason := 'ממתין להשלמת שלושה מפגשים';
        end if;
      end if;
      select coalesce(jsonb_agg(s order by (s->>'slot')::int),'[]') into scoped from jsonb_array_elements(unbilled) s
        where not monthly or case
          when course_monthly and threshold_month is not null and period>=threshold_month
            then greatest(date_trunc('month',(s->>'date')::date)::date,threshold_month)=period
          else date_trunc('month',(s->>'date')::date)::date=period end;
      select coalesce(sum((s->>'remainingAmount')::numeric),0) into amount from jsonb_array_elements(scoped) s;
      target := round(f.amount*period_done/nullif(planned,0),2);
      if finished and jsonb_array_length(scoped)=jsonb_array_length(unbilled) then amount := target-billed; end if;
      amount := greatest(0,least(amount,f.amount-billed,target-billed));
      result := result || jsonb_build_array(base || jsonb_build_object(
        'period',period,'completedCount',period_done,
        'eligibilityCutoff',case when course_monthly then least((period+interval '1 month - 1 day')::date,gefen_cutoff) else today end,
        'eligibilityStatus',case when course_monthly and period_done<3 then 'waiting_three_meetings' else null end,
        'fullFundingBlockedReason',case when course_monthly and (period_done<3 or period is null or period>date_trunc('month',gefen_cutoff)::date)
          then 'ממתין להשלמת שלושה מפגשים עד תאריך החתך' else base->>'fullFundingBlockedReason' end,
        'unbilledSlots',scoped,'unbilledCount',jsonb_array_length(scoped),'unbilledHours',case when lower(btrim(coalesce(p_activity.activity_type,''))) in ('tour','workshop') then 0 else (select coalesce(sum((s->>'remainingHours')::numeric),0) from jsonb_array_elements(scoped) s) end,
        'unbilledAmount',amount,'amount',amount,'hourlyRate',case when lower(btrim(coalesce(p_activity.activity_type,''))) in ('tour','workshop') then null else f.amount/nullif(planned*1.5,0) end,
        'blockedReason',period_reason,'eligible',period_reason='' and amount>0 and jsonb_array_length(scoped)>0
          and (case when monthly then period<=date_trunc('month',gefen_cutoff)::date else finished end),
        'issuableAmount',case when period_reason='' and (case when monthly then period<=date_trunc('month',gefen_cutoff)::date else finished end) then amount else 0 end));
    end loop;
  end loop;
  return result;
end $function$;

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
      insert into public.finance_transaction_account_meetings(account_line_id,activity_row_id,meeting_slot,meeting_date,hours)
        values(line_id,a.row_id,(meeting->>'slot')::int,(meeting->>'date')::date,coalesce(nullif((meeting->>'remainingHours')::numeric,0),1.5));
    end loop;
    total := total+(row->>'issuableAmount')::numeric;
  end loop;
  update public.finance_transaction_accounts set total_amount=total,customer_name_snapshot=customer,payer_key_snapshot=payer_key,authority_id_snapshot=(row->>'authorityId')::bigint,funding_source_id_snapshot=payer where id=account.id returning * into account;
  perform finance_private.finish_reservation(account.id);
  select * into account from public.finance_transaction_accounts where id=account.id;
  return account;
end $function$;

commit;
