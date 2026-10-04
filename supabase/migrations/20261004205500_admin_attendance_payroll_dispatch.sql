-- Separate admin attendance approval from the explicit payroll dispatch step.
-- A final admin approval is review state; finance only sees rows after dispatch.

alter table public.payroll_control_approvals
  drop constraint if exists payroll_control_approvals_status_check;

alter table public.payroll_control_approvals
  add constraint payroll_control_approvals_status_check
  check (status in ('admin_approved', 'approved_for_payroll'));

alter table public.payroll_control_approvals
  add column if not exists payroll_dispatched_at timestamptz,
  add column if not exists payroll_dispatched_by_user_id uuid,
  add column if not exists payroll_dispatched_by_name text;

create table if not exists public.payroll_attendance_dispatches (
  id uuid primary key default gen_random_uuid(),
  approval_id uuid not null,
  employee_id text not null check (btrim(employee_id) <> ''),
  month_key text not null check (month_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  dispatched_at timestamptz not null default now(),
  dispatched_by_user_id uuid not null,
  dispatched_by_name text not null default '',
  created_at timestamptz not null default now(),
  unique (approval_id)
);

create index if not exists payroll_attendance_dispatches_month_idx
  on public.payroll_attendance_dispatches (month_key, dispatched_at desc);

create index if not exists payroll_attendance_dispatches_employee_idx
  on public.payroll_attendance_dispatches (employee_id, month_key, dispatched_at desc);

alter table public.payroll_attendance_dispatches enable row level security;

drop policy if exists payroll_attendance_dispatches_select on public.payroll_attendance_dispatches;
create policy payroll_attendance_dispatches_select
on public.payroll_attendance_dispatches
for select
to authenticated
using ((select public.app_can_read_payroll_control_approvals()));

revoke all on table public.payroll_attendance_dispatches from public, anon;
grant select on table public.payroll_attendance_dispatches to authenticated;

-- Legacy approved_for_payroll rows were already exposed to finance, so record them
-- as previously dispatched rather than making them appear newly pending.
update public.payroll_control_approvals
set payroll_dispatched_at = coalesce(payroll_dispatched_at, approved_at),
    payroll_dispatched_by_user_id = coalesce(payroll_dispatched_by_user_id, approved_by_user_id),
    payroll_dispatched_by_name = coalesce(payroll_dispatched_by_name, approved_by_name)
where status = 'approved_for_payroll';

insert into public.payroll_attendance_dispatches (
  approval_id,
  employee_id,
  month_key,
  dispatched_at,
  dispatched_by_user_id,
  dispatched_by_name
)
select
  p.id,
  p.employee_id,
  p.month_key,
  coalesce(p.payroll_dispatched_at, p.approved_at),
  coalesce(p.payroll_dispatched_by_user_id, p.approved_by_user_id),
  coalesce(p.payroll_dispatched_by_name, p.approved_by_name, '')
from public.payroll_control_approvals p
where p.status = 'approved_for_payroll'
on conflict (approval_id) do nothing;

create or replace function public.admin_finalize_attendance_month_payroll(
  p_employee_id text,
  p_month_key text,
  p_final_approved_by_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp_id bigint;
  v_role text;
  v_actor_name text;
  v_month_row public.attendance_month_approvals%rowtype;
  v_employee_name text;
  v_saved public.payroll_control_approvals%rowtype;
begin
  if coalesce(trim(p_month_key), '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_month_key' using errcode = '22023';
  end if;
  if coalesce(trim(p_employee_id), '') !~ '^[0-9]+$' then
    raise exception 'invalid_employee_id' using errcode = '22023';
  end if;
  v_emp_id := trim(p_employee_id)::bigint;

  select
    lower(trim(coalesce(u.role, ''))),
    coalesce(
      nullif(trim(coalesce(p_final_approved_by_name, '')), ''),
      nullif(trim(coalesce(u.full_name, '')), ''),
      nullif(trim(coalesce(u.name, '')), ''),
      nullif(trim(coalesce(u.username, '')), '')
    )
  into v_role, v_actor_name
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.is_active = true
  limit 1;

  if v_role is null then
    raise exception 'payroll_attendance_auth_required' using errcode = '42501';
  end if;
  if v_role <> 'admin' then
    raise exception 'payroll_attendance_permission_denied' using errcode = '42501';
  end if;

  select *
    into v_month_row
  from public.attendance_month_approvals
  where emp_id = v_emp_id
    and month_key = trim(p_month_key)
  limit 1
  for update;

  if not found then
    raise exception 'attendance_month_not_found' using errcode = '22023';
  end if;
  if coalesce(nullif(trim(v_month_row.status), ''), 'open') <> 'locked' then
    raise exception 'attendance_month_not_manager_approved' using errcode = '22023';
  end if;
  if v_month_row.manager_approved_at is null then
    raise exception 'attendance_month_manager_signature_missing' using errcode = '22023';
  end if;
  if nullif(trim(coalesce(v_month_row.manager_pdf_sharepoint_url, '')), '') is null then
    raise exception 'attendance_month_manager_pdf_missing' using errcode = '22023';
  end if;

  select *
    into v_saved
  from public.payroll_control_approvals
  where employee_id = trim(p_employee_id)
    and month_key = trim(p_month_key)
  limit 1
  for update;

  if found and v_saved.status = 'approved_for_payroll' then
    return to_jsonb(v_saved);
  end if;

  select coalesce(
    nullif(trim(coalesce(ci.full_name, '')), ''),
    nullif(trim(coalesce((v_month_row.manager_approved_snapshot ->> 'employeeName'), '')), ''),
    trim(p_employee_id)
  )
  into v_employee_name
  from public.contacts_instructors ci
  where ci.emp_id = v_emp_id
  limit 1;

  insert into public.payroll_control_approvals (
    employee_id,
    employee_name,
    month_key,
    approved_by_user_id,
    approved_by_name,
    approved_at,
    status,
    approval_text_version,
    pdf_path,
    pdf_file_name,
    approved_snapshot,
    payroll_dispatched_at,
    payroll_dispatched_by_user_id,
    payroll_dispatched_by_name,
    created_at,
    updated_at
  ) values (
    trim(p_employee_id),
    coalesce(v_employee_name, trim(p_employee_id)),
    trim(p_month_key),
    auth.uid(),
    coalesce(v_actor_name, ''),
    now(),
    'admin_approved',
    'attendance-month-final-admin-v2',
    v_month_row.manager_pdf_sharepoint_url,
    v_month_row.manager_pdf_file_name,
    coalesce(v_month_row.manager_approved_snapshot, '{}'::jsonb),
    null,
    null,
    null,
    now(),
    now()
  )
  on conflict (employee_id, month_key) do update
  set employee_name = excluded.employee_name,
      approved_by_user_id = excluded.approved_by_user_id,
      approved_by_name = excluded.approved_by_name,
      approved_at = excluded.approved_at,
      status = 'admin_approved',
      approval_text_version = excluded.approval_text_version,
      pdf_path = excluded.pdf_path,
      pdf_file_name = excluded.pdf_file_name,
      approved_snapshot = excluded.approved_snapshot,
      payroll_dispatched_at = null,
      payroll_dispatched_by_user_id = null,
      payroll_dispatched_by_name = null,
      updated_at = now()
  returning * into v_saved;

  return to_jsonb(v_saved);
end;
$$;

create or replace function public.admin_send_attendance_month_to_payroll(
  p_employee_id text,
  p_month_key text,
  p_sent_by_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_actor_name text;
  v_row public.payroll_control_approvals%rowtype;
begin
  if coalesce(trim(p_month_key), '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_month_key' using errcode = '22023';
  end if;
  if coalesce(trim(p_employee_id), '') !~ '^[0-9]+$' then
    raise exception 'invalid_employee_id' using errcode = '22023';
  end if;

  select
    lower(trim(coalesce(u.role, ''))),
    coalesce(
      nullif(trim(coalesce(p_sent_by_name, '')), ''),
      nullif(trim(coalesce(u.full_name, '')), ''),
      nullif(trim(coalesce(u.name, '')), ''),
      nullif(trim(coalesce(u.username, '')), '')
    )
  into v_role, v_actor_name
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.is_active = true
  limit 1;

  if v_role is null then
    raise exception 'payroll_attendance_auth_required' using errcode = '42501';
  end if;
  if v_role <> 'admin' then
    raise exception 'payroll_attendance_permission_denied' using errcode = '42501';
  end if;

  select * into v_row
  from public.payroll_control_approvals
  where employee_id = trim(p_employee_id)
    and month_key = trim(p_month_key)
  limit 1
  for update;

  if not found then
    raise exception 'attendance_month_admin_approval_required' using errcode = '22023';
  end if;
  if v_row.status = 'approved_for_payroll' then
    return to_jsonb(v_row);
  end if;
  if v_row.status <> 'admin_approved' then
    raise exception 'attendance_month_admin_approval_required' using errcode = '22023';
  end if;

  update public.payroll_control_approvals
  set status = 'approved_for_payroll',
      payroll_dispatched_at = now(),
      payroll_dispatched_by_user_id = auth.uid(),
      payroll_dispatched_by_name = coalesce(v_actor_name, ''),
      updated_at = now()
  where id = v_row.id
  returning * into v_row;

  insert into public.payroll_attendance_dispatches (
    approval_id,
    employee_id,
    month_key,
    dispatched_at,
    dispatched_by_user_id,
    dispatched_by_name
  ) values (
    v_row.id,
    v_row.employee_id,
    v_row.month_key,
    v_row.payroll_dispatched_at,
    auth.uid(),
    coalesce(v_actor_name, '')
  )
  on conflict (approval_id) do nothing;

  return to_jsonb(v_row);
end;
$$;

create or replace function public.admin_send_attendance_month_to_payroll_batch(
  p_month_key text,
  p_employee_ids text[] default null,
  p_sent_by_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_actor_name text;
  v_sent integer := 0;
begin
  if coalesce(trim(p_month_key), '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_month_key' using errcode = '22023';
  end if;

  select
    lower(trim(coalesce(u.role, ''))),
    coalesce(
      nullif(trim(coalesce(p_sent_by_name, '')), ''),
      nullif(trim(coalesce(u.full_name, '')), ''),
      nullif(trim(coalesce(u.name, '')), ''),
      nullif(trim(coalesce(u.username, '')), '')
    )
  into v_role, v_actor_name
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.is_active = true
  limit 1;

  if v_role is null then
    raise exception 'payroll_attendance_auth_required' using errcode = '42501';
  end if;
  if v_role <> 'admin' then
    raise exception 'payroll_attendance_permission_denied' using errcode = '42501';
  end if;

  with updated as (
    update public.payroll_control_approvals p
    set status = 'approved_for_payroll',
        payroll_dispatched_at = now(),
        payroll_dispatched_by_user_id = auth.uid(),
        payroll_dispatched_by_name = coalesce(v_actor_name, ''),
        updated_at = now()
    where p.month_key = trim(p_month_key)
      and p.status = 'admin_approved'
      and (
        p_employee_ids is null
        or p.employee_id = any(p_employee_ids)
      )
    returning p.*
  ), logged as (
    insert into public.payroll_attendance_dispatches (
      approval_id,
      employee_id,
      month_key,
      dispatched_at,
      dispatched_by_user_id,
      dispatched_by_name
    )
    select
      u.id,
      u.employee_id,
      u.month_key,
      u.payroll_dispatched_at,
      auth.uid(),
      coalesce(v_actor_name, '')
    from updated u
    on conflict (approval_id) do nothing
    returning 1
  )
  select count(*)::integer into v_sent from updated;

  return jsonb_build_object(
    'month_key', trim(p_month_key),
    'sent_count', v_sent
  );
end;
$$;

-- Keep workflow reporting aware of both final-admin states. The existing return
-- shape remains unchanged for compatibility with manager and employee screens.
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
  submitted_by_name text,
  manager_approved_at timestamptz,
  manager_approved_by_name text,
  manager_pdf_sharepoint_url text,
  manager_pdf_file_name text,
  payroll_approved_at timestamptz,
  payroll_approved_by_name text
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
  if coalesce(trim(p_month_key), '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
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
    trim(p_month_key),
    coalesce(nullif(trim(ma.status), ''), 'open') as attendance_submission_status,
    case
      when pca.id is not null then 'approved'
      when coalesce(nullif(trim(ma.status), ''), 'open') = 'locked'
           and ma.manager_approved_at is not null then 'manager_approved'
      when coalesce(nullif(trim(ma.status), ''), 'open') in ('submitted', 'locked') then 'submitted'
      else 'not_submitted'
    end as workflow_status,
    ma.submitted_at,
    coalesce(nullif(trim(ma.submitted_by_name), ''), ''),
    ma.manager_approved_at,
    coalesce(nullif(trim(ma.manager_approved_by_name), ''), ''),
    coalesce(nullif(trim(ma.manager_pdf_sharepoint_url), ''), ''),
    coalesce(nullif(trim(ma.manager_pdf_file_name), ''), ''),
    pca.approved_at,
    coalesce(nullif(trim(pca.approved_by_name), ''), '')
  from visible v
  left join public.attendance_month_approvals ma
    on ma.emp_id::text = v.employee_id
   and ma.month_key = trim(p_month_key)
  left join public.payroll_control_approvals pca
    on pca.employee_id = v.employee_id
   and pca.month_key = trim(p_month_key)
   and pca.status in ('admin_approved', 'approved_for_payroll');
end;
$$;

revoke all on function public.admin_finalize_attendance_month_payroll(text, text, text) from public, anon;
revoke all on function public.admin_send_attendance_month_to_payroll(text, text, text) from public, anon;
revoke all on function public.admin_send_attendance_month_to_payroll_batch(text, text[], text) from public, anon;
revoke all on function public.get_payroll_attendance_month_statuses(text, text[]) from public, anon;

grant execute on function public.admin_finalize_attendance_month_payroll(text, text, text) to authenticated;
grant execute on function public.admin_send_attendance_month_to_payroll(text, text, text) to authenticated;
grant execute on function public.admin_send_attendance_month_to_payroll_batch(text, text[], text) to authenticated;
grant execute on function public.get_payroll_attendance_month_statuses(text, text[]) to authenticated;

comment on table public.payroll_attendance_dispatches is
  'Immutable audit of explicit admin transfers of attendance approvals to payroll. Preserved when a month is reopened.';
comment on function public.admin_send_attendance_month_to_payroll(text, text, text) is
  'Admin-only explicit payroll dispatch for one final-approved attendance month; idempotent for already-dispatched approvals.';
comment on function public.admin_send_attendance_month_to_payroll_batch(text, text[], text) is
  'Admin-only explicit payroll dispatch for all currently admin-approved employees in the requested month/scope.';
