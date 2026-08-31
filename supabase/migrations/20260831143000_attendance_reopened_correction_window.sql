-- Keep the database write gate aligned with attendance/src/services/month-gate.service.js:
-- normal previous-month writes are allowed through day 2, and reopened corrections through day 7.
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
  v_current_month date := date_trunc('month', current_date)::date;
  v_report_month date := date_trunc('month', p_report_date)::date;
begin
  select u.emp_id::bigint
  into v_emp_id
  from public.users u
  where u.auth_user_id = auth.uid()
  limit 1;

  if v_emp_id is null then return false; end if;

  v_month_key := to_char(p_report_date, 'YYYY-MM');
  select ama.status
  into v_status
  from public.attendance_month_approvals ama
  where ama.emp_id = v_emp_id
    and ama.month_key = v_month_key;

  v_status := coalesce(v_status, 'open');
  if v_status in ('submitted', 'locked', 'approved_for_payroll') then return false; end if;

  if v_report_month = v_current_month then return true; end if;
  if v_report_month <> (v_current_month - interval '1 month')::date then return false; end if;

  if extract(day from current_date)::int <= 2 then return true; end if;
  return v_status = 'reopened' and extract(day from current_date)::int <= 7;
end;
$$;

revoke all on function public.av2_can_write_month(date) from public, anon;
grant execute on function public.av2_can_write_month(date) to authenticated;

-- Block direct API/RPC attempts to reopen current-ineligible months as well.
create or replace function public.av2_guard_reopened_correction_window()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_target_month date;
  v_current_month date := date_trunc('month', current_date)::date;
begin
  if new.status is distinct from 'reopened' or (tg_op = 'UPDATE' and old.status = 'reopened') then
    return new;
  end if;

  v_target_month := to_date(new.month_key || '-01', 'YYYY-MM-DD');
  if v_target_month = v_current_month then return new; end if;
  if v_target_month = (v_current_month - interval '1 month')::date
     and extract(day from current_date)::int <= 7 then
    return new;
  end if;

  raise exception 'attendance_reopen_window_closed' using errcode = '22023';
end;
$$;

drop trigger if exists av2_guard_reopened_correction_window on public.attendance_month_approvals;
create trigger av2_guard_reopened_correction_window
before insert or update of status on public.attendance_month_approvals
for each row execute function public.av2_guard_reopened_correction_window();
