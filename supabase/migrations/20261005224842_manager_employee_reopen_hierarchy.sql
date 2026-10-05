-- Enforce the approved hierarchy:
-- employee -> direct manager -> admin.
-- A month reopened by the direct manager belongs to the employee again until resubmission.

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

  if v_role in ('admin', 'operation_manager') then
    return true;
  end if;

  select coalesce(nullif(trim(ama.status), ''), 'open')
  into v_status
  from public.attendance_month_approvals ama
  where ama.emp_id = p_emp_id
    and ama.month_key = to_char(p_report_date, 'YYYY-MM')
  limit 1;

  if not found or v_status <> 'submitted' then
    return false;
  end if;

  if public.av2_attendance_month_is_closed(p_emp_id, p_report_date) then
    return false;
  end if;

  return true;
end;
$$;

revoke all on function public.attendance_manager_month_allows_mutation(bigint, date)
from public, anon, authenticated;

comment on function public.attendance_manager_month_allows_mutation(bigint, date) is
  'Team managers may mutate attendance only after employee submission and before manager monthly approval. Reopened months belong to the employee until resubmission.';

create or replace function public.manager_reopen_attendance_month_for_employee(
  p_employee_id text,
  p_month_key text
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
  v_row public.attendance_month_approvals%rowtype;
begin
  if coalesce(trim(p_month_key), '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_month_key' using errcode = '22023';
  end if;
  if coalesce(trim(p_employee_id), '') !~ '^[0-9]+$' then
    raise exception 'invalid_employee_id' using errcode = '22023';
  end if;
  if trim(p_month_key) > to_char(current_date, 'YYYY-MM') then
    raise exception 'attendance_future_month_not_allowed' using errcode = '22023';
  end if;

  v_emp_id := trim(p_employee_id)::bigint;

  select
    lower(trim(coalesce(u.role, ''))),
    coalesce(
      nullif(trim(coalesce(u.full_name, '')), ''),
      nullif(trim(coalesce(u.name, '')), ''),
      nullif(trim(coalesce(u.username, '')), ''),
      ''
    )
  into v_role, v_actor_name
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.is_active = true
  limit 1;

  if v_role is null then
    raise exception 'payroll_attendance_auth_required' using errcode = '42501';
  end if;
  if v_role not in ('activities_manager', 'manager', 'instructor_manager') then
    raise exception 'payroll_attendance_permission_denied' using errcode = '42501';
  end if;

  if not public.attendance_manager_can_review_employee(v_emp_id) then
    raise exception 'payroll_attendance_permission_denied' using errcode = '42501';
  end if;

  select *
  into v_row
  from public.attendance_month_approvals
  where emp_id = v_emp_id
    and month_key = trim(p_month_key)
  limit 1
  for update;

  if not found then
    raise exception 'attendance_month_submission_required' using errcode = '22023';
  end if;

  if coalesce(nullif(trim(v_row.status), ''), 'open') <> 'submitted'
     or v_row.manager_approved_at is not null then
    raise exception 'attendance_month_not_reopenable_by_manager' using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.payroll_control_approvals pca
    where pca.employee_id = trim(p_employee_id)
      and pca.month_key = trim(p_month_key)
  ) then
    raise exception 'attendance_month_not_reopenable_by_manager' using errcode = '55000';
  end if;

  update public.attendance_month_approvals
  set
    status = 'reopened',
    submitted_at = null,
    submitted_by_name = null,
    submitted_on_behalf = false,
    submitted_on_behalf_by_user_id = null,
    submitted_on_behalf_by_name = null,
    submitted_on_behalf_reason = null,
    submitted_on_behalf_at = null,
    reopened_at = now(),
    reopened_by_user_id = auth.uid(),
    reopened_by_name = coalesce(v_actor_name, ''),
    reopen_reason = null,
    released_at = now(),
    released_by = coalesce(v_actor_name, ''),
    updated_at = now()
  where emp_id = v_emp_id
    and month_key = trim(p_month_key)
  returning *
  into v_row;

  return jsonb_build_object(
    'employee_id', trim(p_employee_id),
    'month_key', trim(p_month_key),
    'status', v_row.status,
    'reopened_at', v_row.reopened_at,
    'reopened_by_name', v_row.reopened_by_name,
    'employee_must_submit', true
  );
end;
$$;

revoke all on function public.manager_reopen_attendance_month_for_employee(text, text) from public;
revoke execute on function public.manager_reopen_attendance_month_for_employee(text, text) from anon;
grant execute on function public.manager_reopen_attendance_month_for_employee(text, text) to authenticated;

comment on function public.manager_reopen_attendance_month_for_employee(text, text) is
  'Allows only the employee direct team manager to return a submitted month to that employee before monthly manager approval. The employee must resubmit before manager review can continue.';
