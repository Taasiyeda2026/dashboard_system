-- Keep payroll-control final approval aligned with attendance month submission state.
-- Flow: not_submitted -> submitted -> in_review -> approved.

alter table public.payroll_control_approvals
  add column if not exists submission_override boolean not null default false,
  add column if not exists submission_override_reason text,
  add column if not exists submission_override_by_user_id uuid,
  add column if not exists submission_override_at timestamptz,
  add column if not exists submission_attendance_status text;

comment on column public.payroll_control_approvals.submission_override is
  'True only for explicit authorized exceptions where payroll approval is saved before instructor month submission.';
comment on column public.payroll_control_approvals.submission_override_reason is
  'Required reason text for explicit authorized pre-submission payroll approval override.';
comment on column public.payroll_control_approvals.submission_attendance_status is
  'Attendance-month status captured at approval time (open/reopened/submitted/locked).';

create or replace function public.get_payroll_attendance_month_statuses(
  p_month_key text,
  p_employee_ids text[] default null
)
returns table (
  employee_id text,
  month_key text,
  attendance_submission_status text,
  workflow_status text,
  submitted_at timestamptz,
  payroll_approved_at timestamptz
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
  if coalesce(trim(p_month_key), '') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_month_key' using errcode = '22023';
  end if;

  select
    lower(trim(coalesce(u.role, ''))),
    coalesce(
      nullif(trim(coalesce(u.full_name, '')), ''),
      nullif(trim(coalesce(u.name, '')), ''),
      nullif(trim(coalesce(u.username, '')), '')
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
  with requested as (
    select distinct trim(value) as employee_id
    from unnest(coalesce(p_employee_ids, array[]::text[])) as value
    where coalesce(trim(value), '') <> ''
  ),
  visible as (
    select r.employee_id
    from requested r
    left join public.contacts_instructors ci
      on ci.emp_id::text = r.employee_id
    where (
      v_role in ('admin', 'operation_manager', 'finance')
      or (
        v_role in ('activities_manager', 'manager', 'instructor_manager')
        and ci.emp_id is not null
        and lower(trim(coalesce(ci.direct_manager, ''))) = lower(trim(coalesce(v_own_name, '')))
        and lower(trim(coalesce(ci.active::text, ''))) not in ('no', 'false', '0', 'לא')
      )
    )
  )
  select
    v.employee_id,
    p_month_key,
    coalesce(nullif(trim(ma.status), ''), 'open') as attendance_submission_status,
    case
      when pca.id is not null then 'approved'
      when coalesce(nullif(trim(ma.status), ''), 'open') = 'locked' then 'in_review'
      when coalesce(nullif(trim(ma.status), ''), 'open') = 'submitted' then 'submitted'
      else 'not_submitted'
    end as workflow_status,
    ma.submitted_at,
    pca.approved_at as payroll_approved_at
  from visible v
  left join public.attendance_month_approvals ma
    on ma.emp_id::text = v.employee_id
   and ma.month_key = p_month_key
  left join public.payroll_control_approvals pca
    on pca.employee_id = v.employee_id
   and pca.month_key = p_month_key
   and pca.status = 'approved_for_payroll';
end
$$;

revoke all on function public.get_payroll_attendance_month_statuses(text, text[]) from public, anon;
grant execute on function public.get_payroll_attendance_month_statuses(text, text[]) to authenticated;

drop policy if exists payroll_control_approvals_select on public.payroll_control_approvals;
create policy payroll_control_approvals_select
on public.payroll_control_approvals
for select
to authenticated
using (
  approved_by_user_id = (select auth.uid())
  or employee_id = (
    select u.emp_id::text
    from public.users u
    where u.auth_user_id = auth.uid()
      and u.is_active = true
    limit 1
  )
  or (select public.app_can_read_payroll_control_approvals())
);

create or replace function public.enforce_payroll_control_submission_gate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month_status text;
  v_role text;
  v_override_requested boolean;
  v_override_reason text;
begin
  select coalesce(nullif(trim(status), ''), 'open')
  into v_month_status
  from public.attendance_month_approvals
  where emp_id::text = new.employee_id
    and month_key = new.month_key
  limit 1;
  v_month_status := coalesce(v_month_status, 'open');

  v_override_requested := coalesce(new.submission_override, false);
  v_override_reason := nullif(trim(coalesce(new.submission_override_reason, '')), '');
  v_role := lower(trim(coalesce(public.app_current_role(), '')));

  if v_month_status in ('submitted', 'locked') then
    new.submission_override := false;
    new.submission_override_reason := null;
    new.submission_override_by_user_id := null;
    new.submission_override_at := null;
    new.submission_attendance_status := v_month_status;
    return new;
  end if;

  if v_override_requested then
    if v_role not in ('admin', 'operation_manager') then
      raise exception 'payroll_approval_override_not_authorized' using errcode = '42501';
    end if;
    if v_override_reason is null then
      raise exception 'payroll_approval_override_reason_required' using errcode = '22023';
    end if;
    new.submission_override := true;
    new.submission_override_reason := v_override_reason;
    new.submission_override_by_user_id := auth.uid();
    new.submission_override_at := now();
    new.submission_attendance_status := v_month_status;
    return new;
  end if;

  raise exception 'payroll_approval_requires_submitted_month' using errcode = '22023';
end;
$$;

drop trigger if exists payroll_control_submission_gate on public.payroll_control_approvals;
create trigger payroll_control_submission_gate
before insert or update on public.payroll_control_approvals
for each row execute function public.enforce_payroll_control_submission_gate();
