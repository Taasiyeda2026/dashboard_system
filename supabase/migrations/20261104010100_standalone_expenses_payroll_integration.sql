-- Existing attendance-row expenses remain intact. New independent approved
-- expense lines are included in payroll records once, not per activity.
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

  -- Standalone expenses are salary lines only after approval. They are never
  -- added to a per-activity attendance row and cannot be counted twice.
  return query
  select
    e.id, e.emp_id::text,coalesce(ci.full_name,e.emp_id::text),
    coalesce(ci.employment_type,''),coalesce(ci.direct_manager,''),
    e.expense_date,null::time,null::time,0::numeric,
    'הוצאות'::text,''::text,''::text,'הוצאות מדריך'::text,''::text,
    coalesce(e.approved_amount,0)::numeric,0::numeric,e.details,
    ''::text,''::text,null::bigint,''::text,''::text,
    null::bigint,null::bigint,null::bigint,
    false,0::numeric,
    coalesce((select jsonb_agg(jsonb_build_object(
      'id',att.id,'fileName',att.file_name,
      'storagePath',att.storage_path,'fileType',att.file_type,
      'fileSize',att.file_size) order by att.file_name,att.id)
      from public.attendance_expense_attachments att
      where att.expense_id=e.id),'[]'::jsonb),
    null::text
  from public.attendance_expense_reports e
  left join public.contacts_instructors ci on ci.emp_id=e.emp_id
  where e.review_status='approved'
    and e.expense_date >= date '2026-11-04'
    and (p_employee_ids is null or e.emp_id=any(p_employee_ids))
    and (p_from_date is null or e.expense_date>=p_from_date)
    and (p_to_date is null or e.expense_date<=p_to_date)
    and (v_role in ('admin','operation_manager','finance')
      or (v_role in ('activities_manager','manager','instructor_manager')
        and lower(trim(coalesce(ci.direct_manager,'')))=lower(trim(coalesce(v_own_name,'')))))
  order by e.expense_date,e.emp_id;
end
$function$
;
CREATE OR REPLACE FUNCTION public.manager_finalize_attendance_month_review(p_employee_id text, p_month_key text, p_manager_name text, p_manager_pdf_sharepoint_url text DEFAULT NULL::text, p_manager_pdf_sharepoint_item_id text DEFAULT NULL::text, p_manager_pdf_file_name text DEFAULT NULL::text, p_manager_pdf_version integer DEFAULT NULL::integer, p_manager_approved_snapshot jsonb DEFAULT '{}'::jsonb)
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
  v_open_travel jsonb;
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
        and lower(trim(coalesce(ci.active::text, ''))) not in ('no', 'false', '0', 'לא')
    ) into v_is_direct_manager;

    if not coalesce(v_is_direct_manager, false) then
      raise exception 'payroll_attendance_permission_denied' using errcode = '42501';
    end if;
  end if;

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

  -- Source attendance rows only. Generated travel-cancellation payables are
  -- gated by av2_month_open_travel_reviews / approved_cancellation_minutes,
  -- not by a second attendance_manager_record_reviews pass.
  select count(*)::integer
  into v_unapproved_count
  from public.attendance_records ar
  where ar.emp_id = v_emp_id
    and to_char(ar.report_date, 'YYYY-MM') = p_month_key
    and ar.generation_kind is null
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

  if exists (
    select 1 from public.attendance_records ar
    where ar.emp_id=v_emp_id
      and to_char(ar.report_date,'YYYY-MM')=p_month_key
      and ar.report_date >= date '2026-11-04'
      and ar.generation_kind is null
      and ar.activity_type not in ('זום','ביטול זמן')
      and coalesce(ar.training_mode::text,'physical')<>'online'
      and coalesce(ar.operation_meeting_mode,'physical')<>'online'
      and not exists (
        select 1 from public.attendance_daily_travel_reports d
        where d.emp_id=ar.emp_id and d.travel_date=ar.report_date
          and d.review_status in ('approved','corrected')
          and (d.no_travel is true
               or public.av2_daily_travel_route_matches(d.emp_id,d.travel_date,d.legs))
      )
  ) then
    raise exception 'attendance_daily_travel_reviews_pending' using errcode='22023';
  end if;

  v_open_travel := public.av2_month_open_travel_reviews(v_emp_id, p_month_key);
  if jsonb_array_length(coalesce(v_open_travel, '[]'::jsonb)) > 0 then
    raise exception 'attendance_travel_reviews_pending:%', v_open_travel
      using errcode = '22023';
  end if;

  if exists (
    select 1 from public.attendance_expense_reports er
    where er.emp_id=v_emp_id and to_char(er.expense_date,'YYYY-MM')=p_month_key
      and er.review_status='pending_review'
  ) then
    raise exception 'attendance_expense_reviews_pending' using errcode='22023';
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
$function$
;
alter table public.attendance_records
 add constraint attendance_independent_expense_cutover check (
 report_date < date '2026-11-04' or generation_kind is not null
 or (coalesce(expenses,0)=0 and expense_details is null)
 );
