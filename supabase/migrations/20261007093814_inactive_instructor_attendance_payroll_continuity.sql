-- Preserve attendance/payroll continuity when an instructor becomes inactive.
-- Applied to production as Supabase migration 20261007093814.
-- Current employment activity controls future operational work, not historical attendance/payroll review.
-- Inactive instructors remain manager-visible only through existing attendance/workflow rows and direct-manager scope.

CREATE OR REPLACE FUNCTION public.attendance_manager_can_review_employee(p_employee_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text;
  v_own_name text;
  v_manager_name text;
begin
  select
    lower(trim(coalesce(u.role, ''))),
    coalesce(
      nullif(trim(coalesce(u.full_name, '')), ''),
      nullif(trim(coalesce(u.name, '')), ''),
      nullif(trim(coalesce(u.username, '')), '')
    )
  into v_role, v_own_name
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.is_active = true
  limit 1;

  if v_role is null then return false; end if;
  if v_role in ('admin', 'operation_manager') then return true; end if;
  if v_role not in ('activities_manager', 'manager', 'instructor_manager') then return false; end if;

  select coalesce(ci.direct_manager, '')
  into v_manager_name
  from public.contacts_instructors ci
  where ci.emp_id = p_employee_id
  limit 1;

  if not found then return false; end if;
  return lower(trim(coalesce(v_manager_name, ''))) = lower(trim(coalesce(v_own_name, '')));
end;
$function$\n\nCREATE OR REPLACE FUNCTION public.get_payroll_attendance_records(p_employee_ids bigint[] DEFAULT NULL::bigint[], p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT NULL::date)
 RETURNS TABLE(record_id uuid, employee_id text, employee_name text, employment_type text, team text, attendance_date date, start_time time without time zone, end_time time without time zone, work_hours numeric, activity_type text, school_name text, municipality text, program_name text, session_number text, total_expenses numeric, kilometers numeric, expenses_details text, notes text, activity_row_id text, activity_numeric_id bigint, activity_no text, activity_season text, authority_id bigint, school_id bigint, semel_mosad bigint, public_transport boolean, public_transport_cost numeric, attachments jsonb)
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
      )
    )
  order by ar.report_date, ar.start_time, ar.emp_id;
