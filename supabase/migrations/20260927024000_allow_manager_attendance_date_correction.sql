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

  if p_fields ? 'sessionNumber' then
    v_meeting_text := trim(coalesce(p_fields->>'sessionNumber', ''));
    if v_meeting_text <> '' and v_meeting_text !~ '^[0-9]+$' then
      raise exception 'payroll_attendance_meeting_invalid' using errcode = '22023';
    end if;
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
    expense_details = case when p_fields ? 'expensesDetails' then trim(coalesce(p_fields->>'expensesDetails', '')) else ar.expense_details end,
    notes = case when p_fields ? 'notes' then trim(coalesce(p_fields->>'notes', '')) else ar.notes end,
    updated_at = now()
  where ar.id = p_record_id
  returning * into v_row;

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
  'Manager/admin attendance correction write-back. Supports date, hours, activity data, expenses and travel fields while preserving role scope.';
