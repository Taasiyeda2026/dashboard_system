begin;
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
    if new.course_hourly_rate_source='finance_contract' and current_user='postgres' then
      new.course_proposal_hours := null;
    elsif new.course_hourly_rate is distinct from old.course_hourly_rate
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

alter table public.activities drop constraint activities_course_hourly_rate_valid;
alter table public.activities add constraint activities_course_hourly_rate_valid check (
  course_hourly_rate is null or (
    activity_type='course' and course_hourly_rate>0 and course_hourly_rate<=1000000
    and (coalesce(course_hourly_rate_source,'') in ('proposal','finance_contract') or case when btrim(coalesce(sessions,'')) ~ '^[1-9][0-9]?$'
      then btrim(sessions)::integer between 1 and 35 and price is not null and price=round(course_hourly_rate*btrim(sessions)::integer*1.5,6)
      else false end)
  )
) not valid;
alter table public.activities validate constraint activities_course_hourly_rate_valid;

create or replace function public.finance_billing_completion_context(p_activity_id text)
returns jsonb language plpgsql stable security definer set search_path='' as $completion$
declare a public.activities%rowtype; q public.proposal_agreement_items%rowtype; order_rate numeric; fs jsonb; alloc jsonb; school_symbol bigint; prior boolean;
begin
  if auth.uid() is null or not coalesce(public.app_current_role()='admin' or public.app_has_permission('manage_finance_transactions'),false)
    then raise exception 'finance_permission_denied' using errcode='42501'; end if;
  select * into a from public.activities where row_id=p_activity_id and activity_season='school_2027';
  if not found then raise exception 'activity_not_found'; end if;
  select * into q from public.proposal_agreement_items where id=coalesce(a.proposal_item_id,a.israa_source_item_id);
  select m.order_hourly_rate into order_rate from finance_private.gefen_order_billing_matches m where m.activity_row_id=a.row_id limit 1;
  select s.semel_mosad into school_symbol from public.schools s where s.id=a.school_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',f.name) order by f.sort_order nulls last,f.name),'[]') into fs from public.funding_sources f where f.is_active or exists(select 1 from public.activity_funding_sources af where af.activity_id=a.id and af.funding_source_id=f.id);
  select coalesce(jsonb_agg(jsonb_build_object('id',f.funding_source_id,'amount',f.amount,'name',f.name)) filter(where f.funding_source_id is not null),'[]') into alloc from finance_private.resolved_funding_rows(a) f;
  select exists(select 1 from public.finance_transaction_account_lines l join public.finance_transaction_accounts h on h.id=l.account_id where l.activity_row_id=a.row_id and h.document_status<>'cancelled') into prior;
  return jsonb_build_object('row_id',a.row_id,'name',a.activity_name,'school',a.school,'school_symbol',school_symbol,'activity_type',a.activity_type,'activity_no',a.activity_no,'gefen_number',a.gefen_number,'program_name',a.program_name,'catalog_slug',a.catalog_slug,'sessions',a.sessions,'price',a.price,'rate',a.course_hourly_rate,'proposal_rate',q.hourly_price,'order_rate',order_rate,'proposal_hours',q.hours_count,'funding',a.funding,'funding_options',fs,'allocations',alloc,'has_prior',prior,'updated_at',a.updated_at,'start_time',a.start_time,'end_time',a.end_time,'contact_email',a.contact_email,'dates',(select jsonb_object_agg('date_'||n,to_jsonb(a)->('date_'||n)) from generate_series(1,35) n));
end;
$completion$;

