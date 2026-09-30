-- Restore the submitted-month mutation gate for team managers.
-- The original migration 20260927153000 exists in the repo and is covered by
-- unit tests, but was never recorded/applied on the live database, so
-- update_payroll_attendance_record / set_manager_attendance_record_review
-- currently allow team-manager writes before employee submission.
-- Admin / operation_manager keep their existing unrestricted correction path.

-- Team managers may mutate / approve attendance records only after the
-- employee submitted the month (attendance_month_approvals.status = submitted).
-- Admin / operation_manager keep their existing unrestricted correction path.

create or replace function public.attendance_manager_month_allows_mutation(
  p_emp_id bigint,
  p_report_date date
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  v_status text;
begin
  if p_emp_id is null or p_report_date is null then
    return false;
  end if;

  select lower(trim(coalesce(u.role, '')))
  into v_role
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.is_active = true
  limit 1;

  if v_role is null then
    return false;
  end if;

  -- Admin / operations retain existing correction and unlock flows.
  if v_role in ('admin', 'operation_manager') then
    return true;
  end if;

  select coalesce(nullif(trim(ama.status), ''), 'open')
  into v_status
  from public.attendance_month_approvals ama
  where ama.emp_id = p_emp_id
    and ama.month_key = to_char(p_report_date, 'YYYY-MM')
  limit 1;

  if not found then
    return false;
  end if;

  return v_status = 'submitted';
end;
$$;

revoke all on function public.attendance_manager_month_allows_mutation(bigint, date)
from public, anon, authenticated;

comment on function public.attendance_manager_month_allows_mutation(bigint, date) is
  'True when the caller may mutate/approve attendance for the employee month. Team managers require attendance_month_approvals.status = submitted; admin/operation_manager always allowed.';

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
  v_public_transport boolean;
  v_public_transport_cost numeric;
  v_kilometers numeric;
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

  if not public.attendance_manager_month_allows_mutation(v_row.emp_id, v_row.report_date) then
    raise exception 'attendance_month_not_submitted_for_manager_mutation' using errcode = '22023';
  end if;

  if p_fields ? 'sessionNumber' then
    v_meeting_text := trim(coalesce(p_fields->>'sessionNumber', ''));
    if v_meeting_text <> '' and v_meeting_text !~ '^[0-9]+$' then
      raise exception 'payroll_attendance_meeting_invalid' using errcode = '22023';
    end if;
  end if;

  if v_row.generation_kind = 'travel_time_cancellation' then
    perform set_config('app.av2_compensation_write', '1', true);
  end if;

  v_public_transport := case
    when p_fields ? 'publicTransport' then coalesce((p_fields->>'publicTransport')::boolean, false)
    else coalesce(v_row.public_transport, false)
  end;
  v_public_transport_cost := case
    when p_fields ? 'publicTransportCost' then coalesce(nullif(trim(coalesce(p_fields->>'publicTransportCost', '')), '')::numeric, 0)
    else coalesce(v_row.public_transport_cost, 0)
  end;
  v_kilometers := case
    when p_fields ? 'kilometers' then coalesce(nullif(trim(coalesce(p_fields->>'kilometers', '')), '')::numeric, 0)
    else coalesce(v_row.roundtrip_km, 0)
  end;

  if v_public_transport then
    v_kilometers := 0;
  else
    v_public_transport_cost := 0;
  end if;
  if coalesce(v_kilometers, 0) > 0 then
    v_public_transport := false;
    v_public_transport_cost := 0;
  end if;

  update public.attendance_records ar
  set
    report_date = case when p_fields ? 'attendanceDate' then (p_fields->>'attendanceDate')::date else ar.report_date end,
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
    roundtrip_km = case
      when p_fields ? 'kilometers' or p_fields ? 'publicTransport' or p_fields ? 'publicTransportCost'
        then v_kilometers
      else ar.roundtrip_km
    end,
    public_transport = case
      when p_fields ? 'publicTransport' or p_fields ? 'publicTransportCost' or p_fields ? 'kilometers'
        then v_public_transport
      else ar.public_transport
    end,
    public_transport_cost = case
      when p_fields ? 'publicTransport' or p_fields ? 'publicTransportCost' or p_fields ? 'kilometers'
        then greatest(coalesce(v_public_transport_cost, 0), 0)
      else ar.public_transport_cost
    end,
    expense_details = case
      when p_fields ? 'totalExpenses'
        and coalesce(nullif(trim(coalesce(p_fields->>'totalExpenses', '')), '')::numeric, 0) <= 0
        then ''
      when p_fields ? 'expensesDetails' then trim(coalesce(p_fields->>'expensesDetails', ''))
      else ar.expense_details
    end,
    notes = case when p_fields ? 'notes' then trim(coalesce(p_fields->>'notes', '')) else ar.notes end,
    updated_at = now()
  where ar.id = p_record_id
  returning * into v_row;

  if v_row.generation_kind is null and p_fields ? 'attendanceDate' then
    perform set_config('app.av2_compensation_write', '1', true);
    update public.attendance_records child
    set report_date = v_row.report_date,
        updated_at = now()
    where child.source_attendance_record_id = v_row.id
      and child.generation_kind = 'travel_time_cancellation';
  end if;

  if v_row.generation_kind = 'travel_time_cancellation' and p_fields ? 'workHours' then
    update public.attendance_travel_compensations c
    set final_cancellation_minutes = greatest(0, round(coalesce(v_row.total_hours, 0) * 60)::integer),
        manually_overridden = true,
        override_by = auth.uid(),
        override_at = now(),
        updated_at = now()
    where c.generated_attendance_record_id = v_row.id;
  end if;

  return jsonb_build_object(
    'success', true,
    'recordId', v_row.id,
    'employeeId', v_row.emp_id,
    'updatedAt', v_row.updated_at,
    'publicTransport', v_row.public_transport,
    'publicTransportCost', v_row.public_transport_cost,
    'kilometers', v_row.roundtrip_km
  );
end
$$;

comment on function public.update_payroll_attendance_record(uuid, jsonb) is
  'Manager/admin attendance correction write-back. Team managers require a submitted employee month; admin/operation_manager keep unrestricted correction access.';

create or replace function public.set_manager_attendance_record_review(
  p_record_id uuid,
  p_approved boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.attendance_records%rowtype;
  v_name text;
  v_review public.attendance_manager_record_reviews%rowtype;
begin
  if p_record_id is null then
    raise exception 'attendance_record_review_invalid_record' using errcode = '22023';
  end if;

  select * into v_row
  from public.attendance_records
  where id = p_record_id;

  if not found then
    raise exception 'payroll_attendance_record_not_found' using errcode = '22023';
  end if;

  if not public.attendance_manager_can_review_employee(v_row.emp_id) then
    raise exception 'payroll_attendance_permission_denied' using errcode = '42501';
  end if;

  if not public.attendance_manager_month_allows_mutation(v_row.emp_id, v_row.report_date) then
    raise exception 'attendance_month_not_submitted_for_manager_mutation' using errcode = '22023';
  end if;

  select coalesce(
    nullif(trim(coalesce(u.full_name, '')), ''),
    nullif(trim(coalesce(u.name, '')), ''),
    nullif(trim(coalesce(u.username, '')), ''),
    ''
  )
  into v_name
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.is_active = true
  limit 1;

  if not coalesce(p_approved, false) then
    delete from public.attendance_manager_record_reviews
    where record_id = p_record_id;
    return jsonb_build_object('success', true, 'recordId', p_record_id, 'approved', false);
  end if;

  insert into public.attendance_manager_record_reviews (
    record_id,
    employee_id,
    month_key,
    status,
    approved_record_updated_at,
    approved_by_user_id,
    approved_by_name,
    approved_at,
    updated_at
  )
  values (
    v_row.id,
    v_row.emp_id,
    to_char(v_row.report_date, 'YYYY-MM'),
    'approved',
    v_row.updated_at,
    auth.uid(),
    coalesce(v_name, ''),
    now(),
    now()
  )
  on conflict (record_id) do update
  set
    employee_id = excluded.employee_id,
    month_key = excluded.month_key,
    status = 'approved',
    approved_record_updated_at = excluded.approved_record_updated_at,
    approved_by_user_id = excluded.approved_by_user_id,
    approved_by_name = excluded.approved_by_name,
    approved_at = excluded.approved_at,
    updated_at = now()
  returning * into v_review;

  return jsonb_build_object(
    'success', true,
    'approved', true,
    'recordId', v_review.record_id,
    'employeeId', v_review.employee_id,
    'monthKey', v_review.month_key,
    'approvedByName', v_review.approved_by_name,
    'approvedAt', v_review.approved_at,
    'recordUpdatedAt', v_review.approved_record_updated_at
  );
end;
$$;

comment on function public.set_manager_attendance_record_review(uuid, boolean) is
  'Approves or clears one attendance record review. Team managers require a submitted employee month; admin/operation_manager keep unrestricted access.';
