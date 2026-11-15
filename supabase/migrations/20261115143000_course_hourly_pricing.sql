-- Explicit, opt-in course hourly rate. Existing agreements and historic invoices are not updated.
-- Apply only after staging validation and approved transition report.
begin;
alter table public.activities add column if not exists course_hourly_rate numeric(18,8);
alter table public.activities add column if not exists course_hourly_rate_source text;
alter table public.activities add column if not exists course_proposal_hours numeric;
-- Preserve the agreed proposal rate, amount and hours on creation, including Israa
-- handoff. No historical rows are touched. A later intentional price/rate/session
-- edit switches to the ordinary course formula instead of rewriting the proposal.
create or replace function public.activity_course_rate_from_proposal()
returns trigger language plpgsql set search_path='' as $course_rate$
declare item public.proposal_agreement_items%rowtype;
begin
  if tg_op='INSERT' then
    new.course_hourly_rate_source := case when new.course_hourly_rate is not null then 'manual' else null end;
    new.course_proposal_hours := null;
    if new.activity_type='course' and new.activity_season='school_2027'
      and coalesce(new.proposal_item_id,new.israa_source_item_id) is not null then
      select * into item from public.proposal_agreement_items
      where id=coalesce(new.proposal_item_id,new.israa_source_item_id);
      if found and item.hourly_price>0 and (new.course_hourly_rate is null or new.course_hourly_rate=item.hourly_price) then
        new.course_hourly_rate := item.hourly_price;
        new.course_hourly_rate_source := 'proposal';
        new.course_proposal_hours := item.hours_count;
      end if;
    end if;
  else
    if new.course_hourly_rate is distinct from old.course_hourly_rate
      or new.sessions is distinct from old.sessions
      or new.price is distinct from old.price then
      new.course_hourly_rate_source := case when new.course_hourly_rate is not null then 'manual' else null end;
      new.course_proposal_hours := null;
    else
      new.course_hourly_rate_source := old.course_hourly_rate_source;
      new.course_proposal_hours := old.course_proposal_hours;
    end if;
  end if;
  if new.activity_type is distinct from 'course' then
    new.course_hourly_rate := null;
    new.course_hourly_rate_source := null;
    new.course_proposal_hours := null;
  end if;
  return new;
end;
$course_rate$;
revoke all on function public.activity_course_rate_from_proposal() from public,anon,authenticated;
create trigger zz_activity_course_rate_from_proposal
before insert or update of activity_type,course_hourly_rate,course_hourly_rate_source,course_proposal_hours,sessions,price
on public.activities for each row execute function public.activity_course_rate_from_proposal();
alter table public.activities add constraint activities_course_hourly_rate_valid
  check (course_hourly_rate is null or (
    activity_type='course' and course_hourly_rate>0 and course_hourly_rate<=1000000
    and (coalesce(course_hourly_rate_source,'')='proposal' or case when btrim(coalesce(sessions,'')) ~ '^[1-9][0-9]?$'
      then btrim(sessions)::integer between 1 and 35
       and price is not null and price=round(course_hourly_rate*btrim(sessions)::integer*1.5,6)
      else false end)
  )) not valid;
