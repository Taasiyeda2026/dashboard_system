-- One business report retains every source meeting, instead of inventing a representative row.
-- Existing attendance RLS and API grants are unchanged. Helpers are outside exposed schemas.
alter table public.attendance_records add column if not exists course_business_identity jsonb;
alter table public.attendance_records add column if not exists course_dashboard_sources jsonb;
alter table public.attendance_records add constraint attendance_course_business_shape check (
  (course_business_identity is null and course_dashboard_sources is null) or
  (course_business_identity is not null and course_dashboard_sources is not null
   and activity_type in ('קורס','course') and generation_kind is null
   and jsonb_typeof(course_business_identity) = 'array'
   and jsonb_array_length(course_business_identity) = 2
   and jsonb_typeof(course_dashboard_sources) = 'array'
   and jsonb_array_length(course_dashboard_sources) > 0)
);
create schema if not exists attendance_private;
revoke all on schema attendance_private from public, anon, authenticated;

-- Shared source of truth for date assignment. The public RPC retains its exact
-- self/active-user check; privileged travel processing has already verified its actor.
create or replace function attendance_private.instructor_rows_for_date(
  p_emp_id bigint,
  p_date date
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_result jsonb;
begin
  select jsonb_agg(
    jsonb_build_object(
      'id',                  adv.id,
      'row_id',              a.row_id,
      'activity_no',         adv.activity_no,
      'activity_name',       adv.activity_name,
      'activity_type',       adv.activity_type,
      'activity_season',     adv.activity_season,
      'program_name',        adv.program_name,
      'start_time',          to_char(adv.start_time,'HH24:MI'),
      'end_time',            to_char(adv.end_time,'HH24:MI'),
      'authority_id',        adv.authority_id,
      'authority_name',      adv.authority_name,
      'school_link_status',  adv.school_link_status,
      'single_school_id',    adv.single_school_id,
      'single_semel_mosad',  adv.single_semel_mosad,
      'single_school_name',  adv.single_school_name,
      'linked_schools_json', adv.linked_schools_json,
      'meeting_no', (
        select count(*)::int + 1
        from (
          select unnest(array[
            a.date_1,a.date_2,a.date_3,a.date_4,a.date_5,a.date_6,a.date_7,
            a.date_8,a.date_9,a.date_10,a.date_11,a.date_12,a.date_13,a.date_14,
            a.date_15,a.date_16,a.date_17,a.date_18,a.date_19,a.date_20,a.date_21,
            a.date_22,a.date_23,a.date_24,a.date_25,a.date_26,a.date_27,a.date_28,
            a.date_29,a.date_30,a.date_31,a.date_32,a.date_33,a.date_34,a.date_35
          ]) as d
        ) sq
        where sq.d is not null
          and sq.d < p_date
          and not exists (
            select 1 from public.course_meeting_cancellations cmc
            where cmc.activity_id = a.row_id and cmc.meeting_date = sq.d
          )
      )
    )
  )
  into v_result
  from public.activities a
  join public.activities_directory_view adv on adv.id = a.id
  left join public.course_meeting_instructor_history h
    on h.activity_id = a.row_id
   and h.meeting_date = p_date
  where (
      btrim(coalesce(a.emp_id_2, '')) = p_emp_id::text
      or coalesce(h.emp_id, a.emp_id::text) = p_emp_id::text
    )
    and (
      a.date_1=p_date or a.date_2=p_date or a.date_3=p_date or a.date_4=p_date or a.date_5=p_date or
      a.date_6=p_date or a.date_7=p_date or a.date_8=p_date or a.date_9=p_date or a.date_10=p_date or
      a.date_11=p_date or a.date_12=p_date or a.date_13=p_date or a.date_14=p_date or a.date_15=p_date or
      a.date_16=p_date or a.date_17=p_date or a.date_18=p_date or a.date_19=p_date or a.date_20=p_date or
      a.date_21=p_date or a.date_22=p_date or a.date_23=p_date or a.date_24=p_date or a.date_25=p_date or
      a.date_26=p_date or a.date_27=p_date or a.date_28=p_date or a.date_29=p_date or a.date_30=p_date or
      a.date_31=p_date or a.date_32=p_date or a.date_33=p_date or a.date_34=p_date or a.date_35=p_date
    )
    and not exists (
      select 1 from public.course_meeting_cancellations cmc
      where cmc.activity_id = a.row_id and cmc.meeting_date = p_date
    );

  return coalesce(v_result, '[]'::jsonb);
end
$$;

create or replace function public.av2_get_instructor_activities_for_date(
  p_emp_id bigint,
  p_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_current_emp_id bigint;
  v_result jsonb;
begin
  select u.emp_id::bigint
    into v_current_emp_id
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.is_active = true
  limit 1;

  if v_current_emp_id is null or v_current_emp_id <> p_emp_id then
    return '[]'::jsonb;
  end if;

  return attendance_private.instructor_rows_for_date(p_emp_id,p_date);
end
$$;

create or replace function attendance_private.course_identity(item jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_build_array(btrim(coalesce(nullif(item->>'activity_name',''),item->>'program_name','')),
    case when coalesce(nullif(btrim(item->>'school_id'),''),nullif(btrim(item->>'single_school_id'),'')) is not null
    then jsonb_build_array('id',coalesce(nullif(btrim(item->>'school_id'),''),nullif(btrim(item->>'single_school_id'),'')))
    else jsonb_build_array('name',btrim(coalesce(nullif(item->>'single_school_name',''),nullif(item->>'school_name',''),item->>'school',''))) end);
$$;

create or replace function attendance_private.course_sources(p_emp bigint, p_date date, p_identity jsonb)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(item || jsonb_build_object('grade',a.grade,'class_group',a.class_group,
    'report_date',p_date,'resolved_emp_id',p_emp) order by item->>'row_id'),'[]'::jsonb)
  from jsonb_array_elements(attendance_private.instructor_rows_for_date(p_emp,p_date)) item
  left join public.activities a on a.row_id = item->>'row_id'
  where lower(btrim(item->>'activity_type')) in ('course','קורס')
    and attendance_private.course_identity(item) = p_identity;
$$;

-- Merge overlapping instructional windows (including identical class schedules).
-- Adjacent meetings remain separate for their earned +15 minutes per full 45.
-- SUM paid durations, not union padded windows: preparation overlap must not erase pay.
create or replace function attendance_private.course_work(sources jsonb)
returns jsonb language sql immutable set search_path = public as $$
  with windows as (
    select distinct extract(epoch from (item->>'start_time')::time)::int/60 s,
      extract(epoch from (item->>'end_time')::time)::int/60 e
    from jsonb_array_elements(sources) item
  ), ordered as (
    select *, max(e) over(order by s,e rows between unbounded preceding and 1 preceding) prior_end from windows
  ), clustered as (
    select *, sum(case when prior_end is null or s >= prior_end then 1 else 0 end) over(order by s,e) cluster from ordered
  ), sessions as (select min(s) s,max(e) e from clustered group by cluster), paid as (
    select greatest(0,s-ceil(floor((e-s)::numeric/45)/2)::int*15) s,
      least(1439,e+floor(floor((e-s)::numeric/45)/2)::int*15) e from sessions
  )
  select case when not exists(select 1 from windows where s is null or e is null or e<=s)
    and count(*)>0 then jsonb_build_object(
      'start_time',to_char(time '00:00'+make_interval(mins=>min(s)),'HH24:MI'),
      'end_time',to_char(time '00:00'+make_interval(mins=>max(e)),'HH24:MI'),
      'paid_minutes',sum(e-s),'total_hours',round(sum(e-s)::numeric/60,2)) else null end from paid;
$$;
revoke all on all functions in schema attendance_private from public, anon, authenticated;

-- Enforce course ownership at write time using the existing dashboard date RPC.
-- No policies/grants are widened; other report types and back-office writes are unchanged.
create or replace function public.av2_guard_course_date_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp_id bigint;
  v_role text;
  v_expected jsonb;
  v_sources jsonb;
  v_work jsonb;
  v_count integer;
  v_authority bigint;
begin
  if new.activity_type not in ('קורס', 'course') or new.generation_kind is not null then
    new.course_business_identity := null;
    new.course_dashboard_sources := null;
    return new;
  end if;

  select u.emp_id::bigint, u.role into v_emp_id, v_role
  from public.users u
  where u.auth_user_id = auth.uid() and u.is_active = true
  limit 1;

  -- Expense/notes/travel corrections do not alter the dashboard assignment.
  if tg_op = 'UPDATE' then
    if old.emp_id is not distinct from new.emp_id
       and old.report_date is not distinct from new.report_date
       and old.activity_row_id is not distinct from new.activity_row_id
       and old.activity_type is not distinct from new.activity_type
       and old.school_id is not distinct from new.school_id
       and old.authority_id is not distinct from new.authority_id
       and old.course_business_identity is not distinct from new.course_business_identity
       and old.course_dashboard_sources is not distinct from new.course_dashboard_sources
       and (old.course_business_identity is null or (
         old.activity_id is not distinct from new.activity_id
         and old.activity_no is not distinct from new.activity_no
         and old.start_time is not distinct from new.start_time and old.end_time is not distinct from new.end_time
         and old.total_hours is not distinct from new.total_hours
         and old.activity_name_snapshot is not distinct from new.activity_name_snapshot
         and old.meeting_no is not distinct from new.meeting_no)) then
      return new;
    end if;
  end if;

  if new.course_business_identity is not null then
    if v_emp_id is null or new.emp_id is distinct from v_emp_id then
      raise exception 'לא ניתן לדווח קורס עבור מדריך אחר' using errcode='42501';
    end if;
    v_sources := attendance_private.course_sources(v_emp_id,new.report_date,new.course_business_identity);
    v_count := jsonb_array_length(v_sources);
    if v_count=0 then
      raise exception 'הקורס אינו משויך למדריך בתאריך המדווח בדשבורד' using errcode='42501';
    end if;
    v_work := attendance_private.course_work(v_sources);
    if v_work is null then raise exception 'נתוני שעות הקורס בדשבורד אינם תקינים' using errcode='22023'; end if;
    if new.school_id is distinct from (case when new.course_business_identity->1->>0='id'
      then (new.course_business_identity->1->>1)::bigint else null end) then
      raise exception 'בית הספר אינו תואם לפעילות בדשבורד' using errcode='42501';
    end if;
    select min(nullif(item->>'authority_id','')::bigint) into v_authority from jsonb_array_elements(v_sources) item;
    if exists(select 1 from jsonb_array_elements(v_sources) item
      where nullif(item->>'authority_id','')::bigint is distinct from v_authority)
      or new.authority_id is distinct from v_authority then
      raise exception 'הרשות אינה תואמת לפעילות בדשבורד' using errcode='42501';
    end if;
    -- Never trust client-supplied source links, meeting numbers or pay. Rebuild from the dashboard.
    new.course_dashboard_sources := v_sources;
    new.activity_name_snapshot := new.course_business_identity->>0;
    new.activity_row_id := case when v_count=1 then v_sources->0->>'row_id' else null end;
    new.activity_id := case when v_count=1 then (v_sources->0->>'id')::bigint else null end;
    new.activity_no := case when v_count=1 then v_sources->0->>'activity_no' else null end;
    new.meeting_no := case when v_count=1 then (v_sources->0->>'meeting_no')::int else null end;
    new.start_time := (v_work->>'start_time')::time;
    new.end_time := (v_work->>'end_time')::time;
    new.total_hours := (v_work->>'total_hours')::numeric;
    return new;
  end if;
  -- JSON sources cannot be attached to a legacy single-row report by the client.
  new.course_dashboard_sources := null;
  -- Existing RLS continues to govern legacy manager/admin and service writes.
  if v_role is distinct from 'instructor' then return new; end if;

  if new.emp_id is distinct from v_emp_id then
    raise exception using errcode = '42501', message = 'לא ניתן לדווח קורס עבור מדריך אחר';
  end if;

  select item into v_expected
  from jsonb_array_elements(public.av2_get_current_instructor_activity_choices_for_date(new.report_date)) item
  where item->>'row_id' = btrim(coalesce(new.activity_row_id, ''))
    and lower(btrim(item->>'activity_type')) in ('course', 'קורס');

  if v_expected is null then
    raise exception using errcode = '42501', message = 'הקורס אינו משויך למדריך בתאריך המדווח בדשבורד';
  end if;

  if nullif(v_expected->>'single_school_id', '') is not null then
    if new.school_id is distinct from (v_expected->>'single_school_id')::bigint then
      raise exception using errcode = '42501', message = 'בית הספר אינו תואם לפעילות בדשבורד';
    end if;
  elsif jsonb_array_length(coalesce(nullif(v_expected->'linked_schools_json', 'null'::jsonb), '[]'::jsonb)) > 0 then
    if not exists (
      select 1 from jsonb_array_elements(v_expected->'linked_schools_json') school
      where (school->>'id')::bigint = new.school_id
    ) then
      raise exception using errcode = '42501', message = 'בית הספר אינו תואם לפעילות בדשבורד';
    end if;
  end if;

  if new.authority_id is distinct from nullif(v_expected->>'authority_id', '')::bigint then
    raise exception using errcode = '42501', message = 'הרשות אינה תואמת לפעילות בדשבורד';
  end if;
  return new;
end
$$;

-- Trigger functions need no direct API EXECUTE permission.
revoke all on function public.av2_guard_course_date_assignment() from public, anon, authenticated;
drop trigger if exists av2_guard_course_date_assignment on public.attendance_records;
create trigger av2_guard_course_date_assignment
before insert or update on public.attendance_records
for each row execute function public.av2_guard_course_date_assignment();

-- Retain the existing monthly RPC authorization and every legacy single-row check.
create or replace function public.av2_validate_attendance_month_dashboard(
  p_emp_id bigint,
  p_month_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_current_emp_id bigint;
  v_month_start date;
  v_month_end date;
  v_result jsonb := '[]'::jsonb;
  r record;
  v_activity public.activities%rowtype;
  v_meetings jsonb;
  v_expected jsonb;
  v_expected_date date;
  v_dashboard_start time;
  v_dashboard_end time;
  v_expected_start time;
  v_expected_end time;
  v_dashboard_minutes integer;
  v_blocks integer;
  v_before_minutes integer;
  v_after_minutes integer;
  v_reasons jsonb;
  v_school_valid boolean;
  v_resolved_emp_id text;
  v_sources jsonb;
  v_work jsonb;
begin
  select u.emp_id::bigint
    into v_current_emp_id
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.is_active = true
  limit 1;

  if v_current_emp_id is null or v_current_emp_id <> p_emp_id then
    return '[]'::jsonb;
  end if;

  if coalesce(p_month_key, '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_month_key' using errcode = '22023';
  end if;

  v_month_start := (p_month_key || '-01')::date;
  v_month_end := (v_month_start + interval '1 month - 1 day')::date;

  for r in
    select ar.*
    from public.attendance_records ar
    where ar.emp_id = p_emp_id
      and ar.report_date between v_month_start and v_month_end
      and ar.generation_kind is null
      and btrim(coalesce(ar.activity_type, '')) = 'קורס'
    order by ar.report_date, ar.start_time
  loop
    v_reasons := '[]'::jsonb;
    v_expected := null;
    v_expected_date := null;
    v_dashboard_start := null;
    v_dashboard_end := null;
    v_expected_start := null;
    v_expected_end := null;
    v_resolved_emp_id := null;

    if r.course_business_identity is not null then
      v_sources := attendance_private.course_sources(p_emp_id,r.report_date,r.course_business_identity);
      v_work := attendance_private.course_work(v_sources);
      if v_sources is distinct from r.course_dashboard_sources then
        v_reasons := v_reasons || jsonb_build_array('השיבוץ לקורס בדשבורד השתנה');
      end if;
      if v_work is null or r.start_time is distinct from (v_work->>'start_time')::time
        or r.end_time is distinct from (v_work->>'end_time')::time
        or r.total_hours is distinct from (v_work->>'total_hours')::numeric then
        v_reasons := v_reasons || jsonb_build_array('שעות הדיווח אינן תואמות לדשבורד');
      end if;
      if r.activity_name_snapshot is distinct from r.course_business_identity->>0
        or r.school_id is distinct from (case when r.course_business_identity->1->>0='id'
          then (r.course_business_identity->1->>1)::bigint else null end)
        or exists(select 1 from jsonb_array_elements(v_sources) item
          where nullif(item->>'authority_id','')::bigint is distinct from r.authority_id) then
        v_reasons := v_reasons || jsonb_build_array('פרטי הקורס ובית הספר אינם תואמים לדשבורד');
      end if;
      v_result := v_result || jsonb_build_array(jsonb_build_object('record_id',r.id,
        'mismatch',jsonb_array_length(v_reasons)>0,'reasons',v_reasons,
        'expected',jsonb_build_object('date',r.report_date,'attendance_start_time',v_work->>'start_time',
          'attendance_end_time',v_work->>'end_time','total_hours',v_work->'total_hours',
          'source_meetings',v_sources,'authority_id',r.authority_id,'school_id',r.school_id)));
      continue;
    end if;

    select a.*
      into v_activity
    from public.activities a
    where a.row_id = btrim(coalesce(r.activity_row_id, ''))
    limit 1;

    if not found then
      v_reasons := v_reasons || jsonb_build_array('הפעילות אינה תואמת לשיבוץ בדשבורד');
    else
      select coalesce(h.emp_id, v_activity.emp_id::text)
        into v_resolved_emp_id
      from (select 1) seed
      left join public.course_meeting_instructor_history h
        on h.activity_id = v_activity.row_id
       and h.meeting_date = r.report_date;

      if not (
        btrim(coalesce(v_activity.emp_id_2, '')) = p_emp_id::text
        or v_resolved_emp_id = p_emp_id::text
      ) then
        v_reasons := v_reasons || jsonb_build_array('המפגש משויך בדשבורד למדריך אחר');
      end if;

      v_meetings := public.scheduling_effective_meetings(v_activity, p_emp_id);

      if r.meeting_no is not null and r.meeting_no > 0 and jsonb_array_length(v_meetings) >= r.meeting_no then
        v_expected := v_meetings -> (r.meeting_no - 1);
      else
        select item
          into v_expected
        from jsonb_array_elements(v_meetings) item
        where nullif(item->>'date', '')::date = r.report_date
        limit 1;
      end if;

      if v_expected is null then
        v_reasons := v_reasons || jsonb_build_array('מספר המפגש או התאריך אינם קיימים בלוח הדשבורד');
      else
        v_expected_date := nullif(v_expected->>'date', '')::date;
        v_dashboard_start := nullif(v_expected->>'start_time', '')::time;
        v_dashboard_end := nullif(v_expected->>'end_time', '')::time;

        if r.report_date is distinct from v_expected_date then
          v_reasons := v_reasons || jsonb_build_array('תאריך הדיווח אינו תואם למפגש בדשבורד');
        end if;

        if v_dashboard_start is not null and v_dashboard_end is not null and v_dashboard_end > v_dashboard_start then
          v_dashboard_minutes := floor(extract(epoch from (v_dashboard_end - v_dashboard_start)) / 60)::int;
          v_blocks := floor(v_dashboard_minutes::numeric / 45)::int;
          v_before_minutes := ceil(v_blocks::numeric / 2)::int * 15;
          v_after_minutes := floor(v_blocks::numeric / 2)::int * 15;
          v_expected_start := v_dashboard_start - make_interval(mins => v_before_minutes);
          v_expected_end := v_dashboard_end + make_interval(mins => v_after_minutes);

          if r.start_time::time(0) is distinct from v_expected_start::time(0)
             or r.end_time::time(0) is distinct from v_expected_end::time(0) then
            v_reasons := v_reasons || jsonb_build_array('שעות הדיווח אינן תואמות לשעות המחושבות מהדשבורד');
          end if;
        end if;
      end if;

      if v_activity.authority_id is not null
         and r.authority_id is distinct from v_activity.authority_id then
        v_reasons := v_reasons || jsonb_build_array('הרשות אינה תואמת לדשבורד');
      end if;

      if v_activity.school_id is not null then
        v_school_valid := r.school_id is not distinct from v_activity.school_id;
      elsif exists (
        select 1 from public.activity_schools acs where acs.activity_id = v_activity.id
      ) then
        v_school_valid := exists (
          select 1
          from public.activity_schools acs
          where acs.activity_id = v_activity.id
            and acs.school_id = r.school_id
        );
      else
        v_school_valid := true;
      end if;

      if not coalesce(v_school_valid, false) then
        v_reasons := v_reasons || jsonb_build_array('בית הספר אינו תואם לדשבורד');
      end if;

      if btrim(coalesce(r.activity_name_snapshot, '')) <> ''
         and btrim(coalesce(v_activity.activity_name, v_activity.program_name, '')) <> ''
         and btrim(r.activity_name_snapshot) <> btrim(coalesce(v_activity.activity_name, v_activity.program_name, '')) then
        v_reasons := v_reasons || jsonb_build_array('שם הפעילות אינו תואם לדשבורד');
      end if;
    end if;

    v_result := v_result || jsonb_build_array(
      jsonb_build_object(
        'record_id', r.id,
        'mismatch', jsonb_array_length(v_reasons) > 0,
        'reasons', v_reasons,
        'expected', case when v_expected is null then null else jsonb_build_object(
          'meeting_no', r.meeting_no,
          'date', case when v_expected_date is null then null else to_char(v_expected_date, 'YYYY-MM-DD') end,
          'dashboard_start_time', case when v_dashboard_start is null then null else to_char(v_dashboard_start, 'HH24:MI') end,
          'dashboard_end_time', case when v_dashboard_end is null then null else to_char(v_dashboard_end, 'HH24:MI') end,
          'attendance_start_time', case when v_expected_start is null then null else to_char(v_expected_start, 'HH24:MI') end,
          'attendance_end_time', case when v_expected_end is null then null else to_char(v_expected_end, 'HH24:MI') end,
          'authority_id', v_activity.authority_id,
          'school_id', v_activity.school_id
        ) end
      )
    );
  end loop;

  return v_result;
end
$$;

-- Same compensation/override/reset functions and one trip per business report.
create or replace function public.av2_attendance_travel_context(p_source_id uuid, p_actor_id uuid default auth.uid())
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  s public.attendance_records%rowtype;
  a public.activities%rowtype;
  v_emp bigint;
  instructor_address text;
  destination_address text;
  school_name text;
  valid_school boolean := false;
  fingerprint text;
  excluded_type text;
  normalized_name text;
  destination_key text;
begin
  select u.emp_id::bigint
    into v_emp
  from public.users u
  where u.auth_user_id = p_actor_id
    and u.is_active = true
  limit 1;

  if v_emp is null then
    raise exception 'attendance_auth_required' using errcode = '42501';
  end if;

  select *
    into s
  from public.attendance_records
  where id = p_source_id
    and emp_id = v_emp
    and generation_kind is null;

  if not found then
    raise exception 'attendance_source_not_found' using errcode = '22023';
  end if;

  excluded_type := regexp_replace(lower(btrim(coalesce(s.activity_type, ''))), '\s+', '', 'g');
  normalized_name := regexp_replace(lower(btrim(coalesce(s.activity_name_snapshot, ''))), '\s+', '', 'g');

  if excluded_type in ('זום', 'ביטולזמן')
     or (excluded_type = 'הכשרה' and s.training_mode = 'online') then
    return jsonb_build_object('eligible', false, 'source_id', s.id);
  end if;

  select nullif(btrim(ci.address), '')
    into instructor_address
  from public.contacts_instructors ci
  where ci.emp_id = v_emp
  limit 1;

  if excluded_type = 'תפעול'
     or (excluded_type = 'הכשרה'
       and (s.training_schedule_id is not null
         or normalized_name = regexp_replace(lower('הכשרת בסיס'), '\s+', '', 'g'))) then
    destination_address := nullif(btrim(s.destination_address_snapshot), '');

    if destination_address is null then
      return jsonb_build_object(
        'eligible', false,
        'source_id', s.id,
        'reason', case
          when excluded_type = 'הכשרה' then 'training_destination_missing'
          else 'operation_destination_missing'
        end
      );
    end if;

    destination_key := case
      when excluded_type = 'הכשרה' and s.training_schedule_id is not null
        then 'training_schedule:' || s.training_schedule_id::text
      when excluded_type = 'הכשרה' then 'training:base_training'
      else 'operation:' || lower(btrim(coalesce(s.activity_name_snapshot, '')))
    end;

    fingerprint := encode(
      digest(
        concat_ws('|', v_emp,
          lower(regexp_replace(coalesce(instructor_address, ''), '\s+', ' ', 'g')),
          destination_key,
          lower(regexp_replace(destination_address, '\s+', ' ', 'g')),
          'DRIVE'),
        'sha256'),
      'hex');

    return jsonb_build_object(
      'eligible', true,
      'source_id', s.id,
      'emp_id', v_emp,
      'activity_row_id', null,
      'school_id', s.school_id,
      'school_name', coalesce(s.school_name_snapshot, ''),
      'origin_address', instructor_address,
      'destination_address', destination_address,
      'origin_entity_key', 'instructor:' || v_emp,
      'destination_entity_key', destination_key,
      'fingerprint', fingerprint,
      'report_date', s.report_date,
      'context_error', case
        when instructor_address is null then 'instructor_address_missing'
        else null
      end
    );
  end if;

  -- Other training records do not have a trusted fixed destination.
  if excluded_type = 'הכשרה' then
    return jsonb_build_object('eligible', false, 'source_id', s.id);
  end if;

  if s.course_business_identity is not null then
    -- School destination belongs to the business activity, not an arbitrary class row.
    if s.school_id is null or s.course_dashboard_sources is distinct from
      attendance_private.course_sources(v_emp,s.report_date,s.course_business_identity) then
      return jsonb_build_object('eligible',false,'source_id',s.id);
    end if;
  else
  if s.activity_row_id is null or s.school_id is null then
    return jsonb_build_object('eligible', false, 'source_id', s.id);
  end if;

  select *
    into a
  from public.activities
  where row_id = s.activity_row_id
  limit 1;

  if not found or not (a.emp_id::text = v_emp::text or a.emp_id_2::text = v_emp::text) then
    return jsonb_build_object('eligible', false, 'source_id', s.id);
  end if;

  valid_school := a.school_id = s.school_id or exists (
    select 1
    from public.activity_schools x
    where x.activity_id::text = a.row_id::text
      and x.school_id = s.school_id
  );
  if not valid_school then
    raise exception 'attendance_destination_invalid' using errcode = '42501';
  end if;

  end if;

  select coalesce(
           nullif(btrim(cs.address), ''),
           nullif(btrim(sc.institution_address), ''),
           nullif(btrim(sc.mailing_address), '')
         ),
         sc.school_name
    into destination_address, school_name
  from public.schools sc
  left join public.contacts_schools cs on cs.school_id = sc.id
  where sc.id = s.school_id
  limit 1;

  fingerprint := encode(
    digest(
      concat_ws('|', v_emp,
        lower(regexp_replace(coalesce(instructor_address, ''), '\s+', ' ', 'g')),
        coalesce(s.course_business_identity::text,a.row_id),
        s.school_id,
        lower(regexp_replace(coalesce(destination_address, ''), '\s+', ' ', 'g')),
        'DRIVE'),
      'sha256'),
    'hex');

  return jsonb_build_object(
    'eligible', true,
    'source_id', s.id,
    'emp_id', v_emp,
    'activity_row_id', a.row_id,
    'school_id', s.school_id,
    'school_name', coalesce(school_name, s.school_name_snapshot, ''),
    'origin_address', instructor_address,
    'destination_address', destination_address,
    'origin_entity_key', 'instructor:' || v_emp,
    'destination_entity_key', 'school_id:' || s.school_id,
    'fingerprint', fingerprint,
    'report_date', s.report_date,
    'context_error', case
      when instructor_address is null then 'instructor_address_missing'
      when destination_address is null then 'destination_address_missing'
      else null
    end
  );
end $$;
