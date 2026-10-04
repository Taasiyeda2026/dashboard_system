-- Allow a manager/admin to add a forgotten attendance row only while the
-- employee month is actively submitted for manager review. The inserted row
-- intentionally has no manager review; monthly finalization will remain blocked
-- until the normal per-record review is completed.

-- The instructor insert trigger normally replaces NEW.emp_id with the signed-in
-- instructor's own employee id. Manager review needs a narrowly-scoped bypass so
-- the SECURITY DEFINER RPC can preserve the reviewed employee id instead.
create or replace function public.av2_attendance_record_before_insert()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_emp_id bigint;
  v_internal_compensation_write boolean := coalesce(current_setting('app.av2_compensation_write', true), '') = '1';
  v_manager_review_write boolean := coalesce(current_setting('app.av2_manager_attendance_write', true), '') = '1';
begin
  if v_internal_compensation_write
     and new.generation_kind = 'travel_time_cancellation'
     and new.source_attendance_record_id is not null then
    if new.emp_id is null or not exists (
      select 1
      from public.attendance_records source_row
      where source_row.id = new.source_attendance_record_id
        and source_row.emp_id = new.emp_id
        and source_row.generation_kind is null
    ) then
      raise exception 'Invalid generated travel cancellation source';
    end if;
    return new;
  end if;

  if v_manager_review_write then
    if new.emp_id is null
       or new.generation_kind is not null
       or new.source_attendance_record_id is not null
       or not public.attendance_manager_can_review_employee(new.emp_id)
       or not exists (
         select 1
         from public.attendance_month_approvals ama
         where ama.emp_id = new.emp_id
           and ama.month_key = to_char(new.report_date, 'YYYY-MM')
           and ama.status = 'submitted'
       ) then
      raise exception 'payroll_attendance_permission_denied' using errcode = '42501';
    end if;
    return new;
  end if;

  select emp_id::bigint
    into v_emp_id
  from public.users
  where auth_user_id = auth.uid()
  limit 1;

  if v_emp_id is null then
    raise exception 'No authenticated user or missing users mapping';
  end if;

  new.emp_id := v_emp_id;
  return new;
end;
$function$;

