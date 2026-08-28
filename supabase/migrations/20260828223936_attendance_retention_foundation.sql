-- Attendance retention and scaling foundation.
-- Policy: attendance rows are retained in PostgreSQL; finalized months are immutable
-- until an explicit admin correction flow reopens the month.

create index if not exists attendance_records_emp_date_time_idx
  on public.attendance_records (emp_id, report_date, start_time);

create index if not exists attendance_records_date_emp_time_idx
  on public.attendance_records (report_date, emp_id, start_time);

create index if not exists attendance_record_attachments_record_idx
  on public.attendance_record_attachments (record_id);

create index if not exists attendance_month_approvals_month_status_emp_idx
  on public.attendance_month_approvals (month_key, status, emp_id);

comment on table public.attendance_records is
  'Canonical row-level attendance history. Rows are retained; finalized months are archived logically and are not automatically deleted.';

comment on column public.attendance_month_approvals.manager_approved_snapshot is
  'Immutable manager-approved monthly snapshot used for audit and final payroll approval.';

comment on column public.payroll_control_approvals.approved_snapshot is
  'Immutable final payroll snapshot. Source of truth for audit and deterministic regeneration of the approved Excel export.';

create or replace function public.av2_attendance_month_is_closed(
  p_emp_id bigint,
  p_report_date date
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1
      from public.attendance_month_approvals ama
      where ama.emp_id = p_emp_id
        and ama.month_key = to_char(p_report_date, 'YYYY-MM')
        and ama.status = 'locked'
    )
    or exists (
      select 1
      from public.payroll_control_approvals pca
      where pca.employee_id = p_emp_id::text
        and pca.month_key = to_char(p_report_date, 'YYYY-MM')
        and pca.status = 'approved_for_payroll'
    );
$$;

revoke all on function public.av2_attendance_month_is_closed(bigint, date) from public;
grant execute on function public.av2_attendance_month_is_closed(bigint, date) to authenticated;

create or replace function public.av2_guard_attendance_record_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Protect the month the existing row belongs to. This prevents edits, deletes,
  -- and moving a row out of a manager/final-approved month.
  if tg_op in ('UPDATE', 'DELETE')
     and public.av2_attendance_month_is_closed(old.emp_id, old.report_date) then
    raise exception 'attendance_month_locked' using errcode = '55000';
  end if;

  -- Also prevent inserts or moving rows into a closed month.
  if tg_op in ('INSERT', 'UPDATE')
     and public.av2_attendance_month_is_closed(new.emp_id, new.report_date) then
    raise exception 'attendance_month_locked' using errcode = '55000';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists av2_guard_attendance_record_lifecycle on public.attendance_records;
create trigger av2_guard_attendance_record_lifecycle
before insert or update or delete on public.attendance_records
for each row execute function public.av2_guard_attendance_record_lifecycle();

-- Attendance-control team discovery must not scan the growing attendance history.
-- Return the active instructor roster directly from contacts_instructors while
-- preserving the same role/direct-manager visibility rules as attendance records.
create or replace function public.get_payroll_attendance_team_roster()
returns table(
  employee_id text,
  employee_name text,
  employment_type text,
  team text,
  role text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  v_own_name text;
begin
  select
    lower(trim(coalesce(u.role, ''))),
    coalesce(
      nullif(trim(coalesce(u.full_name, '')), ''),
      nullif(trim(coalesce(u.name, '')), ''),
      nullif(trim(coalesce(u.username, '')), ''),
      ''
    )
  into v_role, v_own_name
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.is_active = true
  limit 1;

  if v_role is null then
    raise exception 'payroll_attendance_auth_required' using errcode = '42501';
  end if;

  if v_role not in ('admin', 'operation_manager', 'activities_manager', 'finance', 'manager', 'instructor_manager') then
    raise exception 'payroll_attendance_permission_denied' using errcode = '42501';
  end if;

  return query
  select
    ci.emp_id::text,
    coalesce(nullif(trim(coalesce(ci.full_name, '')), ''), ci.emp_id::text),
    coalesce(ci.employment_type, ''),
    coalesce(ci.direct_manager, ''),
    'instructor'::text
  from public.contacts_instructors ci
  where lower(trim(coalesce(ci.active::text, ''))) not in ('no', 'false', '0', 'לא')
    and (
      v_role in ('admin', 'operation_manager', 'finance')
      or (
        v_role in ('activities_manager', 'manager', 'instructor_manager')
        and lower(trim(coalesce(ci.direct_manager, ''))) = lower(trim(coalesce(v_own_name, '')))
      )
    )
  order by coalesce(ci.direct_manager, ''), coalesce(ci.full_name, ci.emp_id::text), ci.emp_id;
end;
$$;

revoke all on function public.get_payroll_attendance_team_roster() from public;
grant execute on function public.get_payroll_attendance_team_roster() to authenticated;

comment on function public.get_payroll_attendance_team_roster() is
  'Lightweight attendance-control roster. Avoids all-history attendance_records scans as row volume grows.';