end
$function$\n\nCREATE OR REPLACE FUNCTION public.update_payroll_attendance_record(p_record_id uuid, p_fields jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$\n\nCREATE OR REPLACE FUNCTION public.get_manager_attendance_review_snapshot(p_employee_id bigint, p_month_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_role text;
  v_own_name text;
  v_manager_name text;
  v_employee_active text;
  v_from date;
  v_to date;

  v_records jsonb := '[]'::jsonb;
  v_travel jsonb := '[]'::jsonb;
  v_locations jsonb := '[]'::jsonb;
  v_activities jsonb := '[]'::jsonb;
  v_contacts jsonb := '[]'::jsonb;
  v_travel_cache jsonb := '[]'::jsonb;
  v_expenses jsonb := '[]'::jsonb;
  v_approvals jsonb := '[]'::jsonb;
  v_workflow jsonb := '[]'::jsonb;
  v_schools jsonb := '[]'::jsonb;
  v_authorities jsonb := '[]'::jsonb;
  v_proposal_group_aliases jsonb := '[]'::jsonb;
  v_training_schedule jsonb := '[]'::jsonb;

  v_activity_school_ids bigint[] := '{}'::bigint[];
  v_activity_authority_ids bigint[] := '{}'::bigint[];
  v_attendance_school_ids bigint[] := '{}'::bigint[];
  v_attendance_authority_ids bigint[] := '{}'::bigint[];
  v_school_ids bigint[] := '{}'::bigint[];
  v_authority_ids bigint[] := '{}'::bigint[];
  v_addresses text[] := '{}'::text[];
  v_home_address text := '';
begin
  if p_employee_id is null or p_employee_id <= 0 then
    raise exception 'invalid_employee_id' using errcode = '22023';
  end if;

  if p_month_key is null or p_month_key !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_month_key' using errcode = '22023';
  end if;

  v_from := (p_month_key || '-01')::date;
  v_to := (v_from + interval '1 month - 1 day')::date;

  select
    lower(trim(coalesce(u.role, ''))),
    coalesce(
      nullif(trim(coalesce(u.full_name, '')), ''),
      nullif(trim(coalesce(u.name, '')), ''),
      nullif(trim(coalesce(u.username, '')), '')
    )
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

  select
    coalesce(ci.direct_manager, ''),
    coalesce(ci.active, ''),
    coalesce(ci.address, '')
  into v_manager_name, v_employee_active, v_home_address
  from public.contacts_instructors ci
  where ci.emp_id = p_employee_id
  limit 1;

  if not found then
    raise exception 'attendance_employee_not_found' using errcode = '22023';
  end if;

  if v_role in ('activities_manager', 'manager', 'instructor_manager') then
    if lower(trim(coalesce(v_manager_name, ''))) <> lower(trim(coalesce(v_own_name, ''))) then
      raise exception 'payroll_attendance_permission_denied' using errcode = '42501';
    end if;
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.attendance_date, r.start_time, r.record_id), '[]'::jsonb)
  into v_records
  from public.get_payroll_attendance_records(array[p_employee_id], v_from, v_to) r;

  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
  into v_travel
  from public.get_payroll_attendance_travel_compensations(array[p_employee_id], v_from, v_to) t;

  select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb)
  into v_locations
  from public.get_payroll_attendance_location_contexts(array[p_employee_id], v_from, v_to) l;

  with scoped as (
    select a.*
    from public.activities a
    where (a.emp_id = p_employee_id or trim(coalesce(a.emp_id_2, '')) = p_employee_id::text)
      and (
        (
          a.start_date is not null
          and a.start_date <= v_to
          and coalesce(a.end_date, a.start_date) >= v_from
        )
        or exists (
          select 1
          from jsonb_each_text(to_jsonb(a)) kv
          where kv.key ~ '^date_([1-9]|[12][0-9]|3[0-5])$'
            and kv.value ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
            and kv.value::date between v_from and v_to
        )
      )
  )
  select
    coalesce(jsonb_agg(to_jsonb(s) order by s.start_date nulls last, s.row_id), '[]'::jsonb),
    coalesce(array_agg(distinct s.school_id) filter (where s.school_id is not null), '{}'::bigint[]),
    coalesce(array_agg(distinct s.authority_id) filter (where s.authority_id is not null), '{}'::bigint[])
  into v_activities, v_activity_school_ids, v_activity_authority_ids
  from scoped s;

  select
    coalesce(array_agg(distinct ar.school_id) filter (where ar.school_id is not null), '{}'::bigint[]),
    coalesce(array_agg(distinct ar.authority_id) filter (where ar.authority_id is not null), '{}'::bigint[]),
    coalesce(
      array_agg(distinct lower(trim(ar.destination_address_snapshot)))
        filter (where nullif(trim(coalesce(ar.destination_address_snapshot, '')), '') is not null),
      '{}'::text[]
    )
  into v_attendance_school_ids, v_attendance_authority_ids, v_addresses
  from public.attendance_records ar
  where ar.emp_id = p_employee_id
    and ar.report_date between v_from and v_to;

  select coalesce(array_agg(distinct x), '{}'::bigint[])
  into v_school_ids
  from unnest(v_activity_school_ids || v_attendance_school_ids) x
  where x is not null;

  select coalesce(array_agg(distinct x), '{}'::bigint[])
  into v_authority_ids
  from unnest(v_activity_authority_ids || v_attendance_authority_ids) x
  where x is not null;

  if nullif(trim(v_home_address), '') is not null then
    v_addresses := array_append(v_addresses, lower(trim(v_home_address)));
  end if;

  select coalesce(jsonb_agg(to_jsonb(ci)), '[]'::jsonb)
  into v_contacts
  from (
    select emp_id, full_name, address, employment_type, active
    from public.contacts_instructors
    where emp_id = p_employee_id
  ) ci;

  select coalesce(jsonb_agg(to_jsonb(tc)), '[]'::jsonb)
  into v_travel_cache
  from public.scheduling_travel_cache tc
  where
    tc.origin_instructor_emp_id = p_employee_id
    or (
      cardinality(v_school_ids) > 0
      and tc.origin_school_id = any(v_school_ids)
      and tc.destination_school_id = any(v_school_ids)
    )
    or (
      cardinality(v_addresses) > 0
      and lower(trim(coalesce(tc.origin_address, ''))) = any(v_addresses)
      and lower(trim(coalesce(tc.destination_address, ''))) = any(v_addresses)
    );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'report_id', ee.report_id,
        'employee_id', ee.employee_id,
        'expense_date', ee.expense_date,
        'amount', ee.amount,
        'description', ee.description,
        'notes', ee.notes,
        'emp_id', p_employee_id::text
      )
      order by ee.expense_date, ee.id
    ),
    '[]'::jsonb
  )
  into v_expenses
  from public.users u
  join public.personal_reports pr
    on pr.employee_id = u.auth_user_id
  join public.expense_entries ee
    on ee.report_id = pr.id
  where trim(coalesce(u.emp_id, '')) = p_employee_id::text
    and ee.expense_date between v_from and v_to;

  select coalesce(jsonb_agg(to_jsonb(ts) order by ts.training_date, ts.start_time, ts.course_name), '[]'::jsonb)
  into v_training_schedule
  from public.instructor_training_schedule ts
  where ts.is_active = true
    and ts.training_date between v_from and v_to
    and (ts.emp_id = p_employee_id or ts.participant_scope = 'open');

  select coalesce(jsonb_agg(to_jsonb(pa) order by pa.approved_at desc), '[]'::jsonb)
  into v_approvals
  from public.payroll_control_approvals pa
  where pa.employee_id = p_employee_id::text
    and pa.month_key = p_month_key
    and pa.status = 'approved_for_payroll';

  select coalesce(jsonb_agg(to_jsonb(w)), '[]'::jsonb)
  into v_workflow
  from public.get_payroll_attendance_month_statuses(p_month_key, array[p_employee_id::text]) w;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'semel_mosad', s.semel_mosad,
        'school_name', s.school_name,
        'authority', s.authority,
        'authority_id', s.authority_id,
        'district', s.district,
        'city', s.city,
        'institution_address', s.institution_address,
        'active', s.active
      )
    ),
    '[]'::jsonb
  )
  into v_schools
  from public.schools s
  where cardinality(v_school_ids) > 0
    and s.id = any(v_school_ids);

  select coalesce(array_agg(distinct x), '{}'::bigint[])
  into v_authority_ids
  from (
    select unnest(v_authority_ids) as x
    union
    select s.authority_id
    from public.schools s
    where cardinality(v_school_ids) > 0
      and s.id = any(v_school_ids)
      and s.authority_id is not null
  ) ids
  where x is not null;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', a.id,
        'authority_name', a.authority_name,
        'authority_code', a.authority_code,
        'authority_type', a.authority_type,
        'long_name', a.long_name,
        'district', a.district,
        'active', a.active
      )
    ),
    '[]'::jsonb
  )
  into v_authorities
  from public.authorities a
  where cardinality(v_authority_ids) > 0
    and a.id = any(v_authority_ids);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'alias_name', pga.alias_name,
        'group_key', pga.group_key,
        'is_active', pga.is_active
      )
    ),
    '[]'::jsonb
  )
  into v_proposal_group_aliases
  from public.proposal_group_aliases pga
  where pga.is_active = true;

  return jsonb_build_object(
    'employee_id', p_employee_id::text,
    'month_key', p_month_key,
    'records', v_records,
    'travel_compensations', v_travel,
    'locations', v_locations,
    'activities', v_activities,
    'contacts', v_contacts,
    'travel_cache', v_travel_cache,
    'expenses', v_expenses,
    'approvals', v_approvals,
    'workflow', v_workflow,
    'schools', v_schools,
    'authorities', v_authorities,
    'proposal_group_aliases', v_proposal_group_aliases,
    'training_schedule', v_training_schedule
  );