create or replace function public.finance_complete_billing_data(p_activity_id text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $completion$
declare a public.activities%rowtype; school_row public.schools%rowtype; price_value bigint; rate_value numeric; n int; funding_total numeric; funding_text text; fund_count int; known_count int; has_gefen boolean; has_prior boolean; school_symbol bigint; program_code text; email text; before_funding jsonb; after_funding jsonb;
begin
  if auth.uid() is null or not coalesce(public.app_current_role()='admin' or public.app_has_permission('manage_finance_transactions'),false)
    then raise exception 'finance_permission_denied' using errcode='42501'; end if;
  if jsonb_typeof(p_data) is distinct from 'object' or jsonb_typeof(p_data->'allocations') is distinct from 'array' then raise exception 'invalid_completion_payload'; end if;
  select * into a from public.activities where row_id=p_activity_id and activity_season='school_2027' for update;
  if not found then raise exception 'activity_not_found'; end if;
  if a.updated_at is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'הפעילות השתנתה — יש לרענן ולנסות שוב'; end if;
  if exists(select 1 from public.finance_transaction_account_lines l join public.finance_transaction_accounts h on h.id=l.account_id where l.activity_row_id=a.row_id and h.document_status='generating') then raise exception 'הפקה בתהליך — אין לשנות נתונים'; end if;
  select exists(select 1 from public.finance_transaction_account_lines l join public.finance_transaction_accounts h on h.id=l.account_id where l.activity_row_id=a.row_id and h.document_status<>'cancelled') into has_prior;
  if (p_data->>'price') !~ '^[0-9]+$' or coalesce((p_data->>'price')::numeric,0)<=0 or (p_data->>'price')::numeric>1000000000 then raise exception 'יש להזין מחיר כולל חיובי בשקלים שלמים'; end if;
  price_value := (p_data->>'price')::bigint;
  if a.activity_type='course' then
    if coalesce(p_data->>'sessions','') !~ '^[1-9][0-9]?$' then raise exception 'יש להזין מספר מפגשים תקין'; end if;
    n := (p_data->>'sessions')::int;
    rate_value := nullif(p_data->>'rate','')::numeric;
    if n not between 1 and 35 or rate_value is null or rate_value<=0 or rate_value>1000000 then raise exception 'יש להזין תעריף שעתי ומספר מפגשים תקינים'; end if;
  end if;
  select count(*),count(distinct (j->>'id')::uuid),sum((j->>'amount')::numeric) into fund_count,known_count,funding_total from jsonb_array_elements(p_data->'allocations') j;
  if fund_count=0 or fund_count<>known_count or funding_total is distinct from price_value::numeric or exists(select 1 from jsonb_array_elements(p_data->'allocations') j where j->>'id' is null or j->>'amount' is null or (j->>'amount')::numeric<=0 or (j->>'amount')::numeric<>round((j->>'amount')::numeric,2)) then raise exception 'חלוקת המימון חייבת לכלול מממנים מזוהים ולהסתכם במחיר הכולל'; end if;
  select count(*),string_agg(f.name,' + ' order by f.name),coalesce(bool_or(public.finance_is_gefen_funding(f.name)),false)
  into known_count,funding_text,has_gefen from jsonb_array_elements(p_data->'allocations') j join public.funding_sources f on f.id=(j->>'id')::uuid where f.is_active or exists(select 1 from public.activity_funding_sources af where af.activity_id=a.id and af.funding_source_id=f.id);
  if known_count<>fund_count then raise exception 'גורם מימון אינו תקין'; end if;
  select coalesce(jsonb_agg(jsonb_build_array(f.funding_source_id,f.amount) order by f.funding_source_id),'[]') into before_funding from finance_private.resolved_funding_rows(a) f;
  select coalesce(jsonb_agg(jsonb_build_array((j->>'id')::uuid,(j->>'amount')::numeric) order by (j->>'id')::uuid),'[]') into after_funding from jsonb_array_elements(p_data->'allocations') j;
  if has_prior and (a.price is distinct from price_value or before_funding is distinct from after_funding or (a.activity_type='course' and a.sessions is distinct from n::text)) then raise exception 'לא ניתן לשנות מחיר, חלוקת מימון או מספר מפגשים לאחר שהופק חשבון — נדרשת בדיקת כספים'; end if;
  if has_prior and a.activity_type='course' and exists(select 1 from public.finance_transaction_account_lines l join public.finance_transaction_accounts h on h.id=l.account_id join public.funding_sources f on f.id=l.funding_source_id where l.activity_row_id=a.row_id and h.document_status in ('issued','mail_draft_ready','sent') and public.finance_is_gefen_funding(f.name) and l.hourly_rate_snapshot is distinct from rate_value) then raise exception 'התעריף אינו תואם חשבון גפ״ן שכבר הופק'; end if;
  school_symbol:=nullif(p_data->>'school_symbol','')::bigint;
  if a.school_id is null and school_symbol is not null then
    select * into school_row from public.schools where semel_mosad=school_symbol;
    if not found or (select count(*) from public.schools where semel_mosad=school_symbol)<>1 then raise exception 'סמל המוסד לא נמצא או אינו חד משמעי'; end if;
    if has_prior then raise exception 'לא ניתן לשנות מוסד לאחר הפקת חשבון'; end if;
  end if;
  program_code:=nullif(btrim(p_data->>'program_code'),'');
  if has_gefen and coalesce(nullif(btrim(a.activity_no),''),program_code,'') !~ '^[0-9]+$' then raise exception 'יש להשלים מספר תוכנית גפ״ן תקין'; end if;
  if has_prior and nullif(btrim(a.activity_no),'') is null and program_code is not null then raise exception 'לא ניתן לשנות מספר תוכנית לאחר הפקת חשבון'; end if;
  email:=nullif(btrim(p_data->>'contact_email'),'');
  update public.activities set price=price_value,
    sessions=case when a.activity_type='course' then n::text else a.sessions end,
    course_hourly_rate=case when a.activity_type='course' then rate_value else null end,
    course_hourly_rate_source=case when a.activity_type='course' then 'finance_contract' else null end,
    funding=funding_text,is_gefen_funded=has_gefen,
    school_id=coalesce(a.school_id,school_row.id),
    school=case when a.school_id is null and school_row.id is not null then school_row.school_name else a.school end,
    authority_id=coalesce(a.authority_id,school_row.authority_id),
    authority=case when a.authority_id is null and school_row.authority_id is not null then (select au.authority_name from public.authorities au where au.id=school_row.authority_id) else a.authority end,
    activity_no=coalesce(nullif(btrim(a.activity_no),''),program_code),
    gefen_number=case when has_gefen then coalesce(nullif(btrim(a.gefen_number),''),program_code,a.activity_no) else a.gefen_number end,
    start_time=coalesce(a.start_time,nullif(p_data->>'start_time','')::time),
    end_time=coalesce(a.end_time,nullif(p_data->>'end_time','')::time),
    contact_email=coalesce(nullif(btrim(a.contact_email),''),email),
    date_1=coalesce(a.date_1,nullif(p_data->'dates'->>'date_1','')::date),
    date_2=coalesce(a.date_2,nullif(p_data->'dates'->>'date_2','')::date),
    date_3=coalesce(a.date_3,nullif(p_data->'dates'->>'date_3','')::date),
    date_4=coalesce(a.date_4,nullif(p_data->'dates'->>'date_4','')::date),
    date_5=coalesce(a.date_5,nullif(p_data->'dates'->>'date_5','')::date),
    date_6=coalesce(a.date_6,nullif(p_data->'dates'->>'date_6','')::date),
    date_7=coalesce(a.date_7,nullif(p_data->'dates'->>'date_7','')::date),
    date_8=coalesce(a.date_8,nullif(p_data->'dates'->>'date_8','')::date),
    date_9=coalesce(a.date_9,nullif(p_data->'dates'->>'date_9','')::date),
    date_10=coalesce(a.date_10,nullif(p_data->'dates'->>'date_10','')::date),
    date_11=coalesce(a.date_11,nullif(p_data->'dates'->>'date_11','')::date),
    date_12=coalesce(a.date_12,nullif(p_data->'dates'->>'date_12','')::date),
    date_13=coalesce(a.date_13,nullif(p_data->'dates'->>'date_13','')::date),
    date_14=coalesce(a.date_14,nullif(p_data->'dates'->>'date_14','')::date),
    date_15=coalesce(a.date_15,nullif(p_data->'dates'->>'date_15','')::date),
    date_16=coalesce(a.date_16,nullif(p_data->'dates'->>'date_16','')::date),
    date_17=coalesce(a.date_17,nullif(p_data->'dates'->>'date_17','')::date),
    date_18=coalesce(a.date_18,nullif(p_data->'dates'->>'date_18','')::date),
    date_19=coalesce(a.date_19,nullif(p_data->'dates'->>'date_19','')::date),
    date_20=coalesce(a.date_20,nullif(p_data->'dates'->>'date_20','')::date),
    date_21=coalesce(a.date_21,nullif(p_data->'dates'->>'date_21','')::date),
    date_22=coalesce(a.date_22,nullif(p_data->'dates'->>'date_22','')::date),
    date_23=coalesce(a.date_23,nullif(p_data->'dates'->>'date_23','')::date),
    date_24=coalesce(a.date_24,nullif(p_data->'dates'->>'date_24','')::date),
    date_25=coalesce(a.date_25,nullif(p_data->'dates'->>'date_25','')::date),
    date_26=coalesce(a.date_26,nullif(p_data->'dates'->>'date_26','')::date),
    date_27=coalesce(a.date_27,nullif(p_data->'dates'->>'date_27','')::date),
    date_28=coalesce(a.date_28,nullif(p_data->'dates'->>'date_28','')::date),
    date_29=coalesce(a.date_29,nullif(p_data->'dates'->>'date_29','')::date),
    date_30=coalesce(a.date_30,nullif(p_data->'dates'->>'date_30','')::date),
    date_31=coalesce(a.date_31,nullif(p_data->'dates'->>'date_31','')::date),
    date_32=coalesce(a.date_32,nullif(p_data->'dates'->>'date_32','')::date),
    date_33=coalesce(a.date_33,nullif(p_data->'dates'->>'date_33','')::date),
    date_34=coalesce(a.date_34,nullif(p_data->'dates'->>'date_34','')::date),
    date_35=coalesce(a.date_35,nullif(p_data->'dates'->>'date_35','')::date)
  where id=a.id;
  if not has_prior then
    delete from public.activity_funding_sources where activity_id=a.id and funding_source_id not in (select (j->>'id')::uuid from jsonb_array_elements(p_data->'allocations') j);
    insert into public.activity_funding_sources(activity_id,funding_source_id,amount) select a.id,(j->>'id')::uuid,(j->>'amount')::numeric from jsonb_array_elements(p_data->'allocations') j
    on conflict (activity_id,funding_source_id) do update set amount=excluded.amount;
  end if;
  return jsonb_build_object('ok',true,'row_id',a.row_id);
end;
$completion$;
revoke all on function public.finance_billing_completion_context(text),public.finance_complete_billing_data(text,jsonb) from public,anon;
grant execute on function public.finance_billing_completion_context(text),public.finance_complete_billing_data(text,jsonb) to authenticated;
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
    if source_reason='' and lower(btrim(coalesce(p_activity.activity_type,'')))='course' and p_activity.course_hourly_rate is null then
      source_reason := 'חסר מחיר שעתי — יש להשלים נתונים לפני הפקה';
    end if;
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
        'eligibilityStatus',case when course_monthly and period_reason='ממתין להשלמת שלושה מפגשים' then 'waiting_three_meetings' else null end,
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

commit;
