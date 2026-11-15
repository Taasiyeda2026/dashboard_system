begin;
create table if not exists finance_private.gefen_approved_order_rates (
 activity_row_id text primary key references public.activities(row_id) on delete cascade,
 activity_school_id bigint not null, activity_no text not null, order_school_symbol bigint not null,
 hourly_rate numeric(18,8) not null check(hourly_rate>0 and hourly_rate<=1000000),
 order_numbers text[] not null check(cardinality(order_numbers)>0),
 approved_at timestamptz not null default now()
);
revoke all on finance_private.gefen_approved_order_rates from public,anon,authenticated;
-- User-confirmed Hura funding conversion. Never rewrite an already billed activity.
do $hura$
declare a public.activities%rowtype; f uuid;
begin
select * into a from public.activities where id=1834 for update;
if a.row_id is null or a.activity_no<>'52279' or a.school_id<>1068 or a.price<>12075 or a.sessions<>'14' or a.funding<>'חוזה עצמאי' or exists(select 1 from public.finance_transaction_account_lines l join public.finance_transaction_accounts h on h.id=l.account_id where l.activity_row_id=a.row_id and h.document_status<>'cancelled') then raise exception 'Hura changed — review required'; end if;
select id into strict f from public.funding_sources where name='גפן' and is_active;
update public.activities set funding='גפן',is_gefen_funded=true,exists_in_gefen=true,course_hourly_rate=575,course_hourly_rate_source='finance_contract' where id=a.id;
delete from public.activity_funding_sources where activity_id=a.id and funding_source_id<>f;
insert into public.activity_funding_sources(activity_id,funding_source_id,amount) values(a.id,f,a.price) on conflict(activity_id,funding_source_id) do update set amount=excluded.amount;
end;$hura$;
-- Exact workbook rows; only equal group counts, a single rate and one actual program per school.
with orders(id,school,code,rate,n) as (values (9259946,144741,53819,550,1),
(9296131,211466,6089,450,1),
(9101168,211532,6089,225,2),
(9304177,211532,6089,225,1),
(9307127,213595,6089,204.5,9),
(9223548,213710,6089,593.75,4),
(9223544,214098,46091,428.57214285714286,1),
(9223543,214098,52279,500,2),
(9223890,217844,6089,529,2),
(9229461,217844,57651,600,3),
(9225462,218446,57651,600,2),
(9225451,218446,6089,529,1),
(9251234,218602,6089,425,1),
(9258518,218677,6089,500,1),
(9258530,218677,57651,540,1),
(9121327,218966,6089,530,3),
(9121334,218966,57651,600,3),
(9209302,218982,6089,485,1),
(9224303,218982,57651,533,1),
(9099343,219055,57651,550,2),
(9249187,238121,52279,500,1),
(9249201,240036,52279,571,1),
(9251571,244152,52279,572,1),
(9254229,247858,46091,570,1),
(9223587,248336,46091,572,1),
(9292212,248336,52279,572,1),
(9322873,248419,46091,571.4290476190477,1),
(9322835,248419,53819,633.3340000000001,2),
(9286260,248724,53828,567,2),
(9192937,249177,52279,480,1),
(9135985,249177,46091,600,1),
(9190481,249219,46091,547,1),
(9238041,249219,46091,440,1),
(9233520,288209,3604,500,1),
(9126095,318477,57651,600,2),
(9219423,318527,6089,540,4),
(9231329,338657,53828,587,1),
(9231328,338657,53828,587,1),
(9254782,344408,53819,317,1),
(9254781,344408,53819,633,1),
(9329376,348250,13990,100,2),
(9285983,410779,6089,279,1),
(8974859,412593,6089,450,2),
(9111880,412718,6089,594,2),
(9199884,413351,6089,475,3),
(9312940,413526,6089,409,1),
(9312966,413526,57651,450,4),
(9342498,413526,6089,409.2,1),
(9286604,414243,57651,450,1),
(9347063,414243,57651,450,1),
(9200141,430496,57651,450,1),
(9288252,440016,52279,477,1),
(9318894,440115,52279,571.4290476190477,1),
(9318217,440115,53819,633.3353333333333,1),
(9284058,440115,46091,571.4290476190477,1),
(9284064,440115,53819,633.3353333333333,1),
(9114950,440149,9545,400,5),
(9315991,440875,52279,567,1),
(9038293,441469,46091,600,1),
(9039923,441469,52279,525,1),
(9038279,441469,57646,593.8,1),
(9251137,442236,52279,476.1909523809524,1),
(8985103,442236,57651,500,1),
(8985128,442236,53819,500,1),
(9260640,442822,52279,500,1),
(9321540,444950,52279,567,1),
(9235020,448019,9545,500,4),
(9200817,470187,53819,633,2),
(9113291,482620,53828,593.75,2),
(9198442,482620,52279,428.59999999999997,1),
(9113267,482620,46091,500,2),
(9300590,571224,13990,700,1),
(8998192,610857,9545,485,3),
(9184586,610857,6089,600,3),
(9234164,611830,6089,450,1),
(9285994,613133,57651,266.7,1),
(9285995,613133,57651,633.35,2),
(9240141,613299,6089,528,1),
(9237642,614883,57651,634,1),
(9305577,615559,6089,475,2),
(9292766,615559,6089,475,2),
(9235041,618264,57651,600,4),
(9244878,618264,6089,529,2),
(9243697,618298,6089,450,1),
(9243703,618298,57651,450,1),
(9288334,618785,57651,600,2),
(9301235,618785,46091,533,2),
(9085705,640193,46091,500,1),
(9243618,640193,52279,500,1),
(9252960,640235,52279,400,1),
(9303382,640276,52279,575,1),
(9232682,640672,46091,500,1),
(9254514,640672,52279,500,1),
(9232683,640672,46091,500,1),
(9108246,641555,53819,613,2),
(9249223,659425,57651,633,2),
(9319786,681221,6089,260,7),
(9299468,681486,53819,475,1),
(9103297,682211,6089,417,2),
(9245303,682237,57651,600,2),
(8964435,800078,53828,475,3),
(8964513,800078,9545,470,3),
(9260692,841262,3604,500,1)), 
og as (select case when school=214098 then 214544 when school=841262 then 110734 else school end match_school,school,case when code in (52279,3604) then 'ofek' else code::text end family,sum(n) groups,count(distinct round(rate,8)) nr,min(round(rate,8)) rate,array_agg(id::text order by id) numbers from orders group by 1,2,3),
act as (select a.*,s.semel_mosad,case when a.activity_no in ('52279','3604') then 'ofek' else a.activity_no end family from public.activities a join public.schools s on s.id=a.school_id where a.activity_season='school_2027' and lower(btrim(coalesce(a.status,''))) not in ('נמחק','בוטל','מבוטל','deleted','cancelled','canceled') and exists(select 1 from finance_private.resolved_funding_rows(a) f where public.finance_is_gefen_funding(f.name))),
ag as (select semel_mosad,family,count(*) acts,count(distinct activity_no) nc from act group by 1,2),
candidates as (select a.row_id,a.school_id,a.activity_no,o.school,o.rate,o.numbers from act a join public.activities source_activity on source_activity.id=a.id join ag on ag.semel_mosad=a.semel_mosad and ag.family=a.family join og o on o.match_school=a.semel_mosad and o.family=a.family where o.groups=ag.acts and o.nr=1 and ag.nc=1 and a.activity_type='course' and a.sessions~'^[1-9][0-9]?$' and a.sessions::int between 1 and 35 and a.price>0 and (select sum(f.amount) from finance_private.resolved_funding_rows(source_activity) f)=a.price and not exists(select 1 from finance_private.resolved_funding_rows(source_activity) f where f.funding_source_id is null or f.amount is null or f.amount<=0) and not exists(select 1 from public.finance_transaction_account_lines l join public.finance_transaction_accounts h on h.id=l.account_id where l.activity_row_id=a.row_id and h.document_status<>'cancelled'))
insert into finance_private.gefen_approved_order_rates(activity_row_id,activity_school_id,activity_no,order_school_symbol,hourly_rate,order_numbers)
select row_id,school_id,activity_no,school,rate,numbers from candidates on conflict(activity_row_id) do nothing;
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
  approved finance_private.gefen_approved_order_rates%rowtype;
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
  select * into approved from finance_private.gefen_approved_order_rates r
  where r.activity_row_id=p_activity.row_id and r.activity_school_id=p_activity.school_id
    and r.activity_no=p_activity.activity_no and p_activity.activity_season='school_2027'
    and p_activity.activity_type='course';
  -- Explicit unique order-to-activity evidence; no implicit match on school alone.
  if approved.activity_row_id is null and p_activity.activity_season='school_2027'
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
    explicit_gefen_rate := case when monthly and lower(btrim(coalesce(p_activity.activity_type,'')))='course' then coalesce(approved.hourly_rate,p_activity.course_hourly_rate) end;
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
    if source_reason='' and lower(btrim(coalesce(p_activity.activity_type,'')))='course' and p_activity.course_hourly_rate is null and (not monthly or approved.hourly_rate is null) then
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
    if source_reason='' and explicit_gefen_rate is not null and approved.hourly_rate is null and p_activity.course_hourly_rate_source='proposal'
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
      'billingBasis',case when monthly and (order_matched or approved.hourly_rate is not null) then 'gefen_matched_order' else 'activity_data' end,
      'matchedGefenOrderNumber',case when monthly then coalesce(array_to_string(approved.order_numbers,', '),matched_order_number) else null end,
      'matchedGefenOrderHourlyRate',case when monthly then coalesce(approved.hourly_rate,matched_order_rate) else null end,'approvedGefenRate',case when monthly then approved.hourly_rate else null end,'plannedHours',case when lower(btrim(coalesce(p_activity.activity_type,''))) in ('workshop','tour') then 0 else planned*1.5 end,'plannedCount',planned,'scheduledCount',scheduled,'completedCount',done,
      'billedCount',(select count(distinct m.meeting_slot) from public.finance_transaction_account_meetings m join public.finance_transaction_account_lines l on l.id=m.account_line_id
        join public.finance_transaction_accounts h on h.id=l.account_id where l.activity_row_id=p_activity.row_id and l.funding_source_id=f.funding_source_id and h.document_status in ('issued','mail_draft_ready','sent')),
      'billedAmount',(select coalesce(sum(l.amount),0) from public.finance_transaction_account_lines l join public.finance_transaction_accounts h on h.id=l.account_id where l.activity_row_id=p_activity.row_id and l.funding_source_id=f.funding_source_id and h.document_status in ('issued','mail_draft_ready','sent')),'finished',finished,'completionMonth',completion_month,
      'billingCutoff',case when monthly then gefen_cutoff else today end,
      'nextBillingUpdate',case when monthly then case when extract(day from gefen_cutoff)=14 then (date_trunc('month',gefen_cutoff)+interval '1 month')::date else gefen_cutoff+15 end else null end,
      'financialAdjustment',adjustment,'fullFundingAmount',greatest(0,case when monthly and approved.hourly_rate is not null then least(f.amount,round(approved.hourly_rate*planned*1.5,2)) else f.amount end-billed),
      'fullFundingBlockedReason',case when source_reason not in ('','חסרים מועדי מפגשים מתוכננים') then source_reason when monthly and approved.hourly_rate is not null and round(approved.hourly_rate*planned*1.5,2)<f.amount then 'פער בין מסגרת גפ״ן לתעריף ושעות — אין להפיק חיוב מלא' when billed>=f.amount then 'חלק המממן חויב במלואו' when cancelled_count>0 then 'קיימים מפגשים שבוטלו; יש לעדכן את מסגרת המימון' else '' end,
      'manualMonth',coalesce(completion_month,date_trunc('month',today)::date),
      'institutionSymbol',case when monthly and approved.hourly_rate is not null then approved.order_school_symbol::text else (select s.semel_mosad::text from public.schools s where s.id=p_activity.school_id) end,
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
CREATE OR REPLACE FUNCTION public.finance_billing_completion_context(p_activity_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.activities%rowtype; q public.proposal_agreement_items%rowtype; order_rate numeric; fs jsonb; alloc jsonb; school_symbol bigint; prior boolean;
begin
  if auth.uid() is null or not coalesce(public.app_current_role()='admin' or public.app_has_permission('manage_finance_transactions'),false)
    then raise exception 'finance_permission_denied' using errcode='42501'; end if;
  select * into a from public.activities where row_id=p_activity_id and activity_season='school_2027';
  if not found then raise exception 'activity_not_found'; end if;
  select * into q from public.proposal_agreement_items where id=coalesce(a.proposal_item_id,a.israa_source_item_id);
  select coalesce(
    (select r.hourly_rate from finance_private.gefen_approved_order_rates r where r.activity_row_id=a.row_id and r.activity_school_id=a.school_id and r.activity_no=a.activity_no),
    (select m.order_hourly_rate from finance_private.gefen_order_billing_matches m where m.activity_row_id=a.row_id limit 1)) into order_rate;
  select s.semel_mosad into school_symbol from public.schools s where s.id=a.school_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',f.name) order by f.sort_order nulls last,f.name),'[]') into fs from public.funding_sources f where f.is_active or exists(select 1 from public.activity_funding_sources af where af.activity_id=a.id and af.funding_source_id=f.id);
  select coalesce(jsonb_agg(jsonb_build_object('id',f.funding_source_id,'amount',f.amount,'name',f.name)) filter(where f.funding_source_id is not null),'[]') into alloc from finance_private.resolved_funding_rows(a) f;
  select exists(select 1 from public.finance_transaction_account_lines l join public.finance_transaction_accounts h on h.id=l.account_id where l.activity_row_id=a.row_id and h.document_status<>'cancelled') into prior;
  return jsonb_build_object('row_id',a.row_id,'name',a.activity_name,'school',a.school,'school_symbol',school_symbol,'activity_type',a.activity_type,'activity_no',a.activity_no,'gefen_number',a.gefen_number,'program_name',a.program_name,'catalog_slug',a.catalog_slug,'sessions',a.sessions,'price',a.price,'rate',a.course_hourly_rate,'proposal_rate',q.hourly_price,'order_rate',order_rate,'proposal_hours',q.hours_count,'funding',a.funding,'funding_options',fs,'allocations',alloc,'has_prior',prior,'updated_at',a.updated_at,'start_time',a.start_time,'end_time',a.end_time,'contact_email',a.contact_email,'dates',(select jsonb_object_agg('date_'||n,to_jsonb(a)->('date_'||n)) from generate_series(1,35) n));
end;
$function$;
commit;