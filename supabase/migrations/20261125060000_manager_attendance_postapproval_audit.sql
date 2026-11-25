-- Read-only audit: identify attendance records changed after manager signed the month.
-- Does not rewrite attendance, approvals, payroll, travel, or approved PDF snapshots.
-- Authorization is evaluated for each requested employee on the server.
create or replace function public.get_manager_attendance_postapproval_changes(
  p_employee_ids bigint[],
  p_month_key text
)
returns table(employee_id bigint, changed_records bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_month_start date;
begin
  if auth.uid() is null then
    raise exception 'attendance_manager_auth_required' using errcode = '42501';
  end if;

  if p_month_key is null
     or p_month_key !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_month_key' using errcode = '22023';
  end if;

  if p_employee_ids is null or cardinality(p_employee_ids) = 0 then
    return;
  end if;

  v_month_start := (p_month_key || '-01')::date;

  return query
  select
    m.emp_id,
    count(r.id)::bigint as changed_records
  from public.attendance_month_approvals m
  join public.attendance_records r
    on r.emp_id = m.emp_id
   and r.report_date >= v_month_start
   and r.report_date < (v_month_start + interval '1 month')::date
   and r.updated_at > m.manager_approved_at
  where m.month_key = p_month_key
    and m.manager_approved_at is not null
    and m.emp_id = any(p_employee_ids)
    and public.attendance_manager_can_review_employee(m.emp_id)
  group by m.emp_id;
end;
$$;

revoke all on function public.get_manager_attendance_postapproval_changes(bigint[],text)
from public, anon, authenticated;
grant execute on function public.get_manager_attendance_postapproval_changes(bigint[],text)
to authenticated;

comment on function public.get_manager_attendance_postapproval_changes(bigint[],text) is
  'Read-only, server-authorized count of attendance record updates after monthly manager approval. Does not detect deletions or retroactively alter approved snapshots.';
