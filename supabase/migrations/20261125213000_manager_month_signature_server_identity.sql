-- Step 4: authorize direct-manager signature using server identity, never p_manager_name.
-- Preserve source-record, travel, expense, locked-month and snapshot guards.
-- p_manager_name remains in signature for backward-compatible callers.
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
      -- Never authorize or record a manager signature using a client-supplied name.
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
      and ar.report_date >= date '2026-11-01'
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


REVOKE ALL ON FUNCTION public.manager_finalize_attendance_month_review(text,text,text,text,text,text,integer,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manager_finalize_attendance_month_review(text,text,text,text,text,text,integer,jsonb) TO authenticated;
