-- Efficient admin pending summary for manager_approved months awaiting final admin approval.
-- Counts only locked months with manager approval and without admin_approved / approved_for_payroll.
-- Does not load attendance records.

create or replace function public.get_admin_pending_attendance_by_month()
returns table (
  month_key text,
  pending_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select lower(trim(coalesce(u.role, '')))
  into v_role
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.is_active = true
  limit 1;

  if v_role is null then
    raise exception 'payroll_attendance_auth_required' using errcode = '42501';
  end if;
  if v_role not in ('admin', 'operation_manager') then
    raise exception 'payroll_attendance_permission_denied' using errcode = '42501';
  end if;

  return query
  select
    ma.month_key::text,
    count(*)::bigint as pending_count
  from public.attendance_month_approvals ma
  where coalesce(nullif(trim(ma.status), ''), 'open') = 'locked'
    and ma.manager_approved_at is not null
    and not exists (
      select 1
      from public.payroll_control_approvals pca
      where pca.employee_id = ma.emp_id::text
        and pca.month_key = ma.month_key
        and pca.status in ('admin_approved', 'approved_for_payroll')
    )
  group by ma.month_key
  order by ma.month_key desc;
end;
$$;

revoke all on function public.get_admin_pending_attendance_by_month() from public, anon;
grant execute on function public.get_admin_pending_attendance_by_month() to authenticated;

comment on function public.get_admin_pending_attendance_by_month() is
  'Admin/operation_manager only. Returns month_key + pending_count for manager_approved months awaiting final admin approval, without scanning attendance records.';