create or replace function public.create_manager_attendance_record(
  p_employee_id bigint,
  p_fields jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_report_date date;
  v_start_time time;
  v_end_time time;
  v_total_hours numeric;
  v_activity_type text;
  v_status text;
  v_meeting_no integer;
  v_expenses numeric := 0;
  v_kilometers numeric := 0;
  v_public_transport boolean := false;
  v_public_transport_cost numeric := 0;
  v_record_id uuid;
  v_month_key text;
begin
  if p_employee_id is null or p_employee_id <= 0 then
    raise exception 'invalid_employee_id' using errcode = '22023';
  end if;

  if coalesce(jsonb_typeof(p_fields), '') <> 'object' then
    raise exception 'invalid_attendance_fields' using errcode = '22023';
  end if;

  if not public.attendance_manager_can_review_employee(p_employee_id) then
    raise exception 'payroll_attendance_permission_denied' using errcode = '42501';
  end if;

  if coalesce(trim(p_fields->>'attendanceDate'), '') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])-([0-2][0-9]|3[0-1])$' then
    raise exception 'invalid_attendance_date' using errcode = '22023';
  end if;
  v_report_date := trim(p_fields->>'attendanceDate')::date;
  v_month_key := to_char(v_report_date, 'YYYY-MM');

  select coalesce(nullif(trim(ama.status), ''), 'open')
  into v_status
  from public.attendance_month_approvals ama
  where ama.emp_id = p_employee_id
    and ama.month_key = v_month_key
  limit 1
  for update;

  if not found or v_status <> 'submitted' then
    raise exception 'attendance_month_not_in_manager_review' using errcode = '55000';
  end if;

  if public.av2_attendance_month_is_closed(p_employee_id, v_report_date) then
    raise exception 'attendance_month_locked' using errcode = '55000';
  end if;

  if coalesce(trim(p_fields->>'startTime'), '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     or coalesce(trim(p_fields->>'endTime'), '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'invalid_attendance_time' using errcode = '22023';
  end if;
  v_start_time := trim(p_fields->>'startTime')::time;
  v_end_time := trim(p_fields->>'endTime')::time;
  if v_end_time <= v_start_time then
    raise exception 'invalid_attendance_time_range' using errcode = '22023';
  end if;
  v_total_hours := round((extract(epoch from (v_end_time - v_start_time)) / 3600.0)::numeric, 2);

  v_activity_type := nullif(trim(coalesce(p_fields->>'activityType', '')), '');
  if v_activity_type is null then
    raise exception 'attendance_activity_type_required' using errcode = '22023';
  end if;

  if nullif(trim(coalesce(p_fields->>'sessionNumber', '')), '') is not null then
    if trim(p_fields->>'sessionNumber') !~ '^[1-9][0-9]*$' then
      raise exception 'invalid_attendance_session_number' using errcode = '22023';
    end if;
    v_meeting_no := trim(p_fields->>'sessionNumber')::integer;
  end if;

  if nullif(trim(coalesce(p_fields->>'totalExpenses', '')), '') is not null then
    if trim(p_fields->>'totalExpenses') !~ '^[0-9]+([.][0-9]+)?$' then
      raise exception 'invalid_attendance_expenses' using errcode = '22023';
    end if;
    v_expenses := trim(p_fields->>'totalExpenses')::numeric;
  end if;

  if nullif(trim(coalesce(p_fields->>'kilometers', '')), '') is not null then
    if trim(p_fields->>'kilometers') !~ '^[0-9]+([.][0-9]+)?$' then
      raise exception 'invalid_attendance_kilometers' using errcode = '22023';
    end if;
    v_kilometers := trim(p_fields->>'kilometers')::numeric;
  end if;

  if p_fields ? 'publicTransport' then
    if lower(trim(coalesce(p_fields->>'publicTransport', ''))) not in ('true', 'false') then
      raise exception 'invalid_attendance_public_transport' using errcode = '22023';
    end if;
    v_public_transport := lower(trim(p_fields->>'publicTransport')) = 'true';
  end if;

  if nullif(trim(coalesce(p_fields->>'publicTransportCost', '')), '') is not null then
    if trim(p_fields->>'publicTransportCost') !~ '^[0-9]+([.][0-9]+)?$' then
      raise exception 'invalid_attendance_public_transport_cost' using errcode = '22023';
    end if;
    v_public_transport_cost := trim(p_fields->>'publicTransportCost')::numeric;
  end if;

  if v_public_transport then
    v_kilometers := 0;
  else
    v_public_transport_cost := 0;
  end if;

  -- Keep the same reimbursement normalization used by instructor reporting.
  if v_activity_type in ('זום', 'מקוון') then
    v_public_transport := false;
    v_public_transport_cost := 0;
    v_kilometers := 0;
  end if;

  perform set_config('app.av2_manager_attendance_write', '1', true);

  insert into public.attendance_records (
    emp_id,
    report_date,
    start_time,
    end_time,
    total_hours,
    activity_type,
    meeting_no,
    authority_name_snapshot,
    school_name_snapshot,
    program_name,
    program_name_snapshot,
    roundtrip_km,
    public_transport,
    public_transport_cost,
    expenses,
    expense_details,
    notes,
    updated_at
  ) values (
    p_employee_id,
    v_report_date,
    v_start_time,
    v_end_time,
    v_total_hours,
    v_activity_type,
    v_meeting_no,
    nullif(trim(coalesce(p_fields->>'municipality', '')), ''),
    nullif(trim(coalesce(p_fields->>'schoolName', '')), ''),
    nullif(trim(coalesce(p_fields->>'programName', '')), ''),
    nullif(trim(coalesce(p_fields->>'programName', '')), ''),
    v_kilometers,
    v_public_transport,
    v_public_transport_cost,
    v_expenses,
    case when v_expenses > 0 then nullif(trim(coalesce(p_fields->>'expensesDetails', '')), '') else null end,
    nullif(trim(coalesce(p_fields->>'notes', '')), ''),
    now()
  )
  returning id into v_record_id;

  return jsonb_build_object(
    'success', true,
    'recordId', v_record_id,
    'employeeId', p_employee_id::text,
    'monthKey', v_month_key,
    'requiresManagerReview', true
  );
end;
$function$;

revoke all on function public.create_manager_attendance_record(bigint, jsonb) from public;
revoke execute on function public.create_manager_attendance_record(bigint, jsonb) from anon;
grant execute on function public.create_manager_attendance_record(bigint, jsonb) to authenticated;

comment on function public.create_manager_attendance_record(bigint, jsonb) is
  'Creates a missing employee attendance row during submitted manager review only; the new row must still receive a normal manager record approval before monthly finalization.';
