create or replace function public.attendance_control_expenses(
  p_emp_ids text[],
  p_from_date date,
  p_to_date date
)
returns table (
  emp_id text,
  report_id uuid,
  employee_id uuid,
  expense_date date,
  amount numeric,
  description text,
  notes text
)
language sql
stable
security definer
set search_path = public
as $function$
  select
    u.emp_id,
    e.report_id,
    e.employee_id,
    e.expense_date,
    e.amount,
    e.description,
    e.notes
  from public.users u
  join public.personal_reports r on r.employee_id = u.auth_user_id
  join public.expense_entries e on e.report_id = r.id and e.employee_id = u.auth_user_id
  where auth.uid() is not null
    and (
      private.dashboard_user_can_manage_personal_reports()
      or public.app_current_role() = 'operation_manager'
    )
    and u.is_active = true
    and u.emp_id = any(coalesce(p_emp_ids, array[]::text[]))
    and e.expense_date between p_from_date and p_to_date;
$function$;

revoke all on function public.attendance_control_expenses(text[], date, date) from public;
grant execute on function public.attendance_control_expenses(text[], date, date) to authenticated;
