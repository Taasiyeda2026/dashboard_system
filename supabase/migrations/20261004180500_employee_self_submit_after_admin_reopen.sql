-- Employee-owned attendance submission after the normal month window closes.
-- Admin may reopen a specific employee+month for correction/submission, but may
-- no longer submit the month on the employee's behalf.

alter table public.attendance_month_approvals
  add column if not exists reopened_at timestamptz,
  add column if not exists reopened_by_user_id uuid,
  add column if not exists reopened_by_name text,
  add column if not exists reopen_reason text;

comment on column public.attendance_month_approvals.reopened_at is
  'Audit timestamp for an explicit admin reopen that returns the month to the employee.';
comment on column public.attendance_month_approvals.reopened_by_user_id is
  'Authenticated admin user that explicitly reopened the employee month.';
comment on column public.attendance_month_approvals.reopened_by_name is
  'Display name of the admin that explicitly reopened the employee month.';
comment on column public.attendance_month_approvals.reopen_reason is
  'Required audit reason supplied by the admin when the employee month is reopened.';

-- Authoritative write gate. An explicit reopened state is the exception to the
-- normal day-2 cutoff and remains editable until the employee submits it again.
create or replace function public.av2_can_write_month(p_report_date date)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp_id bigint;
  v_month_key text;
  v_status text;
  v_cur_year int := extract(year from current_date)::int;
  v_cur_month int := extract(month from current_date)::int;
  v_cur_day int := extract(day from current_date)::int;
  v_rec_year int := extract(year from p_report_date)::int;
  v_rec_month int := extract(month from p_report_date)::int;
  v_prev_year int;
  v_prev_month int;
begin
  select emp_id::bigint
    into v_emp_id
  from public.users
  where auth_user_id = auth.uid()
    and is_active = true
  limit 1;

  if v_emp_id is null then
    return false;
  end if;

  v_month_key := to_char(p_report_date, 'YYYY-MM');

  select coalesce(nullif(trim(status), ''), 'open')
    into v_status
  from public.attendance_month_approvals
  where emp_id = v_emp_id
    and month_key = v_month_key
  limit 1;

  -- Final payroll approval is always read-only. Reopen clears this row first.
  if exists (
    select 1
    from public.payroll_control_approvals pca
    where pca.employee_id = v_emp_id::text
      and pca.month_key = v_month_key
      and pca.status = 'approved_for_payroll'
  ) then
    return false;
  end if;

  if v_status in ('submitted', 'locked') then
    return false;
  end if;

  -- Explicit admin reopen is a deliberate per-employee exception to the date
  -- cutoff. It stays open until the employee presses month submission again.
  if v_status = 'reopened' then
    return true;
  end if;

  if v_rec_year = v_cur_year and v_rec_month = v_cur_month then
    return true;
  end if;

  if v_cur_month = 1 then
    v_prev_year := v_cur_year - 1;
    v_prev_month := 12;
  else
    v_prev_year := v_cur_year;
    v_prev_month := v_cur_month - 1;
  end if;

  if v_rec_year = v_prev_year
     and v_rec_month = v_prev_month
     and v_cur_day <= 2 then
    return true;
  end if;

  return false;
end;
$$;

revoke all on function public.av2_can_write_month(date) from public, anon;
grant execute on function public.av2_can_write_month(date) to authenticated;

