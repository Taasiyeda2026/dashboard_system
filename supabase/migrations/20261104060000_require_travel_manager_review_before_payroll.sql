-- Every source travel report must be reviewed before final payroll approval.
-- Also forbids a late travel decision/payable after the manager's signature.
CREATE OR REPLACE FUNCTION public.av2_assert_payroll_travel_review_ready(p_emp_id bigint,p_month_key text,p_manager_approved_at timestamptz)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $guard$
DECLARE v_role text;
BEGIN
  SELECT lower(btrim(coalesce(u.role,''))) INTO v_role FROM public.users u
  WHERE u.auth_user_id=auth.uid() AND u.is_active=true LIMIT 1;
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'payroll_attendance_permission_denied' USING ERRCODE='42501';
  END IF;
  IF p_manager_approved_at IS NULL THEN
    RAISE EXCEPTION 'attendance_month_manager_signature_missing' USING ERRCODE='22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.attendance_records a
    WHERE a.emp_id=p_emp_id AND to_char(a.report_date,'YYYY-MM')=p_month_key
      AND a.generation_kind IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.attendance_manager_record_reviews r
        WHERE r.record_id=a.id AND r.status='approved'
          AND r.approved_record_updated_at=a.updated_at
          AND r.approved_at<=p_manager_approved_at
      )
  ) THEN RAISE EXCEPTION 'attendance_records_not_fully_approved' USING ERRCODE='22023'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.attendance_travel_compensations c
    JOIN public.attendance_records a ON a.id=c.source_attendance_record_id
    WHERE a.emp_id=p_emp_id AND to_char(a.report_date,'YYYY-MM')=p_month_key
      AND a.report_date<date '2026-11-04'
      AND (
        c.review_status IN ('awaiting_report','auto_matched','pending_review')
        OR (c.review_status IN ('approved','corrected','rejected') AND
              (c.review_at IS NULL OR c.review_at>p_manager_approved_at))
      )
  ) THEN RAISE EXCEPTION 'attendance_travel_reviews_pending' USING ERRCODE='22023'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.attendance_records g
    WHERE g.emp_id=p_emp_id AND to_char(g.report_date,'YYYY-MM')=p_month_key
      AND g.generation_kind IN ('travel_time_cancellation','daily_travel_cancellation')
      AND (g.created_at>p_manager_approved_at OR g.updated_at>p_manager_approved_at)
  ) THEN RAISE EXCEPTION 'attendance_payable_changed_after_manager_approval' USING ERRCODE='22023'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.attendance_records a
    LEFT JOIN public.attendance_daily_travel_reports d
      ON d.emp_id=a.emp_id AND d.travel_date=a.report_date
    WHERE a.emp_id=p_emp_id AND to_char(a.report_date,'YYYY-MM')=p_month_key
      AND a.report_date>=date '2026-11-04'
      AND a.generation_kind IS NULL AND a.activity_type NOT IN ('זום','ביטול זמן')
      AND coalesce(a.training_mode,'physical')<>'online'
      AND coalesce(a.operation_meeting_mode,'physical')<>'online'
      AND (d.id IS NULL OR d.review_status NOT IN ('approved','corrected')
        OR d.review_at IS NULL OR d.review_at>p_manager_approved_at
        OR d.reported_at IS NULL OR d.reported_at>d.review_at
        OR (NOT d.no_travel AND NOT public.av2_daily_travel_route_matches(d.emp_id,d.travel_date,d.legs)))
  ) THEN RAISE EXCEPTION 'attendance_daily_travel_reviews_pending' USING ERRCODE='22023'; END IF;
