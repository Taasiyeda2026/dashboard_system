-- Admin-only read path for the immutable manager-approved attendance snapshot.
-- The regular table RLS intentionally exposes attendance_month_approvals only
-- to the employee. This RPC lets the admin control board inspect exactly what
-- the manager approved without falling back to live/mutable attendance rows.

create or replace function public.admin_get_attendance_approved_snapshot(
  p_employee_id text,
  p_month_key text
)
returns table (
  employee_id text,
  month_key text,
  manager_approved_at timestamptz,
  manager_approved_by_name text,
  approved_snapshot jsonb
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
begin
  if coalesce(trim(p_employee_id), '') = '' then
    raise exception 'invalid_employee_id' using errcode = '22023';
  end if;
  if coalesce(trim(p_month_key), '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_month_key' using errcode = '22023';
  end if;

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
    raise exception 'admin_attendance_snapshot_forbidden' using errcode = '42501';
  end if;

  return query
  select
    ma.emp_id::text,
    ma.month_key::text,
    ma.manager_approved_at,
    coalesce(nullif(trim(ma.manager_approved_by_name), ''), ''),
    coalesce(ma.manager_approved_snapshot, '{}'::jsonb)
  from public.attendance_month_approvals ma
  where ma.emp_id::text = trim(p_employee_id)
    and ma.month_key = trim(p_month_key)
    and coalesce(nullif(trim(ma.status), ''), 'open') = 'locked'
    and ma.manager_approved_at is not null
  limit 1;
end;
$$;

revoke all on function public.admin_get_attendance_approved_snapshot(text, text) from public, anon;
grant execute on function public.admin_get_attendance_approved_snapshot(text, text) to authenticated;

comment on function public.admin_get_attendance_approved_snapshot(text, text) is
  'Admin only. Returns the immutable manager-approved attendance snapshot for one employee/month so the admin can review it inline.';
