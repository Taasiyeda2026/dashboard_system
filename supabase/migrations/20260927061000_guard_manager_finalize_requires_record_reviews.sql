-- Block monthly manager approval unless every attendance record for the
-- employee/month has a still-valid explicit record review.
-- A review is valid only when approved_record_updated_at matches the current
-- attendance_records.updated_at for that record_id.

create or replace function public.manager_finalize_attendance_month_review(
  p_employee_id text,
  p_month_key text,
  p_manager_name text,
  p_manager_pdf_sharepoint_url text,
  p_manager_pdf_sharepoint_item_id text,
  p_manager_pdf_file_name text,
  p_manager_pdf_version integer,
  p_manager_approved_snapshot jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
  if coalesce(trim(p_month_key), '') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
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

  if v_pdf_url is null or v_pdf_file_name is null then
    raise exception 'manager_pdf_required' using errcode = '22023';
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

  v_version := greatest(coalesce(p_manager_pdf_version, 0), coalesce(v_row.manager_pdf_version, 0) + 1);

  update public.attendance_month_approvals
  set
    status = 'locked',
    manager_approved_at = now(),
    manager_approved_by_user_id = auth.uid(),
    manager_approved_by_name = coalesce(v_actor_name, ''),
    manager_pdf_sharepoint_url = v_pdf_url,
    manager_pdf_sharepoint_item_id = v_pdf_item_id,
    manager_pdf_file_name = v_pdf_file_name,
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
$$;

revoke all on function public.manager_finalize_attendance_month_review(text, text, text, text, text, text, integer, jsonb)
from public, anon;
grant execute on function public.manager_finalize_attendance_month_review(text, text, text, text, text, text, integer, jsonb)
to authenticated;

comment on function public.manager_finalize_attendance_month_review(text, text, text, text, text, text, integer, jsonb) is
  'Locks a submitted attendance month after manager PDF artifacts are saved. Requires a still-valid explicit approval for every attendance record in the month.';
