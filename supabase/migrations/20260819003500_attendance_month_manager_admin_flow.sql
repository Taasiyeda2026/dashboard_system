-- Attendance monthly approval flow:
-- employee submit -> direct manager approval -> admin final approval.

alter table public.attendance_month_approvals
  add column if not exists submitted_by_name text,
  add column if not exists manager_approved_at timestamptz,
  add column if not exists manager_approved_by_user_id uuid,
  add column if not exists manager_approved_by_name text,
  add column if not exists manager_pdf_sharepoint_url text,
  add column if not exists manager_pdf_sharepoint_item_id text,
  add column if not exists manager_pdf_file_name text,
  add column if not exists manager_pdf_version integer not null default 0,
  add column if not exists manager_approved_snapshot jsonb not null default '{}'::jsonb;

comment on column public.attendance_month_approvals.submitted_by_name is
  'Human-readable employee full name captured at employee month approval time.';
comment on column public.attendance_month_approvals.manager_approved_at is
  'Timestamp when the direct manager approved the month after review.';
comment on column public.attendance_month_approvals.manager_approved_by_user_id is
  'Auth user id of manager that approved the month.';
comment on column public.attendance_month_approvals.manager_approved_by_name is
  'Human-readable manager full name captured at manager approval time.';
comment on column public.attendance_month_approvals.manager_pdf_sharepoint_url is
  'Final manager-approved monthly attendance PDF URL stored in SharePoint.';
comment on column public.attendance_month_approvals.manager_pdf_sharepoint_item_id is
  'SharePoint file item id for the manager-approved monthly attendance PDF.';
comment on column public.attendance_month_approvals.manager_pdf_file_name is
  'Stored filename for the manager-approved monthly attendance PDF.';
comment on column public.attendance_month_approvals.manager_pdf_version is
  'Monotonic manager approval PDF version for a given employee/month.';
comment on column public.attendance_month_approvals.manager_approved_snapshot is
  'Manager-approved attendance snapshot (rows and summary) used for final payroll approval.';

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
    pca.approved_at as payroll_approved_at,
    coalesce(nullif(trim(pca.approved_by_name), ''), '') as payroll_approved_by_name
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