END;
$guard$;
REVOKE ALL ON FUNCTION public.av2_assert_payroll_travel_review_ready(bigint,text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.av2_assert_payroll_travel_review_ready(bigint,text,timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_finalize_attendance_month_payroll(p_employee_id text, p_month_key text, p_final_approved_by_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_emp_id bigint;
  v_role text;
  v_actor_name text;
  v_month_row public.attendance_month_approvals%rowtype;
  v_employee_name text;
  v_saved public.payroll_control_approvals%rowtype;
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
      nullif(trim(coalesce(p_final_approved_by_name, '')), ''),
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
  if v_role <> 'admin' then
    raise exception 'payroll_attendance_permission_denied' using errcode = '42501';
  end if;

  select *
    into v_month_row
  from public.attendance_month_approvals
  where emp_id = v_emp_id
    and month_key = trim(p_month_key)
  limit 1
  for update;

  if not found then
    raise exception 'attendance_month_not_found' using errcode = '22023';
  end if;
  if coalesce(nullif(trim(v_month_row.status), ''), 'open') <> 'locked' then
    raise exception 'attendance_month_not_manager_approved' using errcode = '22023';
  end if;
  if v_month_row.manager_approved_at is null then
    raise exception 'attendance_month_manager_signature_missing' using errcode = '22023';
  end if;
  if nullif(trim(coalesce(v_month_row.manager_pdf_sharepoint_url, '')), '') is null then
    raise exception 'attendance_month_manager_pdf_missing' using errcode = '22023';
  end if;

  PERFORM public.av2_assert_payroll_travel_review_ready(v_emp_id, trim(p_month_key), v_month_row.manager_approved_at);

  select *
    into v_saved
  from public.payroll_control_approvals
  where employee_id = trim(p_employee_id)
    and month_key = trim(p_month_key)
  limit 1
  for update;

  if found and v_saved.status = 'approved_for_payroll' then
    return to_jsonb(v_saved);
  end if;

  select coalesce(
    nullif(trim(coalesce(ci.full_name, '')), ''),
    nullif(trim(coalesce((v_month_row.manager_approved_snapshot ->> 'employeeName'), '')), ''),
    trim(p_employee_id)
  )
  into v_employee_name
  from public.contacts_instructors ci
  where ci.emp_id = v_emp_id
  limit 1;

  insert into public.payroll_control_approvals (
    employee_id,
    employee_name,
    month_key,
    approved_by_user_id,
    approved_by_name,
    approved_at,
    status,
    approval_text_version,
    pdf_path,
    pdf_file_name,
    approved_snapshot,
    payroll_dispatched_at,
    payroll_dispatched_by_user_id,
    payroll_dispatched_by_name,
    created_at,
    updated_at
  ) values (
    trim(p_employee_id),
    coalesce(v_employee_name, trim(p_employee_id)),
    trim(p_month_key),
    auth.uid(),
    coalesce(v_actor_name, ''),
    now(),
    'admin_approved',
    'attendance-month-final-admin-v2',
    v_month_row.manager_pdf_sharepoint_url,
    v_month_row.manager_pdf_file_name,
    coalesce(v_month_row.manager_approved_snapshot, '{}'::jsonb),
    null,
    null,
    null,
    now(),
    now()
  )
  on conflict (employee_id, month_key) do update
  set employee_name = excluded.employee_name,
      approved_by_user_id = excluded.approved_by_user_id,
      approved_by_name = excluded.approved_by_name,
      approved_at = excluded.approved_at,
      status = 'admin_approved',
      approval_text_version = excluded.approval_text_version,
      pdf_path = excluded.pdf_path,
      pdf_file_name = excluded.pdf_file_name,
      approved_snapshot = excluded.approved_snapshot,
      payroll_dispatched_at = null,
      payroll_dispatched_by_user_id = null,
      payroll_dispatched_by_name = null,
      updated_at = now()
  returning * into v_saved;

  return to_jsonb(v_saved);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_send_attendance_month_to_payroll(p_employee_id text, p_month_key text, p_sent_by_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_role text;
  v_actor_name text;
  v_row public.payroll_control_approvals%rowtype;
begin
  if coalesce(trim(p_month_key), '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_month_key' using errcode = '22023';
  end if;
  if coalesce(trim(p_employee_id), '') !~ '^[0-9]+$' then
    raise exception 'invalid_employee_id' using errcode = '22023';
  end if;

  select
    lower(trim(coalesce(u.role, ''))),
    coalesce(
      nullif(trim(coalesce(p_sent_by_name, '')), ''),
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
  if v_role <> 'admin' then
    raise exception 'payroll_attendance_permission_denied' using errcode = '42501';
  end if;

  select * into v_row
  from public.payroll_control_approvals
  where employee_id = trim(p_employee_id)
    and month_key = trim(p_month_key)
  limit 1
  for update;

  if not found then
    raise exception 'attendance_month_admin_approval_required' using errcode = '22023';
  end if;
  if v_row.status = 'approved_for_payroll' then
    return to_jsonb(v_row);
  end if;
  if v_row.status <> 'admin_approved' then
    raise exception 'attendance_month_admin_approval_required' using errcode = '22023';
  end if;

  PERFORM public.av2_assert_payroll_travel_review_ready(trim(p_employee_id)::bigint, trim(p_month_key),
    (SELECT a.manager_approved_at FROM public.attendance_month_approvals a
     WHERE a.emp_id=trim(p_employee_id)::bigint AND a.month_key=trim(p_month_key) AND a.status='locked'));

  update public.payroll_control_approvals
  set status = 'approved_for_payroll',
      payroll_dispatched_at = now(),
      payroll_dispatched_by_user_id = auth.uid(),
      payroll_dispatched_by_name = coalesce(v_actor_name, ''),
      updated_at = now()
  where id = v_row.id
  returning * into v_row;

  insert into public.payroll_attendance_dispatches (
    approval_id,
    employee_id,
    month_key,
    dispatched_at,
    dispatched_by_user_id,
    dispatched_by_name
  ) values (
    v_row.id,
    v_row.employee_id,
    v_row.month_key,
    v_row.payroll_dispatched_at,
    auth.uid(),
    coalesce(v_actor_name, '')
  )
  on conflict (approval_id) do nothing;

  return to_jsonb(v_row);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_send_attendance_month_to_payroll_batch(p_month_key text, p_employee_ids text[] DEFAULT NULL::text[], p_sent_by_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_role text;
  v_actor_name text;
  v_sent integer := 0;
  v_candidate record;
begin
  if coalesce(trim(p_month_key), '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_month_key' using errcode = '22023';
  end if;

  select
    lower(trim(coalesce(u.role, ''))),
    coalesce(
      nullif(trim(coalesce(p_sent_by_name, '')), ''),
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
  if v_role <> 'admin' then
    raise exception 'payroll_attendance_permission_denied' using errcode = '42501';
  end if;

  FOR v_candidate IN
    SELECT p.employee_id, a.manager_approved_at
    FROM public.payroll_control_approvals p
    LEFT JOIN public.attendance_month_approvals a
      ON a.emp_id=p.employee_id::bigint AND a.month_key=p.month_key AND a.status='locked'
    WHERE p.month_key=trim(p_month_key) AND p.status='admin_approved'
      AND (p_employee_ids IS NULL OR p.employee_id=ANY(p_employee_ids))
  LOOP
    PERFORM public.av2_assert_payroll_travel_review_ready(
      v_candidate.employee_id::bigint,trim(p_month_key),v_candidate.manager_approved_at);
  END LOOP;

  with updated as (
    update public.payroll_control_approvals p
    set status = 'approved_for_payroll',
        payroll_dispatched_at = now(),
        payroll_dispatched_by_user_id = auth.uid(),
        payroll_dispatched_by_name = coalesce(v_actor_name, ''),
        updated_at = now()
    where p.month_key = trim(p_month_key)
      and p.status = 'admin_approved'
      and (
        p_employee_ids is null
        or p.employee_id = any(p_employee_ids)
      )
    returning p.*
  ), logged as (
    insert into public.payroll_attendance_dispatches (
      approval_id,
      employee_id,
      month_key,
      dispatched_at,
      dispatched_by_user_id,
      dispatched_by_name
    )
    select
      u.id,
      u.employee_id,
      u.month_key,
      u.payroll_dispatched_at,
      auth.uid(),
      coalesce(v_actor_name, '')
    from updated u
    on conflict (approval_id) do nothing
    returning 1
  )
  select count(*)::integer into v_sent from updated;

  return jsonb_build_object(
    'month_key', trim(p_month_key),
    'sent_count', v_sent
  );
end;
$function$
;
