-- The payroll-dispatch RPCs only need the caller's own admin privileges.
-- Keep RLS active as defense in depth instead of bypassing it with SECURITY DEFINER.

grant insert on table public.payroll_attendance_dispatches to authenticated;

drop policy if exists payroll_attendance_dispatches_insert on public.payroll_attendance_dispatches;
create policy payroll_attendance_dispatches_insert
on public.payroll_attendance_dispatches
for insert
to authenticated
with check (
  (select public.app_current_role()) = 'admin'
  and dispatched_by_user_id = (select auth.uid())
);

alter function public.admin_send_attendance_month_to_payroll(text, text, text)
  security invoker;
alter function public.admin_send_attendance_month_to_payroll_batch(text, text[], text)
  security invoker;

