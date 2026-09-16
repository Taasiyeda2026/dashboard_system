-- Attendance control parity: expose public transport + attachment metadata to
-- payroll/attendance control readers, allow authorized managers to update PT
-- fields through the existing update RPC, grant activities_manager the control
-- capability flag, and allow scoped Storage SELECT for viewing attachments.
-- Does not change reopen-reason persistence, lifecycle locks, or broaden RLS
-- write access beyond the existing security-definer payroll update path.

-- 1) Role template alignment for existing activities_manager users.
-- Permissions live in users.permissions jsonb (no view_attendance_control column).
update public.users
set
  permissions = jsonb_set(
    coalesce(permissions, '{}'::jsonb),
    '{view_attendance_control}',
    '"yes"'::jsonb,
    true
  ),
  updated_at = now()
where lower(trim(coalesce(role, ''))) = 'activities_manager'
  and lower(trim(coalesce(permissions->>'view_attendance_control', 'no'))) not in ('yes', 'true', '1');

-- PostgreSQL cannot change RETURNS TABLE / OUT columns via CREATE OR REPLACE.
-- Drop the exact existing signature first (no CASCADE; no registered dependents).
drop function if exists public.get_payroll_attendance_records(bigint[], date, date);

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
  semel_mosad bigint,
  public_transport boolean,
  public_transport_cost numeric,
  attachments jsonb
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
    ar.semel_mosad,
    coalesce(ar.public_transport, false),
    coalesce(ar.public_transport_cost, 0),
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', att.id,
          'fileName', att.file_name,
          'storagePath', att.storage_path,
          'fileType', att.file_type,
          'fileSize', att.file_size
        )
        order by att.file_name, att.id
      )
      from public.attendance_record_attachments att
      where att.record_id = ar.id
    ), '[]'::jsonb)
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

revoke all on function public.get_payroll_attendance_records(bigint[], date, date) from public, anon, authenticated;
grant execute on function public.get_payroll_attendance_records(bigint[], date, date) to authenticated;

comment on function public.get_payroll_attendance_records(bigint[], date, date) is
  'Payroll attendance bridge over Attendance V2. Includes public_transport fields and attachment metadata. Manager roles remain scoped to direct_manager roster.';

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

  -- Enforce single travel reimbursement mode (matches attendance_records_single_travel_reimbursement).
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

revoke all on function public.update_payroll_attendance_record(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.update_payroll_attendance_record(uuid, jsonb) to authenticated;

-- View-only storage access for control roles over instructor attachment paths:
-- path convention: {emp_id}/{record_id}/{file}
drop policy if exists attendance_attachments_storage_select_control on storage.objects;
create policy attendance_attachments_storage_select_control
on storage.objects
for select
to authenticated
using (
  bucket_id = 'attendance-attachments'
  and exists (
    select 1
    from public.users u
    where u.auth_user_id = auth.uid()
      and u.is_active = true
      and (
        lower(trim(coalesce(u.role, ''))) in ('admin', 'operation_manager', 'finance')
        or (
          lower(trim(coalesce(u.role, ''))) in ('activities_manager', 'manager', 'instructor_manager')
          and exists (
            select 1
            from public.contacts_instructors ci
            where ci.emp_id::text = (storage.foldername(storage.objects.name))[1]
              and lower(trim(coalesce(ci.active::text, ''))) not in ('no', 'false', '0', 'לא')
              and lower(trim(coalesce(ci.direct_manager, ''))) = lower(trim(coalesce(
                nullif(trim(coalesce(u.full_name, '')), ''),
                nullif(trim(coalesce(u.name, '')), ''),
                nullif(trim(coalesce(u.username, '')), '')
              )))
          )
        )
      )
  )
);