-- Reopen an employee month. This works both for a month that was already
-- submitted/approved and for the important edge case where reports exist but the
-- employee never pressed "סיום ואישור חודש" (there is no approval row yet).
create or replace function public.admin_reopen_attendance_month_for_correction(
  p_employee_id text,
  p_month_key text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp_id bigint;
  v_role text;
  v_admin_name text;
  v_reason text;
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
  v_reason := nullif(trim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'attendance_reopen_reason_required' using errcode = '22023';
  end if;

  select
    lower(trim(coalesce(u.role, ''))),
    coalesce(
      nullif(trim(coalesce(u.full_name, '')), ''),
      nullif(trim(coalesce(u.name, '')), ''),
      nullif(trim(coalesce(u.username, '')), '')
    )
  into v_role, v_admin_name
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

  -- The employee must have an active user mapping because the employee, not the
  -- admin, is responsible for the final month submission.
  if not exists (
    select 1
    from public.users u
    where u.emp_id::text = trim(p_employee_id)
      and u.is_active = true
  ) then
    raise exception 'attendance_employee_login_required' using errcode = '22023';
  end if;

  insert into public.attendance_month_approvals (
    emp_id,
    month_key,
    status,
    submitted_at,
    submitted_by_name,
    submitted_on_behalf,
    submitted_on_behalf_by_user_id,
    submitted_on_behalf_by_name,
    submitted_on_behalf_reason,
    submitted_on_behalf_at,
    manager_approved_at,
    manager_approved_by_user_id,
    manager_approved_by_name,
    manager_pdf_sharepoint_url,
    manager_pdf_sharepoint_item_id,
    manager_pdf_file_name,
    manager_approved_snapshot,
    locked_at,
    locked_by,
    released_at,
    released_by,
    reopened_at,
    reopened_by_user_id,
    reopened_by_name,
    reopen_reason,
    updated_at
  ) values (
    v_emp_id,
    trim(p_month_key),
    'reopened',
    null,
    null,
    false,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    '{}'::jsonb,
    null,
    null,
    now(),
    auth.uid(),
    now(),
    auth.uid(),
    coalesce(v_admin_name, ''),
    v_reason,
    now()
  )
  on conflict (emp_id, month_key) do update
    set status = 'reopened',
        submitted_at = null,
        submitted_by_name = null,
        submitted_on_behalf = false,
        submitted_on_behalf_by_user_id = null,
        submitted_on_behalf_by_name = null,
        submitted_on_behalf_reason = null,
        submitted_on_behalf_at = null,
        manager_approved_at = null,
        manager_approved_by_user_id = null,
        manager_approved_by_name = null,
        manager_pdf_sharepoint_url = null,
        manager_pdf_sharepoint_item_id = null,
        manager_pdf_file_name = null,
        manager_approved_snapshot = '{}'::jsonb,
        -- manager_pdf_version is deliberately preserved for immutable PDF history.
        locked_at = null,
        locked_by = null,
        released_at = now(),
        released_by = auth.uid(),
        reopened_at = now(),
        reopened_by_user_id = auth.uid(),
        reopened_by_name = coalesce(v_admin_name, ''),
        reopen_reason = v_reason,
        updated_at = now()
  returning * into v_row;

  delete from public.payroll_control_approvals
  where employee_id = trim(p_employee_id)
    and month_key = trim(p_month_key);

  return jsonb_build_object(
    'employee_id', trim(p_employee_id),
    'month_key', trim(p_month_key),
    'status', v_row.status,
    'reopened_at', v_row.reopened_at,
    'reopened_by_name', v_row.reopened_by_name,
    'reason', v_row.reopen_reason,
    'employee_must_submit', true
  );
end;
$$;

revoke all on function public.admin_reopen_attendance_month_for_correction(text, text, text)
  from public, anon;
grant execute on function public.admin_reopen_attendance_month_for_correction(text, text, text)
  to authenticated;

comment on function public.admin_reopen_attendance_month_for_correction(text, text, text) is
  'Admin-only: reopens one employee month for employee-owned correction/submission, with required audit reason. Does not submit on behalf.';

-- Business rule: admins must not submit the employee month on the employee's
-- behalf. Keep the historical function for migration compatibility, but make it
-- unreachable from signed-in application users.
revoke all on function public.admin_submit_attendance_month_on_behalf(text, text, text)
  from public, anon, authenticated;

comment on function public.admin_submit_attendance_month_on_behalf(text, text, text) is
  'Disabled for application users: employee must submit their own attendance month. Use admin_reopen_attendance_month_for_correction instead.';
