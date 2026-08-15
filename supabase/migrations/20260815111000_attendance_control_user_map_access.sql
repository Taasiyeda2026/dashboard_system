grant select (emp_id, auth_user_id) on table public.users to authenticated;

drop policy if exists users_attendance_control_personal_reports_map on public.users;
create policy users_attendance_control_personal_reports_map
on public.users
for select
to authenticated
using (
  private.dashboard_user_can_manage_personal_reports()
);
