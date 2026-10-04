-- Simplify the singleton-admin reopen flow.
-- The action is admin-only, so do not require or store a reason/admin identity.
-- Keep the historical columns and RPC parameter for backwards compatibility.

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

  select lower(trim(coalesce(u.role, '')))
    into v_role
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

  if not exists (
    select 1
    from public.users u
    where u.emp_id::text = trim(p_employee_id)
      and u.is_active = true
  ) then
    raise exception 'attendance_employee_login_required' using errcode = '22023';
  end if;

  perform set_config('app.av2_submission_override_emp_id', v_emp_id::text, true);

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
    null,
    now(),
    null,
    null,
    null,
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
        -- manager_pdf_version remains preserved for immutable PDF history.
        locked_at = null,
        locked_by = null,
        released_at = now(),
        released_by = null,
        reopened_at = now(),
        reopened_by_user_id = null,
        reopened_by_name = null,
        reopen_reason = null,
        updated_at = now()
  returning * into v_row;

  perform set_config('app.av2_submission_override_emp_id', '', true);

  delete from public.payroll_control_approvals
  where employee_id = trim(p_employee_id)
    and month_key = trim(p_month_key);

  return jsonb_build_object(
    'employee_id', trim(p_employee_id),
    'month_key', trim(p_month_key),
    'status', v_row.status,
    'reopened_at', v_row.reopened_at,
    'employee_must_submit', true
  );
end;
$$;

revoke all on function public.admin_reopen_attendance_month_for_correction(text, text, text)
  from public, anon;
grant execute on function public.admin_reopen_attendance_month_for_correction(text, text, text)
  to authenticated;

comment on function public.admin_reopen_attendance_month_for_correction(text, text, text) is
  'Admin-only: reopens one employee month for employee-owned correction/submission. Reason/admin identity are intentionally not collected in the singleton-admin flow.';

comment on column public.attendance_month_approvals.reopened_by_user_id is
  'Legacy audit field. New singleton-admin reopen actions do not populate it.';
comment on column public.attendance_month_approvals.reopened_by_name is
  'Legacy audit field. New singleton-admin reopen actions do not populate it.';
comment on column public.attendance_month_approvals.reopen_reason is
  'Legacy audit field. New singleton-admin reopen actions do not collect a reason.';
