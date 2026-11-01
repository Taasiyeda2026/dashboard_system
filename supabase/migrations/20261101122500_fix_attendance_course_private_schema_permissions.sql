-- Fix instructor attendance save error 42501; keep attendance_private isolated.
-- Retain existing course source verification and pay/approval business rules.

-- Invoker-only helper, callable only through the existing secured course-assignment
-- trigger. No privileges are granted on the private schema to API users.
create or replace function attendance_private.normalize_course_paid_hours(
  p_row public.attendance_records,
  p_is_update boolean
)
returns public.attendance_records
language plpgsql
security invoker
set search_path = ''
as $course_normalize$
declare
  v_source jsonb;
  v_work jsonb;
begin
  if p_row.activity_type is distinct from 'קורס'
     or p_row.generation_kind is not null
     or jsonb_typeof(p_row.course_dashboard_sources) is distinct from 'array'
     or jsonb_array_length(p_row.course_dashboard_sources) <> 1 then
    return p_row;
  end if;

  v_source := p_row.course_dashboard_sources->0;
  if v_source->>'activity_type' is distinct from 'course'
     or v_source->>'report_date' is distinct from p_row.report_date::text
     or v_source->>'resolved_emp_id' is distinct from p_row.emp_id::text
     or coalesce(v_source->>'start_time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     or coalesce(v_source->>'end_time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    return p_row;
  end if;

  v_work := attendance_private.course_work(p_row.course_dashboard_sources);
  if v_work is null or (v_work->>'paid_minutes')::integer is distinct from 120 then
    return p_row;
  end if;

  -- Do not rewrite approved reports or already approved/locked months.
  if p_is_update and exists (
    select 1 from public.attendance_manager_record_reviews r
    where r.record_id = p_row.id and r.status = 'approved'
  ) then
    return p_row;
  end if;
  if exists (
    select 1 from public.attendance_month_approvals m
    where m.emp_id = p_row.emp_id
      and m.month_key = to_char(p_row.report_date,'YYYY-MM')
      and (m.manager_approved_at is not null or m.status = 'locked')
  ) then
    return p_row;
  end if;
  p_row.total_hours := 2;
  return p_row;
end
$course_normalize$;

revoke all on function attendance_private.normalize_course_paid_hours(public.attendance_records, boolean)
  from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.av2_guard_course_date_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
         and (old.total_hours is not distinct from new.total_hours
           or (old.course_dashboard_sources is not null
               and new.total_hours is not distinct from
                 (attendance_private.course_work(old.course_dashboard_sources)->>'total_hours')::numeric))
         and old.activity_name_snapshot is not distinct from new.activity_name_snapshot
         and old.meeting_no is not distinct from new.meeting_no)) then
      new := attendance_private.normalize_course_paid_hours(new, tg_op = 'UPDATE');
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
    new := attendance_private.normalize_course_paid_hours(new, tg_op = 'UPDATE');
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
$function$

-- Retire the separate unprivileged trigger that caused 42501.
drop trigger if exists trg_attendance_course_paid_hours on public.attendance_records;
drop function if exists attendance_private.sync_course_paid_hours();