alter table public.activities validate constraint activities_course_hourly_rate_valid;

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
  order_matched boolean := false; effective_activity_price numeric; billed numeric; prior_funding numeric; cancelled_count integer; paid_coverage numeric; full_coverage boolean; adjustment numeric; amount numeric; target numeric; explicit_gefen_rate numeric;
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
    explicit_gefen_rate := case when monthly and lower(btrim(coalesce(p_activity.activity_type,'')))='course' then p_activity.course_hourly_rate end;
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
    if source_reason='' and explicit_gefen_rate is not null and p_activity.course_hourly_rate_source='proposal'
      and abs(explicit_gefen_rate*planned*1.5-p_activity.price)>0.01 then
      source_reason := 'שעות או מחיר בהצעת המחיר שונים מבסיס 1.5 שעות למפגש — נדרשת בדיקת כספים';
    end if;
    if source_reason='' and explicit_gefen_rate is not null and order_matched and matched_order_rate is distinct from explicit_gefen_rate then
      source_reason := 'תעריף שעתי שונה מהזמנת גפ״ן מאומתת — נדרש בירור';
    end if;
    if source_reason='' and explicit_gefen_rate is not null and exists (
      select 1 from public.finance_transaction_account_lines l join public.finance_transaction_accounts h on h.id=l.account_id
      where l.activity_row_id=p_activity.row_id and l.funding_source_id=f.funding_source_id
      and h.document_status in ('issued','mail_draft_ready','sent')
      and (p_ignore_account is null or h.id<>p_ignore_account)
      and l.hourly_rate_snapshot is distinct from explicit_gefen_rate
    ) then source_reason := 'תעריף שונה מחשבון קודם — נדרשת בדיקת כספים'; end if;
    if source_reason='' and adjustment<>0 then source_reason:='הפרש לאחר חיוב מלא — נדרשת בדיקת כספים'; end if;
    if source_reason='' and billed>f.amount then source_reason := 'החיוב הקיים חורג מחלק המממן — נדרש בירור'; end if;
    select coalesce(jsonb_agg(s || jsonb_build_object('remainingAmount',remaining,'remainingHours',case when lower(btrim(coalesce(p_activity.activity_type,''))) in ('workshop','tour') then 0 else 1.5*remaining/nullif(coalesce(explicit_gefen_rate*1.5,gross_amount),0) end) order by (s->>'slot')::int),'[]') into unbilled
    from (
      select s,(case when explicit_gefen_rate is not null then round(least(f.amount,explicit_gefen_rate*1.5*ordinality),2)-round(least(f.amount,explicit_gefen_rate*1.5*(ordinality-1)),2) else round(f.amount*ordinality/nullif(planned,0),2)-round(f.amount*(ordinality-1)/nullif(planned,0),2) end) gross_amount,case when exists(select 1 from public.finance_billing_claims settled join public.finance_transaction_accounts settled_account on settled_account.id=settled.account_id
        where settled.activity_row_id=p_activity.row_id and settled.funding_source_id=f.funding_source_id and settled.meeting_slot=(s->>'slot')::int and settled.settles_meeting
        and (p_ignore_account is null or settled.account_id<>p_ignore_account) and settled_account.document_status<>'cancelled'
        and (settled_account.document_status<>'generating' or settled_account.created_at>p_now-interval '15 minutes')) then 0 else greatest(0,(case when explicit_gefen_rate is not null then round(least(f.amount,explicit_gefen_rate*1.5*ordinality),2)-round(least(f.amount,explicit_gefen_rate*1.5*(ordinality-1)),2) else round(f.amount*ordinality/nullif(planned,0),2)-round(f.amount*(ordinality-1)/nullif(planned,0),2) end)-coalesce((
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
      target := case when explicit_gefen_rate is not null then round(least(f.amount,explicit_gefen_rate*1.5*period_done),2) else round(f.amount*period_done/nullif(planned,0),2) end;
      if explicit_gefen_rate is null and finished and jsonb_array_length(scoped)=jsonb_array_length(unbilled) then amount := target-billed; end if;
      amount := greatest(0,least(amount,f.amount-billed,target-billed));
      result := result || jsonb_build_array(base || jsonb_build_object(
        'period',period,'completedCount',period_done,
        'eligibilityCutoff',case when course_monthly then least((period+interval '1 month - 1 day')::date,gefen_cutoff) else today end,
        'eligibilityStatus',case when course_monthly and period_done<3 then 'waiting_three_meetings' else null end,
        'fullFundingBlockedReason',case when course_monthly and (period_done<3 or period is null or period>date_trunc('month',gefen_cutoff)::date)
          then 'ממתין להשלמת שלושה מפגשים עד תאריך החתך' else base->>'fullFundingBlockedReason' end,
        'unbilledSlots',scoped,'unbilledCount',jsonb_array_length(scoped),'unbilledHours',case when lower(btrim(coalesce(p_activity.activity_type,''))) in ('tour','workshop') then 0 else (select coalesce(sum((s->>'remainingHours')::numeric),0) from jsonb_array_elements(scoped) s) end,
        'unbilledAmount',amount,'amount',amount,'hourlyRate',case when lower(btrim(coalesce(p_activity.activity_type,''))) in ('tour','workshop') then null else coalesce(explicit_gefen_rate,f.amount/nullif(planned*1.5,0)) end,
        'blockedReason',period_reason,'eligible',period_reason='' and amount>0 and jsonb_array_length(scoped)>0
          and (case when monthly then period<=date_trunc('month',gefen_cutoff)::date else finished end),
        'issuableAmount',case when period_reason='' and (case when monthly then period<=date_trunc('month',gefen_cutoff)::date else finished end) then amount else 0 end));
    end loop;
  end loop;
  return result;
end $function$;
CREATE OR REPLACE FUNCTION public.create_activity_from_proposal_item(p_proposal_item_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_item public.proposal_agreement_items%rowtype;
  v_proposal public.proposals_agreements%rowtype;
  v_proposal_group text;
  v_item_group text;
  v_status text;
  v_is_gefen boolean;
  v_required_count integer;
  v_created_count integer := 0;
  v_catalog_name text;
  v_catalog_type text;
  v_activity_type text;
  v_activity_family text;
  v_short_name text;
  v_sequence integer;
  v_row_id text;
  v_activity public.activities%rowtype;
  v_activities jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  if not (
    public.app_can_add_activity()
    or public.app_can_manage_proposals_agreements()
  ) then
    raise exception 'create_activity_from_proposal_forbidden' using errcode = '42501';
  end if;

  select *
  into v_item
  from public.proposal_agreement_items
  where id = p_proposal_item_id;

  if not found then
    raise exception 'proposal_item_not_found';
  end if;

  select *
  into v_proposal
  from public.proposals_agreements
  where id = v_item.proposal_agreement_id
    and archived_at is null;

  if not found then
    raise exception 'proposal_not_found_or_archived';
  end if;

  v_status := lower(trim(coalesce(v_proposal.status, '')));
  if v_status not in ('approved', 'sent', 'מאושר', 'מאושר וחתום', 'נשלח') then
    raise exception 'proposal_must_be_approved_or_sent';
  end if;

  v_proposal_group := lower(trim(coalesce(v_proposal.activity_type_group, '')));
  v_item_group := lower(trim(coalesce(v_item.proposal_group, '')));

  if not (
    v_proposal_group in ('next_year', 'gefen', 'combined')
    or trim(coalesce(v_proposal.activity_type_group, '')) in (
      'תשפ"ז', 'תשפ״ז', 'גפן', 'גפ"ן', 'גפ״ן',
      'שנת הלימודים תשפ"ז', 'שנת הלימודים תשפ״ז',
      'תוכניות תשפ"ז', 'תוכניות תשפ״ז'
    )
  ) then
    raise exception 'proposal_is_not_for_school_2027';
  end if;

  if v_item_group in ('summer', 'קיץ', 'קיץ תשפ"ו', 'קיץ תשפ״ו')
    or coalesce(v_item.item_name, '') ~* '(שעות[[:space:]]*)?בדיק(ה|ות)?'
  then
    raise exception 'proposal_item_is_not_a_2027_activity';
  end if;

  select
    nullif(trim(coalesce(l.activity_name, l.label_he, l.label, '')), ''),
    nullif(trim(coalesce(l.activity_type, l.type, l.parent_value, '')), '')
  into v_catalog_name, v_catalog_type
  from public.lists l
  where l.category = 'activity_names'
    and coalesce(l.is_active, l.active, true)
    and (
      (v_item.list_id is not null and l.list_id = v_item.list_id)
      or (trim(coalesce(v_item.activity_no, '')) <> '' and trim(coalesce(l.activity_no, '')) = trim(v_item.activity_no))
      or (trim(coalesce(v_item.gefen_number, '')) <> '' and trim(coalesce(l.gefen_number, '')) = trim(v_item.gefen_number))
      or (trim(coalesce(v_item.activity_no, '')) <> '' and trim(coalesce(l.value, '')) = trim(v_item.activity_no))
    )
  order by
    case when v_item.list_id is not null and l.list_id = v_item.list_id then 0 else 1 end,
    case when trim(coalesce(l.activity_no, '')) = trim(coalesce(v_item.activity_no, '')) then 0 else 1 end,
    l.sort_order nulls last,
    l.list_id
  limit 1;

  v_activity_type := lower(trim(coalesce(v_catalog_type, '')));
  if v_activity_type in ('course', 'program', 'תוכנית', 'תכנית', 'קורס')
    or lower(trim(coalesce(v_item.item_type, ''))) in ('course', 'program', 'תוכנית', 'תכנית', 'קורס')
  then
    v_activity_type := 'course';
    v_activity_family := 'program';
  elsif v_activity_type in ('workshop', 'סדנה')
    or lower(trim(coalesce(v_item.item_type, ''))) in ('workshop', 'סדנה')
  then
    v_activity_type := 'workshop';
    v_activity_family := 'workshop';
  elsif v_activity_type in ('tour', 'סיור')
    or lower(trim(coalesce(v_item.item_type, ''))) in ('tour', 'סיור')
  then
    v_activity_type := 'tour';
    v_activity_family := 'tour';
  else
    v_activity_type := 'course';
    v_activity_family := 'program';
  end if;

  v_short_name := coalesce(v_catalog_name, nullif(trim(v_item.item_name), ''), 'ללא שם פעילות');
  v_required_count := public.proposal_item_required_activity_count(v_item.quantity);
  v_is_gefen :=
    trim(coalesce(v_item.gefen_number, '')) <> ''
    or v_proposal_group = 'gefen'
    or trim(coalesce(v_proposal.activity_type_group, '')) in ('גפן', 'גפ"ן', 'גפ״ן');

  update public.activities a
  set activity_family = v_activity_family,
      activity_type = v_activity_type,
      item_type = v_activity_type,
      activity_name = v_short_name,
      program_name = null,
      name = null,
      title = null,
      class_group = coalesce(a.class_group, ''),
      price = case
        when v_activity_type = 'course' then a.price -- a repeated conversion must not overwrite the activity contract
        when v_item.unit_price is not null then round(v_item.unit_price)::bigint
        when v_item.total_price is not null then round(v_item.total_price / v_required_count)::bigint
        else a.price
      end,
      proposal_item_sequence = coalesce(a.proposal_item_sequence, 1),
      updated_at = now()
  where a.proposal_item_id = p_proposal_item_id;

  for v_sequence in 1..v_required_count loop
    if exists (
      select 1
      from public.activities a
      where a.proposal_item_id = p_proposal_item_id
        and a.proposal_item_sequence = v_sequence
    ) then
      continue;
    end if;

    v_row_id := 'PAI-' || p_proposal_item_id::text
      || case when v_sequence = 1 then '' else '-' || v_sequence::text end;

    insert into public.activities (
      row_id, activity_family, authority, school, class_group,
      activity_type, item_type, activity_no, activity_name,
      program_name, name, title, sessions, price, funding, status,
      gefen_number, activity_season, authority_id, school_id,
      contact_name, contact_phone, contact_email,
      proposal_agreement_id, proposal_item_id, proposal_item_sequence,
      is_gefen_funded, exists_in_gefen, gefen_order_number,
      created_at, updated_at
    ) values (
      v_row_id,
      v_activity_family,
      nullif(trim(coalesce(v_proposal.client_authority, '')), ''),
      nullif(trim(coalesce(v_proposal.school_framework, '')), ''),
      '',
      v_activity_type,
      v_activity_type,
      nullif(trim(coalesce(v_item.activity_no, v_item.gefen_number, '')), ''),
      v_short_name,
      null, null, null,
      case when v_item.meetings_count is null then null else v_item.meetings_count::text end,
      case
        when v_item.unit_price is not null then round(v_item.unit_price)::bigint
        when v_item.total_price is not null then round(v_item.total_price / v_required_count)::bigint
        else null
      end,
      case when v_is_gefen then 'גפן' else null end,
      'פתוח',
      nullif(trim(coalesce(v_item.gefen_number, '')), ''),
      'school_2027',
      v_proposal.authority_id,
      v_proposal.school_id,
      nullif(trim(coalesce(v_proposal.contact_name, '')), ''),
      coalesce(nullif(trim(coalesce(v_proposal.contact_phone, '')), ''), nullif(trim(coalesce(v_proposal.phone, '')), '')),
      coalesce(nullif(trim(coalesce(v_proposal.contact_email, '')), ''), nullif(trim(coalesce(v_proposal.email, '')), '')),
      v_proposal.id,
      v_item.id,
      v_sequence,
      v_is_gefen,
      false,
      null,
      now(),
      now()
    )
    on conflict (proposal_item_id, proposal_item_sequence)
      where proposal_item_id is not null
    do nothing
    returning * into v_activity;

    if found then
      v_created_count := v_created_count + 1;
    end if;
  end loop;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.proposal_item_sequence), '[]'::jsonb)
  into v_activities
  from public.activities a
  where a.proposal_item_id = p_proposal_item_id;

  return jsonb_build_object(
    'created', v_created_count > 0,
    'created_count', v_created_count,
    'required_count', v_required_count,
    'activities', v_activities,
    'activity', coalesce(v_activities -> 0, 'null'::jsonb)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_activity_from_proposal_item_with_language(p_proposal_item_id uuid, p_instruction_language text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_item public.proposal_agreement_items%rowtype;
  v_proposal public.proposals_agreements%rowtype;
  v_proposal_group text;
  v_item_group text;
  v_status text;
  v_is_gefen boolean;
  v_required_count integer;
  v_created_count integer := 0;
  v_catalog_name text;
  v_catalog_type text;
  v_activity_type text;
  v_activity_family text;
  v_short_name text;
  v_sequence integer;
  v_row_id text;
  v_activity public.activities%rowtype;
  v_activities jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  if p_instruction_language is null or p_instruction_language not in ('he', 'ar') then
    raise exception 'instruction_language_required' using errcode = '22023';
  end if;

  if not (
    public.app_can_add_activity()
    or public.app_can_manage_proposals_agreements()
  ) then
    raise exception 'create_activity_from_proposal_forbidden' using errcode = '42501';
  end if;

  select *
  into v_item
  from public.proposal_agreement_items
  where id = p_proposal_item_id;

  if not found then
    raise exception 'proposal_item_not_found';
  end if;

  select *
  into v_proposal
  from public.proposals_agreements
  where id = v_item.proposal_agreement_id
    and archived_at is null;

  if not found then
    raise exception 'proposal_not_found_or_archived';
  end if;

  v_status := lower(trim(coalesce(v_proposal.status, '')));
  if v_status not in ('approved', 'sent', 'מאושר', 'מאושר וחתום', 'נשלח') then
    raise exception 'proposal_must_be_approved_or_sent';
  end if;

  v_proposal_group := lower(trim(coalesce(v_proposal.activity_type_group, '')));
  v_item_group := lower(trim(coalesce(v_item.proposal_group, '')));

  if not (
    v_proposal_group in ('next_year', 'gefen', 'combined')
    or trim(coalesce(v_proposal.activity_type_group, '')) in (
      'תשפ"ז', 'תשפ״ז', 'גפן', 'גפ"ן', 'גפ״ן',
      'שנת הלימודים תשפ"ז', 'שנת הלימודים תשפ״ז',
      'תוכניות תשפ"ז', 'תוכניות תשפ״ז'
    )
  ) then
    raise exception 'proposal_is_not_for_school_2027';
  end if;

  if v_item_group in ('summer', 'קיץ', 'קיץ תשפ"ו', 'קיץ תשפ״ו')
    or coalesce(v_item.item_name, '') ~* '(שעות[[:space:]]*)?בדיק(ה|ות)?'
  then
    raise exception 'proposal_item_is_not_a_2027_activity';
  end if;

  select
    nullif(trim(coalesce(l.activity_name, l.label_he, l.label, '')), ''),
    nullif(trim(coalesce(l.activity_type, l.type, l.parent_value, '')), '')
  into v_catalog_name, v_catalog_type
  from public.lists l
  where l.category = 'activity_names'
    and coalesce(l.is_active, l.active, true)
    and (
      (v_item.list_id is not null and l.list_id = v_item.list_id)
      or (trim(coalesce(v_item.activity_no, '')) <> '' and trim(coalesce(l.activity_no, '')) = trim(v_item.activity_no))
      or (trim(coalesce(v_item.gefen_number, '')) <> '' and trim(coalesce(l.gefen_number, '')) = trim(v_item.gefen_number))
      or (trim(coalesce(v_item.activity_no, '')) <> '' and trim(coalesce(l.value, '')) = trim(v_item.activity_no))
    )
  order by
    case when v_item.list_id is not null and l.list_id = v_item.list_id then 0 else 1 end,
    case when trim(coalesce(l.activity_no, '')) = trim(coalesce(v_item.activity_no, '')) then 0 else 1 end,
    l.sort_order nulls last,
    l.list_id
  limit 1;

  v_activity_type := lower(trim(coalesce(v_catalog_type, '')));
  if v_activity_type in ('course', 'program', 'תוכנית', 'תכנית', 'קורס')
    or lower(trim(coalesce(v_item.item_type, ''))) in ('course', 'program', 'תוכנית', 'תכנית', 'קורס')
  then
    v_activity_type := 'course';
    v_activity_family := 'program';
  elsif v_activity_type in ('workshop', 'סדנה')
    or lower(trim(coalesce(v_item.item_type, ''))) in ('workshop', 'סדנה')
  then
    v_activity_type := 'workshop';
    v_activity_family := 'workshop';
  elsif v_activity_type in ('tour', 'סיור')
    or lower(trim(coalesce(v_item.item_type, ''))) in ('tour', 'סיור')
  then
    v_activity_type := 'tour';
    v_activity_family := 'tour';
  else
    v_activity_type := 'course';
    v_activity_family := 'program';
  end if;

  v_short_name := coalesce(v_catalog_name, nullif(trim(v_item.item_name), ''), 'ללא שם פעילות');
  v_required_count := public.proposal_item_required_activity_count(v_item.quantity);
  v_is_gefen :=
    trim(coalesce(v_item.gefen_number, '')) <> ''
    or v_proposal_group = 'gefen'
    or trim(coalesce(v_proposal.activity_type_group, '')) in ('גפן', 'גפ"ן', 'גפ״ן');

  update public.activities a
  set activity_family = v_activity_family,
      activity_type = v_activity_type,
      item_type = v_activity_type,
      activity_name = v_short_name,
      program_name = null,
      name = null,
      title = null,
      class_group = coalesce(a.class_group, ''),
      price = case
        when v_activity_type = 'course' then a.price -- a repeated conversion must not overwrite the activity contract
        when v_item.unit_price is not null then round(v_item.unit_price)::bigint
        when v_item.total_price is not null then round(v_item.total_price / v_required_count)::bigint
        else a.price
      end,
      proposal_item_sequence = coalesce(a.proposal_item_sequence, 1),
      updated_at = now()
  where a.proposal_item_id = p_proposal_item_id;

  for v_sequence in 1..v_required_count loop
    if exists (
      select 1
      from public.activities a
      where a.proposal_item_id = p_proposal_item_id
        and a.proposal_item_sequence = v_sequence
    ) then
      continue;
    end if;

    v_row_id := 'PAI-' || p_proposal_item_id::text
      || case when v_sequence = 1 then '' else '-' || v_sequence::text end;

    insert into public.activities (
      row_id, activity_family, authority, school, class_group,
      activity_type, item_type, activity_no, activity_name,
      program_name, name, title, sessions, price, funding, status,
      gefen_number, activity_season, instruction_language, authority_id, school_id,
      contact_name, contact_phone, contact_email,
      proposal_agreement_id, proposal_item_id, proposal_item_sequence,
      is_gefen_funded, exists_in_gefen, gefen_order_number,
      created_at, updated_at
    ) values (
      v_row_id,
      v_activity_family,
      nullif(trim(coalesce(v_proposal.client_authority, '')), ''),
      nullif(trim(coalesce(v_proposal.school_framework, '')), ''),
      '',
      v_activity_type,
      v_activity_type,
      nullif(trim(coalesce(v_item.activity_no, v_item.gefen_number, '')), ''),
      v_short_name,
      null, null, null,
      case when v_item.meetings_count is null then null else v_item.meetings_count::text end,
      case
        when v_item.unit_price is not null then round(v_item.unit_price)::bigint
        when v_item.total_price is not null then round(v_item.total_price / v_required_count)::bigint
        else null
      end,
      case when v_is_gefen then 'גפן' else null end,
      'פתוח',
      nullif(trim(coalesce(v_item.gefen_number, '')), ''),
      'school_2027',
      p_instruction_language,
      v_proposal.authority_id,
      v_proposal.school_id,
      nullif(trim(coalesce(v_proposal.contact_name, '')), ''),
      coalesce(nullif(trim(coalesce(v_proposal.contact_phone, '')), ''), nullif(trim(coalesce(v_proposal.phone, '')), '')),
      coalesce(nullif(trim(coalesce(v_proposal.contact_email, '')), ''), nullif(trim(coalesce(v_proposal.email, '')), '')),
      v_proposal.id,
      v_item.id,
      v_sequence,
      v_is_gefen,
      false,
      null,
      now(),
      now()
    )
    on conflict (proposal_item_id, proposal_item_sequence)
      where proposal_item_id is not null
    do nothing
    returning * into v_activity;

    if found then
      v_created_count := v_created_count + 1;
    end if;
  end loop;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.proposal_item_sequence), '[]'::jsonb)
  into v_activities
  from public.activities a
  where a.proposal_item_id = p_proposal_item_id;

  return jsonb_build_object(
    'created', v_created_count > 0,
    'created_count', v_created_count,
    'required_count', v_required_count,
    'activities', v_activities,
    'activity', coalesce(v_activities -> 0, 'null'::jsonb)
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.create_israa_manual_activity(p_activity jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_row public.activities%rowtype;
  v_row_id text;
  v_type text;
  v_name text;
  v_family text;
  v_school_id bigint;
  v_funding jsonb;
  v_date_text text;
  v_index integer;
begin
  if not public.app_can_manage_israa() then
    raise exception 'israa_management_forbidden' using errcode = '42501';
  end if;

  p_activity := coalesce(p_activity, '{}'::jsonb);
  v_type := public.normalize_israa_activity_type(p_activity->>'activity_type');
  v_name := nullif(btrim(coalesce(p_activity->>'activity_name', '')), '');

  if v_type is null then raise exception 'israa_manual_activity_type_required'; end if;
  if v_name is null then raise exception 'israa_manual_activity_name_required'; end if;
  if nullif(btrim(coalesce(p_activity->>'authority', '')), '') is null then
    raise exception 'israa_manual_activity_authority_required';
  end if;

  if coalesce(nullif(btrim(p_activity->>'instruction_language'), ''), '') not in ('he', 'ar') then
    raise exception 'israa_instruction_language_required';
  end if;

  v_family := case when v_type in ('course', 'after_school') then 'program' else 'one_day' end;
  v_row_id := 'ISR-MAN-' || replace(gen_random_uuid()::text, '-', '');
  v_school_id := nullif(btrim(coalesce(p_activity->>'school_id', '')), '')::bigint;

  insert into public.activities (
    row_id, activity_family, activity_manager, authority_id, school_id, authority, school,
    grade, class_group, activity_type, item_type, activity_no, gefen_number, activity_name,
    program_name, name, title, sessions, price, course_hourly_rate, funding, start_time, end_time,
    emp_id, instructor_name, emp_id_2, instructor_name_2, start_date, end_date,
    status, notes, participants_count, contact_name, contact_phone, contact_email,
    activity_season, activity_domain, israa_shared, instruction_language
  ) values (
    v_row_id,
    v_family,
    nullif(btrim(coalesce(p_activity->>'activity_manager', '')), ''),
    nullif(btrim(coalesce(p_activity->>'authority_id', '')), '')::bigint,
    v_school_id,
    nullif(btrim(coalesce(p_activity->>'authority', '')), ''),
    nullif(btrim(coalesce(p_activity->>'school', '')), ''),
    nullif(btrim(coalesce(p_activity->>'grade', '')), ''),
    nullif(btrim(coalesce(p_activity->>'class_group', '')), ''),
    v_type,
    v_type,
    nullif(btrim(coalesce(p_activity->>'activity_no', '')), ''),
    nullif(btrim(coalesce(p_activity->>'gefen_number', p_activity->>'activity_no', '')), ''),
    v_name,
    v_name,
    v_name,
    v_name,
    nullif(btrim(coalesce(p_activity->>'sessions', '')), ''),
    nullif(btrim(coalesce(p_activity->>'price', '')), '')::numeric::bigint,
    nullif(btrim(p_activity->>'course_hourly_rate'),'')::numeric,
    nullif(btrim(coalesce(p_activity->>'funding', '')), ''),
    nullif(btrim(coalesce(p_activity->>'start_time', '')), '')::time,
    nullif(btrim(coalesce(p_activity->>'end_time', '')), '')::time,
    nullif(btrim(coalesce(p_activity->>'emp_id', '')), '')::bigint,
    nullif(btrim(coalesce(p_activity->>'instructor_name', '')), ''),
    nullif(btrim(coalesce(p_activity->>'emp_id_2', '')), '')::bigint,
    nullif(btrim(coalesce(p_activity->>'instructor_name_2', '')), ''),
    nullif(btrim(coalesce(p_activity->>'start_date', '')), '')::date,
    nullif(btrim(coalesce(p_activity->>'end_date', '')), '')::date,
    coalesce(nullif(btrim(coalesce(p_activity->>'status', '')), ''), 'פתוח'),
    nullif(btrim(coalesce(p_activity->>'notes', '')), ''),
    nullif(btrim(coalesce(p_activity->>'participants_count', '')), '')::integer,
    nullif(btrim(coalesce(p_activity->>'contact_name', '')), ''),
    nullif(btrim(coalesce(p_activity->>'contact_phone', '')), ''),
    nullif(btrim(coalesce(p_activity->>'contact_email', '')), ''),
    'school_2027',
    'E',
    false,
    btrim(p_activity->>'instruction_language')
  ) returning * into v_row;

  for v_index in 1..35 loop
    v_date_text := coalesce(
      nullif(btrim(coalesce(p_activity->>('date_' || v_index), '')), ''),
      nullif(btrim(coalesce(p_activity->>('Date' || v_index), '')), '')
    );
    if v_date_text is not null then
      execute format('update public.activities set %I = $1::date where id = $2', 'date_' || v_index)
        using v_date_text, v_row.id;
    end if;
  end loop;

  if v_school_id is not null then
    insert into public.activity_schools(activity_id, school_id, relation_type)
    values (v_row.id, v_school_id, 'main')
    on conflict (activity_id, school_id) do nothing;
  end if;

  for v_funding in
    select value from jsonb_array_elements(coalesce(p_activity->'funding_sources', '[]'::jsonb)) value
  loop
    if nullif(btrim(coalesce(v_funding->>'funding_source_id', '')), '') is not null then
      insert into public.activity_funding_sources(activity_id, funding_source_id, amount)
      values (
        v_row.id,
        (v_funding->>'funding_source_id')::uuid,
        nullif(btrim(coalesce(v_funding->>'amount', '')), '')::numeric
      )
      on conflict (activity_id, funding_source_id)
      do update set amount = excluded.amount, updated_at = now();
    end if;
  end loop;

  update public.activities a
  set funding = sources.funding_names
  from (
    select afs.activity_id,
           string_agg(fs.name, ' + ' order by coalesce(fs.sort_order, 2147483647), fs.name) as funding_names
    from public.activity_funding_sources afs
    join public.funding_sources fs on fs.id = afs.funding_source_id
    where afs.activity_id = v_row.id
    group by afs.activity_id
  ) sources
  where a.id = sources.activity_id;

  select * into v_row from public.activities where id = v_row.id;
  return jsonb_build_object('row', to_jsonb(v_row));
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_israa_activity_draft(p_tracking_id uuid, p_proposal_item_id uuid, p_draft jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tracking public.israa_program_tracking%rowtype;
  v_source_item jsonb;
  v_item public.proposal_agreement_items%rowtype;
  v_proposal public.proposals_agreements%rowtype;
  v_draft jsonb;
  v_existing_draft jsonb;
  v_instructor_emp_id text;
  v_instructor_name text;
begin
  if not public.app_can_manage_israa() then
    raise exception 'israa_management_forbidden' using errcode = '42501';
  end if;

  select * into v_tracking
  from public.israa_program_tracking
  where id = p_tracking_id
  for update;
  if not found then raise exception 'israa_tracking_not_found'; end if;

  select value into v_source_item
  from jsonb_array_elements(coalesce(v_tracking.proposal_items, '[]'::jsonb)) value
  where value->>'proposal_item_id' = p_proposal_item_id::text
  limit 1;
  if v_source_item is null then raise exception 'proposal_item_not_in_israa_tracking'; end if;

  select * into v_item
  from public.proposal_agreement_items
  where id = p_proposal_item_id
    and proposal_agreement_id = v_tracking.proposal_agreement_id;
  if not found then raise exception 'proposal_item_not_in_israa_tracking'; end if;

  select * into v_proposal
  from public.proposals_agreements
  where id = v_tracking.proposal_agreement_id;

  select value into v_existing_draft
  from jsonb_array_elements(coalesce(v_tracking.selected_activity_drafts, '[]'::jsonb)) value
  where value->>'proposal_item_id' = p_proposal_item_id::text
  limit 1;

  p_draft := coalesce(v_existing_draft, '{}'::jsonb) || coalesce(p_draft, '{}'::jsonb);

  if nullif(btrim(p_draft->>'instruction_language'), '') is not null and btrim(p_draft->>'instruction_language') not in ('he', 'ar') then
    raise exception 'israa_instruction_language_required';
  end if;

  v_instructor_emp_id := nullif(btrim(p_draft->>'emp_id'), '');
  if v_instructor_emp_id is not null then
    select ci.full_name
      into v_instructor_name
    from public.contacts_instructors ci
    where ci.emp_id = v_instructor_emp_id::bigint
      and lower(btrim(coalesce(ci.active, ''))) = 'yes';
    if not found then
      raise exception 'israa_instructor_not_active_or_missing';
    end if;
  end if;

  v_draft := jsonb_strip_nulls(jsonb_build_object(
    'proposal_item_id', p_proposal_item_id,
    'program_name', coalesce(nullif(btrim(p_draft->>'program_name'), ''), nullif(btrim(v_source_item->>'program_name'), ''), nullif(btrim(v_item.item_name), '')),
    'gefen_number', coalesce(nullif(btrim(p_draft->>'gefen_number'), ''), nullif(btrim(v_item.gefen_number), ''), nullif(btrim(v_source_item->>'gefen_number'), '')),
    'quantity', greatest(1, coalesce(v_item.quantity::integer, nullif(v_source_item->>'quantity', '')::integer, 1)),
    'activity_type', public.normalize_israa_activity_type(coalesce(nullif(p_draft->>'activity_type', ''), nullif(v_item.item_type, ''), v_source_item->>'item_type')),
    'activity_name', coalesce(nullif(btrim(p_draft->>'activity_name'), ''), nullif(btrim(v_item.item_name), ''), nullif(btrim(v_source_item->>'program_name'), '')),
    'activity_no', coalesce(nullif(btrim(p_draft->>'activity_no'), ''), nullif(btrim(v_item.activity_no), '')),
    'course_hourly_rate', case when v_item.hourly_price>0 then v_item.hourly_price else null end,
    'course_hourly_rate_source', case when v_item.hourly_price>0 then 'proposal' else null end,
    'course_proposal_hours', v_item.hours_count,
    'price', coalesce(
      nullif(btrim(p_draft->>'price'), '')::numeric,
      v_item.unit_price,
      v_item.total_price / nullif(greatest(1, coalesce(v_item.quantity, nullif(v_source_item->>'quantity', '')::numeric, 1)), 0)
    ),
    'funding', coalesce(nullif(btrim(p_draft->>'funding'), ''), case when nullif(btrim(v_item.gefen_number), '') is not null then 'גפן' end),
    'activity_manager', nullif(btrim(p_draft->>'activity_manager'), ''),
    'contact_name', coalesce(nullif(btrim(p_draft->>'contact_name'), ''), nullif(btrim(v_tracking.contact_person), ''), nullif(btrim(v_proposal.contact_name), '')),
    'contact_phone', coalesce(nullif(btrim(p_draft->>'contact_phone'), ''), nullif(btrim(v_tracking.phone), ''), nullif(btrim(v_proposal.contact_phone), ''), nullif(btrim(v_proposal.phone), '')),
    'contact_email', coalesce(nullif(btrim(p_draft->>'contact_email'), ''), nullif(btrim(v_tracking.email), ''), nullif(btrim(v_proposal.contact_email), ''), nullif(btrim(v_proposal.email), '')),
    'grade', coalesce(nullif(btrim(p_draft->>'grade'), ''), nullif(btrim(v_tracking.grade), '')),
    'class_group', nullif(btrim(p_draft->>'class_group'), ''),
    'sessions', coalesce(nullif(btrim(p_draft->>'sessions'), ''), v_item.meetings_count::text, v_source_item->>'meetings_count'),
    'start_date', nullif(btrim(p_draft->>'start_date'), ''),
    'start_time', nullif(btrim(p_draft->>'start_time'), ''),
    'end_time', nullif(btrim(p_draft->>'end_time'), ''),
    'emp_id', v_instructor_emp_id,
    'instructor_name', v_instructor_name,
    'instruction_language', nullif(btrim(p_draft->>'instruction_language'), ''),
    'group_overrides', p_draft->'group_overrides',
    'notes', nullif(btrim(p_draft->>'notes'), '')
  ));

  update public.israa_program_tracking
  set selected_activity_drafts = coalesce((
        select jsonb_agg(value)
        from jsonb_array_elements(selected_activity_drafts) value
        where value->>'proposal_item_id' <> p_proposal_item_id::text
      ), '[]'::jsonb) || jsonb_build_array(v_draft),
      updated_at = now()
  where id = p_tracking_id;

  return v_draft;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_israa_activity_group_draft(p_tracking_id uuid, p_proposal_item_id uuid, p_group_number integer, p_draft jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tracking public.israa_program_tracking%rowtype;
  v_base_draft jsonb;
  v_quantity integer;
  v_group_overrides jsonb;
  v_existing_override jsonb;
  v_changes jsonb;
  v_override jsonb;
  v_updated_draft jsonb;
  v_emp_id text;
  v_instructor_name text;
begin
  if not public.app_can_manage_israa() then
    raise exception 'israa_management_forbidden' using errcode = '42501';
  end if;

  select * into v_tracking
  from public.israa_program_tracking
  where id = p_tracking_id
  for update;
  if not found then raise exception 'israa_tracking_not_found'; end if;

  select value into v_base_draft
  from jsonb_array_elements(coalesce(v_tracking.selected_activity_drafts, '[]'::jsonb)) value
  where value->>'proposal_item_id' = p_proposal_item_id::text
  limit 1;
  if v_base_draft is null then raise exception 'israa_activity_not_selected'; end if;

  v_quantity := greatest(1, coalesce(nullif(v_base_draft->>'quantity', '')::integer, 1));
  if p_group_number is null or p_group_number < 1 or p_group_number > v_quantity then
    raise exception 'israa_group_number_invalid';
  end if;

  if nullif(btrim(p_draft->>'instruction_language'), '') is not null and btrim(p_draft->>'instruction_language') not in ('he', 'ar') then
    raise exception 'israa_instruction_language_required';
  end if;

  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
    into v_changes
  from jsonb_each(coalesce(p_draft, '{}'::jsonb))
  where key = any(array[
    'activity_type','activity_name','activity_no','gefen_number','price','course_hourly_rate','funding',
    'activity_manager','contact_name','contact_phone','contact_email','grade',
    'class_group','sessions','start_date','end_date','start_time','end_time',
    'emp_id','notes','instruction_language'
  ]);

  v_group_overrides := case
    when jsonb_typeof(v_base_draft->'group_overrides') = 'object' then v_base_draft->'group_overrides'
    else '{}'::jsonb
  end;
  v_existing_override := coalesce(v_group_overrides->(p_group_number::text), '{}'::jsonb);
  v_override := v_existing_override || v_changes;

  if v_changes ? 'emp_id' then
    v_emp_id := nullif(btrim(v_override->>'emp_id'), '');
    if v_emp_id is not null then
      select ci.full_name
        into v_instructor_name
      from public.contacts_instructors ci
      where ci.emp_id = v_emp_id::bigint
        and lower(btrim(coalesce(ci.active, ''))) = 'yes';
      if not found then
        raise exception 'israa_instructor_not_active_or_missing';
      end if;
      v_override := jsonb_set(v_override, '{instructor_name}', to_jsonb(v_instructor_name), true);
    else
      v_override := jsonb_set(v_override, '{emp_id}', 'null'::jsonb, true);
      v_override := jsonb_set(v_override, '{instructor_name}', 'null'::jsonb, true);
    end if;
  end if;

  if nullif(btrim(v_override->>'class_group'), '') is null then
    v_override := jsonb_set(v_override, '{class_group}', to_jsonb('קבוצה ' || p_group_number), true);
  end if;

  v_group_overrides := jsonb_set(v_group_overrides, array[p_group_number::text], v_override, true);
  v_updated_draft := jsonb_set(v_base_draft, '{group_overrides}', v_group_overrides, true);

  update public.israa_program_tracking
  set selected_activity_drafts = coalesce((
        select jsonb_agg(
          case
            when value->>'proposal_item_id' = p_proposal_item_id::text then v_updated_draft
            else value
          end
        )
        from jsonb_array_elements(coalesce(selected_activity_drafts, '[]'::jsonb)) value
      ), '[]'::jsonb),
      updated_at = now()
  where id = p_tracking_id;

  return v_updated_draft;
end;
$function$;

CREATE OR REPLACE FUNCTION public.share_israa_activity(p_tracking_id uuid, p_proposal_item_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tracking public.israa_program_tracking%rowtype;
  v_base_draft jsonb;
  v_group_override jsonb;
  v_draft jsonb;
  v_item public.proposal_agreement_items%rowtype;
  v_proposal public.proposals_agreements%rowtype;
  v_quantity integer;
  v_activity_type text;
  v_group integer;
  v_row public.activities%rowtype;
  v_rows jsonb := '[]'::jsonb;
  v_row_id text;
  v_draft_emp_id text;
  v_draft_instructor_name text;
begin
  if not public.app_can_manage_israa() then
    raise exception 'israa_management_forbidden' using errcode = '42501';
  end if;

  select * into v_tracking
  from public.israa_program_tracking
  where id = p_tracking_id
  for update;
  if not found then raise exception 'israa_tracking_not_found'; end if;

  select value into v_base_draft
  from jsonb_array_elements(v_tracking.selected_activity_drafts) value
  where value->>'proposal_item_id' = p_proposal_item_id::text
  limit 1;
  if v_base_draft is null then raise exception 'israa_activity_not_selected'; end if;

  if not exists (
    select 1
    from jsonb_array_elements(coalesce(v_tracking.proposal_items, '[]'::jsonb)) source_item
    where source_item->>'proposal_item_id' = p_proposal_item_id::text
  ) then
    raise exception 'proposal_item_not_in_israa_tracking';
  end if;

  select * into v_item
  from public.proposal_agreement_items
  where id = p_proposal_item_id;
  if found and v_item.proposal_agreement_id <> v_tracking.proposal_agreement_id then
    raise exception 'proposal_item_not_in_israa_tracking';
  end if;

  select * into v_proposal
  from public.proposals_agreements
  where id = v_tracking.proposal_agreement_id;

  v_quantity := greatest(1, coalesce((v_base_draft->>'quantity')::integer, v_item.quantity::integer, 1));

  for v_group in 1..v_quantity loop
    v_group_override := coalesce(v_base_draft->'group_overrides'->(v_group::text), '{}'::jsonb);
    v_draft := (v_base_draft - 'group_overrides') || v_group_override;

    if coalesce(nullif(btrim(v_draft->>'instruction_language'), ''), '') not in ('he', 'ar') then
      raise exception 'israa_instruction_language_required';
    end if;


    v_activity_type := public.normalize_israa_activity_type(coalesce(v_draft->>'activity_type', v_item.item_type));
    if v_activity_type is not null then
      v_draft := jsonb_set(v_draft, '{activity_type}', to_jsonb(v_activity_type), true);
    end if;

    v_draft_emp_id := nullif(btrim(v_draft->>'emp_id'), '');
    v_draft_instructor_name := null;
    if v_draft_emp_id is not null then
      select ci.full_name
        into v_draft_instructor_name
      from public.contacts_instructors ci
      where ci.emp_id = v_draft_emp_id::bigint
        and lower(btrim(coalesce(ci.active, ''))) = 'yes';
      if not found then
        raise exception 'israa_instructor_not_active_or_missing';
      end if;
    end if;

    v_row_id := 'ISR-' || replace(p_tracking_id::text, '-', '') || '-' || replace(p_proposal_item_id::text, '-', '') || '-' || v_group;

    insert into public.activities (
      row_id, activity_family, authority, authority_id, school, school_id, grade, class_group,
      activity_type, item_type, activity_no, gefen_number, activity_name, program_name, name, title,
      sessions, price, course_hourly_rate, funding, contact_name, contact_phone, contact_email, start_date, date_1,
      start_time, end_time, notes, status, activity_season, activity_domain, proposal_agreement_id,
      draft_emp_id, draft_instructor_name, draft_created_at, draft_created_by,
      israa_tracking_id, israa_source_item_id, israa_group_number, instruction_language
    ) values (
      v_row_id,
      case when v_activity_type in ('course','after_school') then 'program' when v_activity_type is not null then 'one_day' end,
      v_tracking.authority,
      v_tracking.authority_id,
      v_tracking.school_name,
      v_tracking.school_id,
      v_draft->>'grade',
      coalesce(nullif(v_draft->>'class_group',''), 'קבוצה ' || v_group),
      v_activity_type,
      v_activity_type,
      coalesce(nullif(v_draft->>'activity_no',''), nullif(v_item.activity_no,'')),
      coalesce(nullif(v_draft->>'gefen_number',''), nullif(v_item.gefen_number,'')),
      coalesce(nullif(v_draft->>'activity_name',''), nullif(v_draft->>'program_name',''), nullif(v_item.item_name,'')),
      coalesce(nullif(v_draft->>'activity_name',''), nullif(v_draft->>'program_name',''), nullif(v_item.item_name,'')),
      coalesce(nullif(v_draft->>'activity_name',''), nullif(v_draft->>'program_name',''), nullif(v_item.item_name,'')),
      coalesce(nullif(v_draft->>'activity_name',''), nullif(v_draft->>'program_name',''), nullif(v_item.item_name,'')),
      coalesce(nullif(v_draft->>'sessions',''), v_item.meetings_count::text),
      coalesce(
        nullif(v_draft->>'price','')::numeric::bigint,
        round(coalesce(v_item.unit_price, v_item.total_price / nullif(greatest(1, coalesce(v_item.quantity, 1)), 0)))::bigint
      ),
    nullif(v_draft->>'course_hourly_rate','')::numeric,
      coalesce(nullif(v_draft->>'funding',''), case when nullif(btrim(v_item.gefen_number),'') is not null then 'גפן' end),
      coalesce(nullif(v_draft->>'contact_name',''), nullif(v_tracking.contact_person,''), nullif(v_proposal.contact_name,'')),
      coalesce(nullif(v_draft->>'contact_phone',''), nullif(v_tracking.phone,''), nullif(v_proposal.contact_phone,''), nullif(v_proposal.phone,'')),
      coalesce(nullif(v_draft->>'contact_email',''), nullif(v_tracking.email,''), nullif(v_proposal.contact_email,''), nullif(v_proposal.email,'')),
      nullif(v_draft->>'start_date','')::date,
      nullif(v_draft->>'start_date','')::date,
      nullif(v_draft->>'start_time','')::time,
      nullif(v_draft->>'end_time','')::time,
      v_draft->>'notes',
      'פתוח',
      'school_2027',
      'E',
      v_tracking.proposal_agreement_id,
      v_draft_emp_id,
      v_draft_instructor_name,
      case when v_draft_emp_id is not null then now() else null end,
      case when v_draft_emp_id is not null then auth.uid() else null end,
      p_tracking_id,
      p_proposal_item_id,
      v_group,
      btrim(v_draft->>'instruction_language')
    )
    on conflict (israa_tracking_id, israa_source_item_id, israa_group_number)
      where israa_tracking_id is not null
    do update set
      draft_emp_id = case
        when public.activities.emp_id is null then excluded.draft_emp_id
        else public.activities.draft_emp_id
      end,
      draft_instructor_name = case
        when public.activities.emp_id is null then excluded.draft_instructor_name
        else public.activities.draft_instructor_name
      end,
      draft_created_at = case
        when public.activities.emp_id is null
          and public.activities.draft_emp_id is distinct from excluded.draft_emp_id
          then excluded.draft_created_at
        else public.activities.draft_created_at
      end,
      draft_created_by = case
        when public.activities.emp_id is null
          and public.activities.draft_emp_id is distinct from excluded.draft_emp_id
          then excluded.draft_created_by
        else public.activities.draft_created_by
      end,
      updated_at = public.activities.updated_at
    returning * into v_row;

    v_rows := v_rows || jsonb_build_array(to_jsonb(v_row));
  end loop;

  return jsonb_build_object('activities', v_rows, 'created_count', v_quantity);
end;
$function$;

CREATE OR REPLACE FUNCTION public.share_israa_activity_group(p_tracking_id uuid, p_proposal_item_id uuid, p_group_number integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tracking public.israa_program_tracking%rowtype;
  v_base_draft jsonb;
  v_group_override jsonb;
  v_draft jsonb;
  v_item public.proposal_agreement_items%rowtype;
  v_proposal public.proposals_agreements%rowtype;
  v_quantity integer;
  v_activity_type text;
  v_row public.activities%rowtype;
  v_row_id text;
  v_draft_emp_id text;
  v_draft_instructor_name text;
begin
  if not public.app_can_manage_israa() then
    raise exception 'israa_management_forbidden' using errcode = '42501';
  end if;

  select * into v_tracking
  from public.israa_program_tracking
  where id = p_tracking_id
  for update;
  if not found then raise exception 'israa_tracking_not_found'; end if;

  select value into v_base_draft
  from jsonb_array_elements(coalesce(v_tracking.selected_activity_drafts, '[]'::jsonb)) value
  where value->>'proposal_item_id' = p_proposal_item_id::text
  limit 1;
  if v_base_draft is null then raise exception 'israa_activity_not_selected'; end if;

  if not exists (
    select 1
    from jsonb_array_elements(coalesce(v_tracking.proposal_items, '[]'::jsonb)) source_item
    where source_item->>'proposal_item_id' = p_proposal_item_id::text
  ) then
    raise exception 'proposal_item_not_in_israa_tracking';
  end if;

  select * into v_item
  from public.proposal_agreement_items
  where id = p_proposal_item_id;
  if found and v_item.proposal_agreement_id <> v_tracking.proposal_agreement_id then
    raise exception 'proposal_item_not_in_israa_tracking';
  end if;

  select * into v_proposal
  from public.proposals_agreements
  where id = v_tracking.proposal_agreement_id;

  v_quantity := greatest(1, coalesce((v_base_draft->>'quantity')::integer, v_item.quantity::integer, 1));
  if p_group_number is null or p_group_number < 1 or p_group_number > v_quantity then
    raise exception 'israa_group_number_invalid';
  end if;

  v_group_override := coalesce(v_base_draft->'group_overrides'->(p_group_number::text), '{}'::jsonb);
  v_draft := (v_base_draft - 'group_overrides') || v_group_override;

  if coalesce(nullif(btrim(v_draft->>'instruction_language'), ''), '') not in ('he', 'ar') then
    raise exception 'israa_instruction_language_required';
  end if;


  v_activity_type := public.normalize_israa_activity_type(coalesce(v_draft->>'activity_type', v_item.item_type));
  if v_activity_type is not null then
    v_draft := jsonb_set(v_draft, '{activity_type}', to_jsonb(v_activity_type), true);
  end if;

  v_draft_emp_id := nullif(btrim(v_draft->>'emp_id'), '');
  if v_draft_emp_id is not null then
    select ci.full_name
      into v_draft_instructor_name
    from public.contacts_instructors ci
    where ci.emp_id = v_draft_emp_id::bigint
      and lower(btrim(coalesce(ci.active, ''))) = 'yes';
    if not found then
      raise exception 'israa_instructor_not_active_or_missing';
    end if;
  end if;

  v_row_id := 'ISR-' || replace(p_tracking_id::text, '-', '') || '-' || replace(p_proposal_item_id::text, '-', '') || '-' || p_group_number;

  insert into public.activities (
    row_id, activity_family, authority, authority_id, school, school_id, grade, class_group,
    activity_type, item_type, activity_no, gefen_number, activity_name, program_name, name, title,
    sessions, price, course_hourly_rate, funding, contact_name, contact_phone, contact_email, start_date, date_1,
    start_time, end_time, notes, status, activity_season, activity_domain, proposal_agreement_id,
    draft_emp_id, draft_instructor_name, draft_created_at, draft_created_by,
    israa_tracking_id, israa_source_item_id, israa_group_number, instruction_language
  ) values (
    v_row_id,
    case when v_activity_type in ('course','after_school') then 'program' when v_activity_type is not null then 'one_day' end,
    v_tracking.authority,
    v_tracking.authority_id,
    v_tracking.school_name,
    v_tracking.school_id,
    v_draft->>'grade',
    coalesce(nullif(v_draft->>'class_group',''), 'קבוצה ' || p_group_number),
    v_activity_type,
    v_activity_type,
    coalesce(nullif(v_draft->>'activity_no',''), nullif(v_item.activity_no,'')),
    coalesce(nullif(v_draft->>'gefen_number',''), nullif(v_item.gefen_number,'')),
    coalesce(nullif(v_draft->>'activity_name',''), nullif(v_draft->>'program_name',''), nullif(v_item.item_name,'')),
    coalesce(nullif(v_draft->>'activity_name',''), nullif(v_draft->>'program_name',''), nullif(v_item.item_name,'')),
    coalesce(nullif(v_draft->>'activity_name',''), nullif(v_draft->>'program_name',''), nullif(v_item.item_name,'')),
    coalesce(nullif(v_draft->>'activity_name',''), nullif(v_draft->>'program_name',''), nullif(v_item.item_name,'')),
    coalesce(nullif(v_draft->>'sessions',''), v_item.meetings_count::text),
    coalesce(
      nullif(v_draft->>'price','')::numeric::bigint,
      round(coalesce(v_item.unit_price, v_item.total_price / nullif(greatest(1, coalesce(v_item.quantity, 1)), 0)))::bigint
    ),
    nullif(v_draft->>'course_hourly_rate','')::numeric,
    coalesce(nullif(v_draft->>'funding',''), case when nullif(btrim(v_item.gefen_number),'') is not null then 'גפן' end),
    coalesce(nullif(v_draft->>'contact_name',''), nullif(v_tracking.contact_person,''), nullif(v_proposal.contact_name,'')),
    coalesce(nullif(v_draft->>'contact_phone',''), nullif(v_tracking.phone,''), nullif(v_proposal.contact_phone,''), nullif(v_proposal.phone,'')),
    coalesce(nullif(v_draft->>'contact_email',''), nullif(v_tracking.email,''), nullif(v_proposal.contact_email,''), nullif(v_proposal.email,'')),
    nullif(v_draft->>'start_date','')::date,
    nullif(v_draft->>'start_date','')::date,
    nullif(v_draft->>'start_time','')::time,
    nullif(v_draft->>'end_time','')::time,
    v_draft->>'notes',
    'פתוח',
    'school_2027',
    'E',
    v_tracking.proposal_agreement_id,
    v_draft_emp_id,
    v_draft_instructor_name,
    case when v_draft_emp_id is not null then now() else null end,
    case when v_draft_emp_id is not null then auth.uid() else null end,
    p_tracking_id,
    p_proposal_item_id,
    p_group_number,
    btrim(v_draft->>'instruction_language')
  )
  on conflict (israa_tracking_id, israa_source_item_id, israa_group_number)
    where israa_tracking_id is not null
  do update set
    draft_emp_id = case
      when public.activities.emp_id is null then excluded.draft_emp_id
      else public.activities.draft_emp_id
    end,
    draft_instructor_name = case
      when public.activities.emp_id is null then excluded.draft_instructor_name
      else public.activities.draft_instructor_name
    end,
    draft_created_at = case
      when public.activities.emp_id is null
        and public.activities.draft_emp_id is distinct from excluded.draft_emp_id
        then excluded.draft_created_at
      else public.activities.draft_created_at
    end,
    draft_created_by = case
      when public.activities.emp_id is null
        and public.activities.draft_emp_id is distinct from excluded.draft_emp_id
        then excluded.draft_created_by
      else public.activities.draft_created_by
    end,
    updated_at = public.activities.updated_at
  returning * into v_row;

  return jsonb_build_object(
    'activity', to_jsonb(v_row),
    'created_count', 1,
    'group_number', p_group_number
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_israa_manual_activity(p_row_id text, p_changes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_row public.activities%rowtype;
  v_type text;
begin
  if not public.app_can_manage_israa() then
    raise exception 'israa_management_forbidden' using errcode = '42501';
  end if;

  select * into v_row
  from public.activities
  where row_id = p_row_id
    and activity_domain = 'E'
    and israa_tracking_id is null
    and israa_source_item_id is null
    and proposal_agreement_id is null
    and proposal_item_id is null
  for update;

  if not found then
    raise exception 'israa_manual_activity_edit_forbidden' using errcode = '42501';
  end if;

  p_changes := coalesce(p_changes, '{}'::jsonb);
  if nullif(btrim(p_changes->>'instruction_language'), '') is not null and btrim(p_changes->>'instruction_language') not in ('he', 'ar') then
    raise exception 'israa_instruction_language_required';
  end if;

  v_type := case when p_changes ? 'activity_type'
    then public.normalize_israa_activity_type(p_changes->>'activity_type')
    else v_row.activity_type
  end;

  update public.activities set
    instruction_language = case when p_changes ? 'instruction_language' then nullif(btrim(p_changes->>'instruction_language'),'') else instruction_language end,
    activity_manager = case when p_changes ? 'activity_manager' then nullif(btrim(p_changes->>'activity_manager'),'') else activity_manager end,
    authority = case when p_changes ? 'authority' then nullif(btrim(p_changes->>'authority'),'') else authority end,
    authority_id = case when p_changes ? 'authority_id' then nullif(btrim(p_changes->>'authority_id'),'')::bigint else authority_id end,
    school = case when p_changes ? 'school' then nullif(btrim(p_changes->>'school'),'') else school end,
    school_id = case when p_changes ? 'school_id' then nullif(btrim(p_changes->>'school_id'),'')::bigint else school_id end,
    activity_type = v_type,
    item_type = v_type,
    activity_family = case when v_type in ('course','after_school') then 'program' else 'one_day' end,
    activity_no = case when p_changes ? 'activity_no' then nullif(btrim(p_changes->>'activity_no'),'') else activity_no end,
    gefen_number = case when p_changes ? 'gefen_number' then nullif(btrim(p_changes->>'gefen_number'),'') else gefen_number end,
    activity_name = case when p_changes ? 'activity_name' then nullif(btrim(p_changes->>'activity_name'),'') else activity_name end,
    program_name = case when p_changes ? 'activity_name' then nullif(btrim(p_changes->>'activity_name'),'') else program_name end,
    name = case when p_changes ? 'activity_name' then nullif(btrim(p_changes->>'activity_name'),'') else name end,
    title = case when p_changes ? 'activity_name' then nullif(btrim(p_changes->>'activity_name'),'') else title end,
    sessions = case when p_changes ? 'sessions' then nullif(btrim(p_changes->>'sessions'),'') else sessions end,
    price = case when p_changes ? 'price' then nullif(btrim(p_changes->>'price'),'')::numeric::bigint else price end,
    course_hourly_rate = case when p_changes ? 'course_hourly_rate' then nullif(btrim(p_changes->>'course_hourly_rate'),'')::numeric else course_hourly_rate end,
    funding = case when p_changes ? 'funding' then nullif(btrim(p_changes->>'funding'),'') else funding end,
    emp_id = case when p_changes ? 'emp_id' then nullif(btrim(p_changes->>'emp_id'),'')::bigint else emp_id end,
    instructor_name = case when p_changes ? 'instructor_name' then nullif(btrim(p_changes->>'instructor_name'),'') else instructor_name end,
    emp_id_2 = case when p_changes ? 'emp_id_2' then nullif(btrim(p_changes->>'emp_id_2'),'') else emp_id_2 end,
    instructor_name_2 = case when p_changes ? 'instructor_name_2' then nullif(btrim(p_changes->>'instructor_name_2'),'') else instructor_name_2 end,
    grade = case when p_changes ? 'grade' then nullif(btrim(p_changes->>'grade'),'') else grade end,
    class_group = case when p_changes ? 'class_group' then nullif(btrim(p_changes->>'class_group'),'') else class_group end,
    start_date = case when p_changes ? 'start_date' then nullif(btrim(p_changes->>'start_date'),'')::date else start_date end,
    date_1 = case when p_changes ? 'start_date' then nullif(btrim(p_changes->>'start_date'),'')::date else date_1 end,
    end_date = case when p_changes ? 'end_date' then nullif(btrim(p_changes->>'end_date'),'')::date else end_date end,
    start_time = case when p_changes ? 'start_time' then nullif(btrim(p_changes->>'start_time'),'')::time else start_time end,
    end_time = case when p_changes ? 'end_time' then nullif(btrim(p_changes->>'end_time'),'')::time else end_time end,
    notes = case when p_changes ? 'notes' then nullif(btrim(p_changes->>'notes'),'') else notes end,
    status = case when p_changes ? 'status' then coalesce(nullif(btrim(p_changes->>'status'),''), status) else status end,
    participants_count = case when p_changes ? 'participants_count' then nullif(btrim(p_changes->>'participants_count'),'')::integer else participants_count end,
    updated_at = now()
  where row_id = p_row_id
  returning * into v_row;

  return jsonb_build_object('row', to_jsonb(v_row));
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_israa_shared_activity(p_row_id text, p_changes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_row public.activities%rowtype;
begin
  if not public.app_can_manage_israa() then
    raise exception 'israa_management_forbidden' using errcode = '42501';
  end if;
  select * into v_row from public.activities
  where row_id = p_row_id and activity_domain = 'E' and israa_tracking_id is not null for update;
  if not found then raise exception 'israa_activity_edit_forbidden' using errcode = '42501'; end if;
  update public.activities set
    activity_manager = case when p_changes ? 'activity_manager' then nullif(btrim(p_changes->>'activity_manager'),'') else activity_manager end,
    activity_type = case when p_changes ? 'activity_type' then nullif(btrim(p_changes->>'activity_type'),'') else activity_type end,
    item_type = case when p_changes ? 'activity_type' then nullif(btrim(p_changes->>'activity_type'),'') else item_type end,
    activity_no = case when p_changes ? 'activity_no' then nullif(btrim(p_changes->>'activity_no'),'') else activity_no end,
    gefen_number = case when p_changes ? 'gefen_number' then nullif(btrim(p_changes->>'gefen_number'),'') else gefen_number end,
    activity_name = case when p_changes ? 'activity_name' then nullif(btrim(p_changes->>'activity_name'),'') else activity_name end,
    sessions = case when p_changes ? 'sessions' then nullif(btrim(p_changes->>'sessions'),'') else sessions end,
    price = case when p_changes ? 'price' then nullif(btrim(p_changes->>'price'),'')::numeric::bigint else price end,
    course_hourly_rate = case when p_changes ? 'course_hourly_rate' then nullif(btrim(p_changes->>'course_hourly_rate'),'')::numeric else course_hourly_rate end,
    funding = case when p_changes ? 'funding' then nullif(btrim(p_changes->>'funding'),'') else funding end,
    contact_name = case when p_changes ? 'contact_name' then nullif(btrim(p_changes->>'contact_name'),'') else contact_name end,
    contact_phone = case when p_changes ? 'contact_phone' then nullif(btrim(p_changes->>'contact_phone'),'') else contact_phone end,
    contact_email = case when p_changes ? 'contact_email' then nullif(btrim(p_changes->>'contact_email'),'') else contact_email end,
    emp_id = case when p_changes ? 'emp_id' then nullif(btrim(p_changes->>'emp_id'),'')::bigint else emp_id end,
    instructor_name = case when p_changes ? 'instructor_name' then nullif(btrim(p_changes->>'instructor_name'),'') else instructor_name end,
    emp_id_2 = case when p_changes ? 'emp_id_2' then nullif(btrim(p_changes->>'emp_id_2'),'')::bigint else emp_id_2 end,
    instructor_name_2 = case when p_changes ? 'instructor_name_2' then nullif(btrim(p_changes->>'instructor_name_2'),'') else instructor_name_2 end,
    grade = case when p_changes ? 'grade' then nullif(btrim(p_changes->>'grade'),'') else grade end,
    class_group = case when p_changes ? 'class_group' then nullif(btrim(p_changes->>'class_group'),'') else class_group end,
    start_date = case when p_changes ? 'start_date' then nullif(btrim(p_changes->>'start_date'),'')::date else start_date end,
    date_1 = case when p_changes ? 'start_date' then nullif(btrim(p_changes->>'start_date'),'')::date else date_1 end,
    end_date = case when p_changes ? 'end_date' then nullif(btrim(p_changes->>'end_date'),'')::date else end_date end,
    start_time = case when p_changes ? 'start_time' then nullif(btrim(p_changes->>'start_time'),'')::time else start_time end,
    end_time = case when p_changes ? 'end_time' then nullif(btrim(p_changes->>'end_time'),'')::time else end_time end,
    notes = case when p_changes ? 'notes' then nullif(btrim(p_changes->>'notes'),'') else notes end,
    updated_at = now()
  where row_id = p_row_id returning * into v_row;
  return to_jsonb(v_row);
end;
$function$;
commit;
