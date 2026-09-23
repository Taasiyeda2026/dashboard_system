-- Instructor attendance submission must not be blocked by asynchronous travel calculation.
-- Pending/unavailable travel compensation remains available to the scoped team manager and admin
-- through the attendance-control data flow.

drop trigger if exists av2_guard_attendance_submission_travel on public.attendance_month_approvals;
drop function if exists public.av2_guard_attendance_submission_travel();

create or replace function public.av2_submit_attendance_month(
  p_month_key text,
  p_submitted_by_name text default null
)
returns public.attendance_month_approvals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp bigint;
  saved public.attendance_month_approvals%rowtype;
begin
  if coalesce(p_month_key,'') !~ '^\\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_month_key';
  end if;

  select emp_id::bigint
    into v_emp
  from public.users
  where auth_user_id = auth.uid()
    and is_active = true
  limit 1;

  if v_emp is null then
    raise exception 'attendance_auth_required' using errcode='42501';
  end if;

  -- Lock the instructor's month rows for a consistent submission snapshot.
  -- Travel compensation is deliberately not a submission prerequisite.
  perform 1
  from public.attendance_records
  where emp_id = v_emp
    and to_char(report_date,'YYYY-MM') = p_month_key
  for update;

  insert into public.attendance_month_approvals(
    emp_id,
    month_key,
    status,
    submitted_at,
    submitted_by_name,
    updated_at
  )
  values(
    v_emp,
    p_month_key,
    'submitted',
    now(),
    btrim(coalesce(p_submitted_by_name,'')),
    now()
  )
  on conflict(emp_id,month_key) do update
    set status='submitted',
        submitted_at=now(),
        submitted_by_name=excluded.submitted_by_name,
        updated_at=now()
  returning * into saved;

  return saved;
end $$;

revoke all on function public.av2_submit_attendance_month(text,text) from public, anon;
grant execute on function public.av2_submit_attendance_month(text,text) to authenticated;

comment on function public.av2_submit_attendance_month(text,text) is
  'Instructor month submission. Travel compensation is asynchronous and never blocks instructor submission; unresolved travel is handled in manager/admin attendance control.';