create or replace function public.manager_finalize_attendance_month_review(
  p_employee_id text,
  p_month_key text,
  p_manager_name text,
  p_manager_pdf_sharepoint_url text,
  p_manager_pdf_sharepoint_item_id text,
  p_manager_pdf_file_name text,
  p_manager_pdf_version integer,
  p_manager_approved_snapshot jsonb default '{}'::jsonb
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
  v_is_direct_manager boolean := false;
  v_row public.attendance_month_approvals%rowtype;
  v_pdf_url text := nullif(trim(coalesce(p_manager_pdf_sharepoint_url, '')), '');
  v_pdf_item_id text := nullif(trim(coalesce(p_manager_pdf_sharepoint_item_id, '')), '');
  v_pdf_file_name text := nullif(trim(coalesce(p_manager_pdf_file_name, '')), '');
  v_version integer;
begin
  if coalesce(trim(p_month_key), '') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_month_key' using errcode = '22023';
  end if;
  if coalesce(trim(p_employee_id), '') !~ '^[0-9]+$' then
    raise exception 'invalid_employee_id' using errcode = '22023';
  end if;
  v_emp_id := trim(p_employee_id)::bigint;

  select
    lower(trim(coalesce(u.role, ''))),
    coalesce(
      nullif(trim(coalesce(p_manager_name, '')), ''),
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

  if v_role not in ('admin', 'operation_manager', 'activities_manager', 'manager', 'instructor_manager') then
    raise exception 'payroll_attendance_permission_denied' using errcode = '42501';
  end if;

  if v_role in ('activities_manager', 'manager', 'instructor_manager') then
    select exists (
      select 1
      from public.contacts_instructors ci
      where ci.emp_id = v_emp_id
        and lower(trim(coalesce(ci.direct_manager, ''))) = lower(trim(coalesce(v_actor_name, '')))
        and lower(trim(coalesce(ci.active::text, ''))) not in ('no', 'false', '0', 'לא')
    ) into v_is_direct_manager;

    if not coalesce(v_is_direct_manager, false) then
      raise exception 'payroll_attendance_permission_denied' using errcode = '42501';
    end if;
  end if;

  if v_pdf_url is null or v_pdf_file_name is null then
    raise exception 'manager_pdf_required' using errcode = '22023';
  end if;

  select *
  into v_row
  from public.attendance_month_approvals
  where emp_id = v_emp_id
    and month_key = p_month_key
  limit 1
  for update;

  if not found then
    raise exception 'attendance_month_submission_required' using errcode = '22023';
  end if;

  if coalesce(nullif(trim(v_row.status), ''), 'open') <> 'submitted' then
    raise exception 'attendance_month_not_submitted_for_manager_review' using errcode = '22023';
  end if;

  v_version := greatest(coalesce(p_manager_pdf_version, 0), coalesce(v_row.manager_pdf_version, 0) + 1);

  update public.attendance_month_approvals
  set
    status = 'locked',
    manager_approved_at = now(),
    manager_approved_by_user_id = auth.uid(),
    manager_approved_by_name = coalesce(v_actor_name, ''),
    manager_pdf_sharepoint_url = v_pdf_url,
    manager_pdf_sharepoint_item_id = v_pdf_item_id,
    manager_pdf_file_name = v_pdf_file_name,
    manager_pdf_version = v_version,
    manager_approved_snapshot = coalesce(p_manager_approved_snapshot, '{}'::jsonb),
    updated_at = now()
  where emp_id = v_emp_id
    and month_key = p_month_key
  returning *
  into v_row;

  return jsonb_build_object(
    'employee_id', p_employee_id,
    'month_key', p_month_key,
    'status', v_row.status,
    'manager_approved_at', v_row.manager_approved_at,
    'manager_approved_by_name', v_row.manager_approved_by_name,
    'manager_pdf_sharepoint_url', v_row.manager_pdf_sharepoint_url,
    'manager_pdf_sharepoint_item_id', v_row.manager_pdf_sharepoint_item_id,
    'manager_pdf_file_name', v_row.manager_pdf_file_name,
    'manager_pdf_version', v_row.manager_pdf_version
  );
end
$$;

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
  if coalesce(trim(p_month_key), '') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
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
    and month_key = p_month_key
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

  select coalesce(
    nullif(trim(coalesce(ci.full_name, '')), ''),
    nullif(trim(coalesce((v_month_row.manager_approved_snapshot ->> 'employeeName'), '')), ''),
    p_employee_id
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
    created_at,
    updated_at
  )
  values (
    p_employee_id,
    coalesce(v_employee_name, p_employee_id),
    p_month_key,
    auth.uid(),
    coalesce(v_actor_name, ''),
    now(),
    'approved_for_payroll',
    'attendance-month-final-admin-v1',
    v_month_row.manager_pdf_sharepoint_url,
    v_month_row.manager_pdf_file_name,
    coalesce(v_month_row.manager_approved_snapshot, '{}'::jsonb),
    now(),
    now()
  )
  on conflict (employee_id, month_key)
  do update
  set
    employee_name = excluded.employee_name,
    approved_by_user_id = excluded.approved_by_user_id,
    approved_by_name = excluded.approved_by_name,
    approved_at = excluded.approved_at,
    status = excluded.status,
    approval_text_version = excluded.approval_text_version,
    pdf_path = excluded.pdf_path,
    pdf_file_name = excluded.pdf_file_name,
    approved_snapshot = excluded.approved_snapshot,
    updated_at = now()
  returning *
  into v_saved;

  return to_jsonb(v_saved);
end
$$;

create or replace function public.admin_reopen_attendance_month_for_correction(
  p_employee_id text,
  p_month_key text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp_id bigint;
  v_role text;
  v_row public.attendance_month_approvals%rowtype;
begin
  if coalesce(trim(p_month_key), '') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_month_key' using errcode = '22023';
  end if;
  if coalesce(trim(p_employee_id), '') !~ '^[0-9]+$' then
    raise exception 'invalid_employee_id' using errcode = '22023';
  end if;
  v_emp_id := trim(p_employee_id)::bigint;

  select lower(trim(coalesce(u.role, '')))
  into v_role
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

  update public.attendance_month_approvals
  set
    status = 'reopened',
    submitted_at = null,
    submitted_by_name = null,
    manager_approved_at = null,
    manager_approved_by_user_id = null,
    manager_approved_by_name = null,
    manager_pdf_sharepoint_url = null,
    manager_pdf_sharepoint_item_id = null,
    manager_pdf_file_name = null,
    manager_approved_snapshot = '{}'::jsonb,
    -- manager_pdf_version is intentionally preserved so the next approval
    -- creates a new SharePoint file instead of overwriting previous PDFs.
    updated_at = now()
  where emp_id = v_emp_id
    and month_key = p_month_key
  returning *
  into v_row;

  if not found then
    raise exception 'attendance_month_not_found' using errcode = '22023';
  end if;

  delete from public.payroll_control_approvals
  where employee_id = p_employee_id
    and month_key = p_month_key;

  return jsonb_build_object(
    'employee_id', p_employee_id,
    'month_key', p_month_key,
    'status', 'reopened',
    'reason', nullif(trim(coalesce(p_reason, '')), '')
  );
end
$$;

revoke all on function public.manager_finalize_attendance_month_review(text, text, text, text, text, text, integer, jsonb) from public, anon;
revoke all on function public.admin_finalize_attendance_month_payroll(text, text, text) from public, anon;
revoke all on function public.admin_reopen_attendance_month_for_correction(text, text, text) from public, anon;

grant execute on function public.manager_finalize_attendance_month_review(text, text, text, text, text, text, integer, jsonb) to authenticated;
grant execute on function public.admin_finalize_attendance_month_payroll(text, text, text) to authenticated;
grant execute on function public.admin_reopen_attendance_month_for_correction(text, text, text) to authenticated;
