-- Resolve session number from one or more linked dashboard source rows without changing stored attendance records.
CREATE OR REPLACE FUNCTION public.get_payroll_attendance_records(p_employee_ids bigint[] DEFAULT NULL::bigint[], p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT NULL::date)
 RETURNS TABLE(record_id uuid, employee_id text, employee_name text, employment_type text, team text, attendance_date date, start_time time without time zone, end_time time without time zone, work_hours numeric, activity_type text, school_name text, municipality text, program_name text, session_number text, total_expenses numeric, kilometers numeric, expenses_details text, notes text, activity_row_id text, activity_numeric_id bigint, activity_no text, activity_season text, authority_id bigint, school_id bigint, semel_mosad bigint, public_transport boolean, public_transport_cost numeric, attachments jsonb, training_mode text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    coalesce(ar.meeting_no::text, (
      select string_agg(number_text, ', ' order by number_text::numeric)
      from (
        select distinct item->>'meeting_no' as number_text
        from jsonb_array_elements(coalesce(ar.course_dashboard_sources, '[]'::jsonb)) item
        where jsonb_typeof(item->'meeting_no') = 'number'
      ) linked_meetings
    ), ''),
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
    ), '[]'::jsonb),
    ar.training_mode::text
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
      )
    )
  order by ar.report_date, ar.start_time, ar.emp_id;
end
$function$
;