end
$function$\n\nCREATE OR REPLACE FUNCTION public.get_payroll_attendance_month_statuses(p_month_key text, p_employee_ids text[] DEFAULT NULL::text[])
 RETURNS TABLE(employee_id text, month_key text, attendance_submission_status text, workflow_status text, submitted_at timestamp with time zone, submitted_by_name text, manager_approved_at timestamp with time zone, manager_approved_by_name text, manager_pdf_sharepoint_url text, manager_pdf_file_name text, payroll_approved_at timestamp with time zone, payroll_approved_by_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text;
  v_own_name text;
begin
  if coalesce(trim(p_month_key), '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_month_key' using errcode = '22023';
  end if;

  select
    lower(trim(coalesce(u.role, ''))),
    coalesce(
      nullif(trim(coalesce(u.full_name, '')), ''),
      nullif(trim(coalesce(u.name, '')), ''),
      nullif(trim(coalesce(u.username, '')), '')
    )
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
  with requested as (
    select distinct trim(value) as employee_id
    from unnest(coalesce(p_employee_ids, array[]::text[])) as value
    where coalesce(trim(value), '') <> ''
  ),
  visible as (
    select r.employee_id
    from requested r
    left join public.contacts_instructors ci
      on ci.emp_id::text = r.employee_id
    where (
      v_role in ('admin', 'operation_manager', 'finance')
      or (
        v_role in ('activities_manager', 'manager', 'instructor_manager')
        and ci.emp_id is not null
        and lower(trim(coalesce(ci.direct_manager, ''))) = lower(trim(coalesce(v_own_name, '')))
      )
    )
  )
  select
    v.employee_id,
    trim(p_month_key),
    coalesce(nullif(trim(ma.status), ''), 'open') as attendance_submission_status,
    case
      when pca.id is not null then 'approved'
      when coalesce(nullif(trim(ma.status), ''), 'open') = 'locked'
           and ma.manager_approved_at is not null then 'manager_approved'
      when coalesce(nullif(trim(ma.status), ''), 'open') in ('submitted', 'locked') then 'submitted'
      else 'not_submitted'
    end as workflow_status,
    ma.submitted_at,
    coalesce(nullif(trim(ma.submitted_by_name), ''), ''),
    ma.manager_approved_at,
    coalesce(nullif(trim(ma.manager_approved_by_name), ''), ''),
    coalesce(nullif(trim(ma.manager_pdf_sharepoint_url), ''), ''),
    coalesce(nullif(trim(ma.manager_pdf_file_name), ''), ''),
    pca.approved_at,
    coalesce(nullif(trim(pca.approved_by_name), ''), '')
  from visible v
  left join public.attendance_month_approvals ma
    on ma.emp_id::text = v.employee_id
   and ma.month_key = trim(p_month_key)
  left join public.payroll_control_approvals pca
    on pca.employee_id = v.employee_id
   and pca.month_key = trim(p_month_key)
   and pca.status in ('admin_approved', 'approved_for_payroll');
end;
$function$\n\nCREATE OR REPLACE FUNCTION public.manager_finalize_attendance_month_review(p_employee_id text, p_month_key text, p_manager_name text, p_manager_pdf_sharepoint_url text DEFAULT NULL::text, p_manager_pdf_sharepoint_item_id text DEFAULT NULL::text, p_manager_pdf_file_name text DEFAULT NULL::text, p_manager_pdf_version integer DEFAULT NULL::integer, p_manager_approved_snapshot jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_emp_id bigint;
  v_role text;
  v_actor_name text;
  v_is_direct_manager boolean := false;
  v_row public.attendance_month_approvals%rowtype;
  v_pdf_url text := nullif(trim(coalesce(p_manager_pdf_sharepoint_url, '')), '');
  v_pdf_item_id text := nullif(trim(coalesce(p_manager_pdf_sharepoint_item_id, '')), '');
  v_pdf_file_name text := nullif(trim(coalesce(p_manager_pdf_file_name, '')), '');
  v_version integer;
  v_unapproved_count integer := 0;
begin
  if coalesce(trim(p_month_key), '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_month_key' using errcode = '22023';
  end if;
  if coalesce(trim(p_employee_id), '') !~ '^[0-9]+$' then
    raise exception 'invalid_employee_id' using errcode = '22023';
  end if;
  v_emp_id := trim(p_employee_id)::bigint;

  select
    lower(trim(coalesce(u.role, ''))),
    coalesce(
      nullif(trim(coalesce(p_manager_name, '')), ''),
      nullif(trim(coalesce(u.full_name, '')), ''),
      nullif(trim(coalesce(u.name, '')), ''),
      nullif(trim(coalesce(u.username, '')), '')
    )
  into v_role, v_actor_name
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.is_active = true
  limit 1;

  if v_role is null then
    raise exception 'payroll_attendance_auth_required' using errcode = '42501';
  end if;

  if v_role not in ('admin', 'operation_manager', 'activities_manager', 'manager', 'instructor_manager') then
    raise exception 'payroll_attendance_permission_denied' using errcode = '42501';
  end if;

  if v_role in ('activities_manager', 'manager', 'instructor_manager') then
    select exists (
      select 1
      from public.contacts_instructors ci
      where ci.emp_id = v_emp_id
        and lower(trim(coalesce(ci.direct_manager, ''))) = lower(trim(coalesce(v_actor_name, '')))
    ) into v_is_direct_manager;

    if not coalesce(v_is_direct_manager, false) then
      raise exception 'payroll_attendance_permission_denied' using errcode = '42501';
    end if;
  end if;

  -- PDF artifact is optional at finalize time. A missing PDF must not block
  -- manager approval; retry and attach fill it later from the locked snapshot.
  if (v_pdf_url is null) <> (v_pdf_file_name is null) then
    raise exception 'manager_pdf_fields_incomplete' using errcode = '22023';
  end if;

  select *
  into v_row
  from public.attendance_month_approvals
  where emp_id = v_emp_id
    and month_key = p_month_key
  limit 1
  for update;

  if not found then
    raise exception 'attendance_month_submission_required' using errcode = '22023';
  end if;

  if coalesce(nullif(trim(v_row.status), ''), 'open') <> 'submitted' then
    raise exception 'attendance_month_not_submitted_for_manager_review' using errcode = '22023';
  end if;

  select count(*)::integer
  into v_unapproved_count
  from public.attendance_records ar
  where ar.emp_id = v_emp_id
    and to_char(ar.report_date, 'YYYY-MM') = p_month_key
    and not exists (
      select 1
      from public.attendance_manager_record_reviews review
      where review.record_id = ar.id
        and review.status = 'approved'
        and review.approved_record_updated_at = ar.updated_at
    );

  if coalesce(v_unapproved_count, 0) > 0 then
    raise exception 'attendance_records_not_fully_approved' using errcode = '22023';
  end if;

  if v_pdf_url is not null then
    v_version := greatest(coalesce(p_manager_pdf_version, 0), coalesce(v_row.manager_pdf_version, 0) + 1);
  else
    v_version := coalesce(v_row.manager_pdf_version, 0);
  end if;

  update public.attendance_month_approvals
  set
    status = 'locked',
    manager_approved_at = now(),
    manager_approved_by_user_id = auth.uid(),
    manager_approved_by_name = coalesce(v_actor_name, ''),
    manager_pdf_sharepoint_url = coalesce(v_pdf_url, manager_pdf_sharepoint_url),
    manager_pdf_sharepoint_item_id = coalesce(v_pdf_item_id, manager_pdf_sharepoint_item_id),
    manager_pdf_file_name = coalesce(v_pdf_file_name, manager_pdf_file_name),
    manager_pdf_version = v_version,
    manager_approved_snapshot = coalesce(p_manager_approved_snapshot, '{}'::jsonb),
    updated_at = now()
  where emp_id = v_emp_id
    and month_key = p_month_key
  returning *
  into v_row;

  return jsonb_build_object(
    'employee_id', p_employee_id,
    'month_key', p_month_key,
    'status', v_row.status,
    'manager_approved_at', v_row.manager_approved_at,
    'manager_approved_by_name', v_row.manager_approved_by_name,
    'manager_pdf_sharepoint_url', v_row.manager_pdf_sharepoint_url,
    'manager_pdf_sharepoint_item_id', v_row.manager_pdf_sharepoint_item_id,
    'manager_pdf_file_name', v_row.manager_pdf_file_name,
    'manager_pdf_version', v_row.manager_pdf_version
  );
end
$function$\n\nCREATE OR REPLACE FUNCTION public.get_payroll_attendance_team_roster_for_month(p_month_key text)
 RETURNS TABLE(employee_id text, employee_name text, employment_type text, team text, role text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text;
  v_own_name text;
  v_from date;
  v_to date;
begin
  if coalesce(trim(p_month_key), '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_month_key' using errcode = '22023';
  end if;

  v_from := (trim(p_month_key) || '-01')::date;
  v_to := (v_from + interval '1 month - 1 day')::date;

  select
    lower(trim(coalesce(u.role, ''))),
    coalesce(
      nullif(trim(coalesce(u.full_name, '')), ''),
      nullif(trim(coalesce(u.name, '')), ''),
      nullif(trim(coalesce(u.username, '')), ''),
      ''
    )
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
    ci.emp_id::text,
    coalesce(nullif(trim(coalesce(ci.full_name, '')), ''), ci.emp_id::text),
    coalesce(ci.employment_type, ''),
    coalesce(ci.direct_manager, ''),
    'instructor'::text
  from public.contacts_instructors ci
  where (
      lower(trim(coalesce(ci.active::text, ''))) not in ('no', 'false', '0', 'לא')
      or exists (
        select 1
        from public.attendance_records ar
        where ar.emp_id = ci.emp_id
          and ar.report_date between v_from and v_to
      )
      or exists (
        select 1
        from public.attendance_month_approvals ama
        where ama.emp_id = ci.emp_id
          and ama.month_key = trim(p_month_key)
      )
      or exists (
        select 1
        from public.payroll_control_approvals pca
        where pca.employee_id = ci.emp_id::text
          and pca.month_key = trim(p_month_key)
      )
    )
    and (
      v_role in ('admin', 'operation_manager', 'finance')
      or (
        v_role in ('activities_manager', 'manager', 'instructor_manager')
        and lower(trim(coalesce(ci.direct_manager, ''))) = lower(trim(coalesce(v_own_name, '')))
      )
    )
  order by coalesce(ci.direct_manager, ''), coalesce(ci.full_name, ci.emp_id::text), ci.emp_id;
end;
$function$

revoke all on function public.get_payroll_attendance_team_roster_for_month(text) from public, anon, authenticated;
grant execute on function public.get_payroll_attendance_team_roster_for_month(text) to authenticated;

comment on function public.get_payroll_attendance_team_roster_for_month(text) is
  'Month-aware attendance-control roster. Active instructors remain visible; inactive instructors are retained only for months with attendance or attendance/payroll workflow history.';
