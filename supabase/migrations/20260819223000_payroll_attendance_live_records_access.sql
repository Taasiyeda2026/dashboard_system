-- Allow direct managers to read live attendance_records for payroll control
-- without waiting for month submission. Aligns record access with
-- get_payroll_attendance_month_statuses manager/instructor_manager roles.

create or replace function public.get_payroll_attendance_records(
  p_employee_ids bigint[] default null,
  p_from_date date default null,
  p_to_date date default null
)
returns table (
  record_id uuid,
  employee_id text,
  employee_name text,
  employment_type text,
  team text,
  attendance_date date,
  start_time time,
  end_time time,
  work_hours numeric,
  activity_type text,
  school_name text,
  municipality text,
  program_name text,
  session_number text,
  total_expenses numeric,
  kilometers numeric,
  expenses_details text,
  notes text,
  activity_row_id text,
  activity_numeric_id bigint,
  activity_no text,
  activity_season text,
  authority_id bigint,
  school_id bigint,
  semel_mosad bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  v_own_name text;
begin
  select
    lower(trim(coalesce(u.role, ''))),
    coalesce(nullif(trim(coalesce(u.full_name, '')), ''), nullif(trim(coalesce(u.name, '')), ''), nullif(trim(coalesce(u.username, '')), ''))
  into v_role, v_own_name
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.is_active = true
  limit 1;

  if v_role is null then
    raise exception 'payroll_attendance_auth_required' using errcode = '42501';
  end if;

  if v_role not in ('admin', 'operation_manager', 'activities_manager', 'finance', 'manager', 'instructor_manager') then
    raise exception 'payroll_attendance_permission_denied' using errcode = '42501';
  end if;

  return query
  select
    ar.id,
    ar.emp_id::text,
    coalesce(ci.full_name, ar.emp_id::text),
    coalesce(ci.employment_type, ''),
    coalesce(ci.direct_manager, ''),
    ar.report_date,
    ar.start_time,
    ar.end_time,
    ar.total_hours,
    ar.activity_type,
    coalesce(ar.school_name_snapshot, ''),
    coalesce(ar.authority_name_snapshot, ''),
    coalesce(nullif(ar.program_name_snapshot, ''), nullif(ar.program_name, ''), nullif(ar.activity_name_snapshot, ''), ''),
    coalesce(ar.meeting_no::text, ''),
    coalesce(ar.expenses, 0),
    coalesce(ar.roundtrip_km, 0),
    coalesce(ar.expense_details, ''),
    coalesce(ar.notes, ''),
    coalesce(ar.activity_row_id, ''),
    ar.activity_id,
    coalesce(ar.activity_no, ''),
    coalesce(ar.activity_season, ''),
    ar.authority_id,
    ar.school_id,
    ar.semel_mosad
  from public.attendance_records ar
  left join public.contacts_instructors ci on ci.emp_id = ar.emp_id
  where (p_employee_ids is null or ar.emp_id = any(p_employee_ids))
    and (p_from_date is null or ar.report_date >= p_from_date)
    and (p_to_date is null or ar.report_date <= p_to_date)
    and (
      v_role in ('admin', 'operation_manager', 'finance')
      or (
        v_role in ('activities_manager', 'manager', 'instructor_manager')
        and lower(trim(coalesce(ci.direct_manager, ''))) = lower(trim(coalesce(v_own_name, '')))
        and lower(trim(coalesce(ci.active::text, ''))) not in ('no', 'false', '0', 'לא')
      )
    )
  order by ar.report_date, ar.start_time, ar.emp_id;
end
$$;

create or replace function public.update_payroll_attendance_record(
  p_record_id uuid,
  p_fields jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_own_name text;
  v_row public.attendance_records%rowtype;
  v_manager_name text;
  v_allowed boolean := false;
  v_meeting_text text;
begin
  select
    lower(trim(coalesce(u.role, ''))),
    coalesce(nullif(trim(coalesce(u.full_name, '')), ''), nullif(trim(coalesce(u.name, '')), ''), nullif(trim(coalesce(u.username, '')), ''))
  into v_role, v_own_name
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.is_active = true
  limit 1;

  if v_role is null then
    raise exception 'payroll_attendance_auth_required' using errcode = '42501';
  end if;

  select * into v_row
  from public.attendance_records
  where id = p_record_id;

  if not found then
    raise exception 'payroll_attendance_record_not_found' using errcode = '22023';
  end if;

  if v_role in ('admin', 'operation_manager') then
    v_allowed := true;
  elsif v_role in ('activities_manager', 'manager', 'instructor_manager') then
    select ci.direct_manager into v_manager_name
    from public.contacts_instructors ci
    where ci.emp_id = v_row.emp_id
      and lower(trim(coalesce(ci.active::text, ''))) not in ('no', 'false', '0', 'לא')
    limit 1;
    v_allowed := lower(trim(coalesce(v_manager_name, ''))) = lower(trim(coalesce(v_own_name, '')));
  end if;

  if not coalesce(v_allowed, false) then
    raise exception 'payroll_attendance_permission_denied' using errcode = '42501';
  end if;

  if p_fields ? 'sessionNumber' then
    v_meeting_text := trim(coalesce(p_fields->>'sessionNumber', ''));
    if v_meeting_text <> '' and v_meeting_text !~ '^[0-9]+$' then
      raise exception 'payroll_attendance_meeting_invalid' using errcode = '22023';
    end if;
  end if;

  update public.attendance_records ar
  set
    start_time = case when p_fields ? 'startTime' then (p_fields->>'startTime')::time else ar.start_time end,
    end_time = case when p_fields ? 'endTime' then (p_fields->>'endTime')::time else ar.end_time end,
    total_hours = case when p_fields ? 'workHours' then (p_fields->>'workHours')::numeric else ar.total_hours end,
    activity_type = case when p_fields ? 'activityType' then coalesce(nullif(trim(p_fields->>'activityType'), ''), ar.activity_type) else ar.activity_type end,
    school_name_snapshot = case when p_fields ? 'schoolName' then trim(coalesce(p_fields->>'schoolName', '')) else ar.school_name_snapshot end,
    authority_name_snapshot = case when p_fields ? 'municipality' then trim(coalesce(p_fields->>'municipality', '')) else ar.authority_name_snapshot end,
    program_name = case when p_fields ? 'programName' then trim(coalesce(p_fields->>'programName', '')) else ar.program_name end,
    program_name_snapshot = case when p_fields ? 'programName' then trim(coalesce(p_fields->>'programName', '')) else ar.program_name_snapshot end,
    meeting_no = case when p_fields ? 'sessionNumber' then nullif(v_meeting_text, '')::integer else ar.meeting_no end,
    expenses = case when p_fields ? 'totalExpenses' then nullif(trim(coalesce(p_fields->>'totalExpenses', '')), '')::numeric else ar.expenses end,
    roundtrip_km = case when p_fields ? 'kilometers' then nullif(trim(coalesce(p_fields->>'kilometers', '')), '')::numeric else ar.roundtrip_km end,
    expense_details = case when p_fields ? 'expensesDetails' then trim(coalesce(p_fields->>'expensesDetails', '')) else ar.expense_details end,
    notes = case when p_fields ? 'notes' then trim(coalesce(p_fields->>'notes', '')) else ar.notes end,
    updated_at = now()
  where ar.id = p_record_id
  returning * into v_row;

  return jsonb_build_object(
    'success', true,
    'recordId', v_row.id,
    'employeeId', v_row.emp_id,
    'updatedAt', v_row.updated_at
  );
end
$$;

revoke all on function public.get_payroll_attendance_records(bigint[], date, date) from public, anon, authenticated;
revoke all on function public.update_payroll_attendance_record(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.get_payroll_attendance_records(bigint[], date, date) to authenticated;
grant execute on function public.update_payroll_attendance_record(uuid, jsonb) to authenticated;

comment on function public.get_payroll_attendance_records(bigint[], date, date) is
  'Payroll attendance bridge over Attendance V2 live records. Returns every saved attendance_records row in scope; month submission status is unrelated. Managers see only their direct instructor roster.';
