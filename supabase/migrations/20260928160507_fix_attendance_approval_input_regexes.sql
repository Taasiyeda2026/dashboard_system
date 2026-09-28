-- Repair the attendance approval-chain input guards without changing workflow state or data.
-- Use explicit ASCII digit classes so PostgreSQL regex behavior cannot depend on
-- backslash escaping. Invalid dashboard month input must fail visibly instead of
-- being reported as an empty validation result.

-- Latest definition preserved from 20260927181000_admin_submit_attendance_month_on_behalf.sql: av2_approval_before_insert.
create or replace function public.av2_approval_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp_id bigint;
  v_role text;
  v_override_emp_id text;
begin
  select
    u.emp_id::bigint,
    lower(btrim(coalesce(u.role, '')))
  into v_emp_id, v_role
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.is_active = true
  limit 1;

  if v_emp_id is null then
    raise exception 'No authenticated user';
  end if;

  v_override_emp_id := nullif(current_setting('app.av2_submission_override_emp_id', true), '');

  if v_override_emp_id is not null then
    if v_role <> 'admin' then
      raise exception 'attendance_admin_submission_not_authorized' using errcode = '42501';
    end if;
    if v_override_emp_id !~ '^[0-9]+$' then
      raise exception 'attendance_admin_submission_invalid_employee' using errcode = '22023';
    end if;
    new.emp_id := v_override_emp_id::bigint;
  else
    new.emp_id := v_emp_id;
  end if;

  return new;
end;
$$;

-- Latest definition preserved from 20260927181000_admin_submit_attendance_month_on_behalf.sql: av2_submit_attendance_month.
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
  if coalesce(p_month_key,'') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
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
    submitted_on_behalf,
    submitted_on_behalf_by_user_id,
    submitted_on_behalf_by_name,
    submitted_on_behalf_reason,
    submitted_on_behalf_at,
    updated_at
  )
  values(
    v_emp,
    p_month_key,
    'submitted',
    now(),
    btrim(coalesce(p_submitted_by_name,'')),
    false,
    null,
    null,
    null,
    null,
    now()
  )
  on conflict(emp_id,month_key) do update
    set status='submitted',
        submitted_at=now(),
        submitted_by_name=excluded.submitted_by_name,
        submitted_on_behalf=false,
        submitted_on_behalf_by_user_id=null,
        submitted_on_behalf_by_name=null,
        submitted_on_behalf_reason=null,
        submitted_on_behalf_at=null,
        updated_at=now()
  returning * into saved;

  return saved;
end
$$;

-- Latest definition preserved from 20260927181000_admin_submit_attendance_month_on_behalf.sql: admin_submit_attendance_month_on_behalf.
create or replace function public.admin_submit_attendance_month_on_behalf(
  p_employee_id text,
  p_month_key text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_admin_name text;
  v_emp bigint;
  v_employee_name text;
  v_reason text;
  v_existing_status text;
  v_saved public.attendance_month_approvals%rowtype;
begin
  if coalesce(btrim(p_employee_id), '') !~ '^[0-9]+$' then
    raise exception 'attendance_admin_submission_invalid_employee' using errcode = '22023';
  end if;
  if coalesce(btrim(p_month_key), '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_month_key' using errcode = '22023';
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'attendance_admin_submission_reason_required' using errcode = '22023';
  end if;

  select
    lower(btrim(coalesce(u.role, ''))),
    coalesce(
      nullif(btrim(coalesce(u.full_name, '')), ''),
      nullif(btrim(coalesce(u.name, '')), ''),
      nullif(btrim(coalesce(u.username, '')), '')
    )
  into v_role, v_admin_name
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.is_active = true
  limit 1;

  if v_role is null then
    raise exception 'attendance_auth_required' using errcode = '42501';
  end if;
  if v_role <> 'admin' then
    raise exception 'attendance_admin_submission_not_authorized' using errcode = '42501';
  end if;

  select
    u.emp_id::bigint,
    coalesce(
      nullif(btrim(coalesce(u.full_name, '')), ''),
      nullif(btrim(coalesce(u.name, '')), ''),
      nullif(btrim(coalesce(u.username, '')), ''),
      u.emp_id::text
    )
  into v_emp, v_employee_name
  from public.users u
  where u.emp_id::text = btrim(p_employee_id)
    and u.is_active = true
  limit 1;

  if v_emp is null then
    raise exception 'attendance_admin_submission_employee_not_found' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.attendance_records ar
    where ar.emp_id = v_emp
      and to_char(ar.report_date, 'YYYY-MM') = p_month_key
  ) then
    raise exception 'attendance_admin_submission_no_records' using errcode = '22023';
  end if;

  select coalesce(nullif(btrim(ama.status), ''), 'open')
  into v_existing_status
  from public.attendance_month_approvals ama
  where ama.emp_id = v_emp
    and ama.month_key = p_month_key
  limit 1;

  if v_existing_status in ('submitted', 'locked') then
    raise exception 'attendance_month_already_submitted' using errcode = '22023';
  end if;

  perform set_config('app.av2_submission_override_emp_id', v_emp::text, true);

  insert into public.attendance_month_approvals(
    emp_id,
    month_key,
    status,
    submitted_at,
    submitted_by_name,
    submitted_on_behalf,
    submitted_on_behalf_by_user_id,
    submitted_on_behalf_by_name,
    submitted_on_behalf_reason,
    submitted_on_behalf_at,
    manager_approved_at,
    manager_approved_by_user_id,
    manager_approved_by_name,
    manager_pdf_sharepoint_url,
    manager_pdf_sharepoint_item_id,
    manager_pdf_file_name,
    manager_pdf_version,
    manager_approved_snapshot,
    locked_at,
    locked_by,
    updated_at
  )
  values(
    v_emp,
    p_month_key,
    'submitted',
    now(),
    coalesce(v_admin_name, '') || ' (אדמין בשם ' || coalesce(v_employee_name, v_emp::text) || ')',
    true,
    auth.uid(),
    coalesce(v_admin_name, ''),
    v_reason,
    now(),
    null,
    null,
    null,
    null,
    null,
    null,
    0,
    '{}'::jsonb,
    null,
    null,
    now()
  )
  on conflict(emp_id,month_key) do update
    set status='submitted',
        submitted_at=now(),
        submitted_by_name=excluded.submitted_by_name,
        submitted_on_behalf=true,
        submitted_on_behalf_by_user_id=excluded.submitted_on_behalf_by_user_id,
        submitted_on_behalf_by_name=excluded.submitted_on_behalf_by_name,
        submitted_on_behalf_reason=excluded.submitted_on_behalf_reason,
        submitted_on_behalf_at=excluded.submitted_on_behalf_at,
        manager_approved_at=null,
        manager_approved_by_user_id=null,
        manager_approved_by_name=null,
        manager_pdf_sharepoint_url=null,
        manager_pdf_sharepoint_item_id=null,
        manager_pdf_file_name=null,
        manager_pdf_version=0,
        manager_approved_snapshot='{}'::jsonb,
        locked_at=null,
        locked_by=null,
        updated_at=now()
    where coalesce(nullif(btrim(public.attendance_month_approvals.status), ''), 'open') in ('open', 'reopened')
  returning * into v_saved;

  if v_saved.id is null then
    raise exception 'attendance_month_not_available_for_admin_submission' using errcode = '22023';
  end if;

  perform set_config('app.av2_submission_override_emp_id', '', true);

  return jsonb_build_object(
    'success', true,
    'employeeId', v_saved.emp_id,
    'monthKey', v_saved.month_key,
    'status', v_saved.status,
    'submittedAt', v_saved.submitted_at,
    'submittedByName', v_saved.submitted_by_name,
    'submittedOnBehalf', v_saved.submitted_on_behalf,
    'submittedOnBehalfByName', v_saved.submitted_on_behalf_by_name,
    'submittedOnBehalfReason', v_saved.submitted_on_behalf_reason
  );
end
$$;

-- Latest definition preserved from 20260927061000_guard_manager_finalize_requires_record_reviews.sql: manager_finalize_attendance_month_review.
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
  v_unapproved_count integer := 0;
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

  select count(*)::integer
  into v_unapproved_count
  from public.attendance_records ar
  where ar.emp_id = v_emp_id
    and to_char(ar.report_date, 'YYYY-MM') = p_month_key
    and not exists (
      select 1
      from public.attendance_manager_record_reviews review
      where review.record_id = ar.id
        and review.status = 'approved'
        and review.approved_record_updated_at = ar.updated_at
    );

  if coalesce(v_unapproved_count, 0) > 0 then
    raise exception 'attendance_records_not_fully_approved' using errcode = '22023';
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

-- Latest definition preserved from 20260819003500_attendance_month_manager_admin_flow.sql: admin_finalize_attendance_month_payroll.
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

-- Latest definition preserved from 20260819003500_attendance_month_manager_admin_flow.sql: admin_reopen_attendance_month_for_correction.
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
  if coalesce(trim(p_month_key), '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
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

-- Latest definition preserved from 20260819003500_attendance_month_manager_admin_flow.sql: get_payroll_attendance_month_statuses.
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

-- Latest definition preserved from 20260922011500_course_single_meeting_substitution.sql: av2_validate_attendance_month_dashboard.
create or replace function public.av2_validate_attendance_month_dashboard(
  p_emp_id bigint,
  p_month_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_current_emp_id bigint;
  v_month_start date;
  v_month_end date;
  v_result jsonb := '[]'::jsonb;
  r record;
  v_activity public.activities%rowtype;
  v_meetings jsonb;
  v_expected jsonb;
  v_expected_date date;
  v_dashboard_start time;
  v_dashboard_end time;
  v_expected_start time;
  v_expected_end time;
  v_dashboard_minutes integer;
  v_blocks integer;
  v_before_minutes integer;
  v_after_minutes integer;
  v_reasons jsonb;
  v_school_valid boolean;
  v_resolved_emp_id text;
begin
  select u.emp_id::bigint
    into v_current_emp_id
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.is_active = true
  limit 1;

  if v_current_emp_id is null or v_current_emp_id <> p_emp_id then
    return '[]'::jsonb;
  end if;

  if coalesce(p_month_key, '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_month_key' using errcode = '22023';
  end if;

  v_month_start := (p_month_key || '-01')::date;
  v_month_end := (v_month_start + interval '1 month - 1 day')::date;

  for r in
    select ar.*
    from public.attendance_records ar
    where ar.emp_id = p_emp_id
      and ar.report_date between v_month_start and v_month_end
      and ar.generation_kind is null
      and btrim(coalesce(ar.activity_type, '')) = 'קורס'
    order by ar.report_date, ar.start_time
  loop
    v_reasons := '[]'::jsonb;
    v_expected := null;
    v_expected_date := null;
    v_dashboard_start := null;
    v_dashboard_end := null;
    v_expected_start := null;
    v_expected_end := null;
    v_resolved_emp_id := null;

    select a.*
      into v_activity
    from public.activities a
    where a.row_id = btrim(coalesce(r.activity_row_id, ''))
    limit 1;

    if not found then
      v_reasons := v_reasons || jsonb_build_array('הפעילות אינה תואמת לשיבוץ בדשבורד');
    else
      select coalesce(h.emp_id, v_activity.emp_id::text)
        into v_resolved_emp_id
      from (select 1) seed
      left join public.course_meeting_instructor_history h
        on h.activity_id = v_activity.row_id
       and h.meeting_date = r.report_date;

      if not (
        btrim(coalesce(v_activity.emp_id_2, '')) = p_emp_id::text
        or v_resolved_emp_id = p_emp_id::text
      ) then
        v_reasons := v_reasons || jsonb_build_array('המפגש משויך בדשבורד למדריך אחר');
      end if;

      v_meetings := public.scheduling_effective_meetings(v_activity, p_emp_id);

      if r.meeting_no is not null and r.meeting_no > 0 and jsonb_array_length(v_meetings) >= r.meeting_no then
        v_expected := v_meetings -> (r.meeting_no - 1);
      else
        select item
          into v_expected
        from jsonb_array_elements(v_meetings) item
        where nullif(item->>'date', '')::date = r.report_date
        limit 1;
      end if;

      if v_expected is null then
        v_reasons := v_reasons || jsonb_build_array('מספר המפגש או התאריך אינם קיימים בלוח הדשבורד');
      else
        v_expected_date := nullif(v_expected->>'date', '')::date;
        v_dashboard_start := nullif(v_expected->>'start_time', '')::time;
        v_dashboard_end := nullif(v_expected->>'end_time', '')::time;

        if r.report_date is distinct from v_expected_date then
          v_reasons := v_reasons || jsonb_build_array('תאריך הדיווח אינו תואם למפגש בדשבורד');
        end if;

        if v_dashboard_start is not null and v_dashboard_end is not null and v_dashboard_end > v_dashboard_start then
          v_dashboard_minutes := floor(extract(epoch from (v_dashboard_end - v_dashboard_start)) / 60)::int;
          v_blocks := floor(v_dashboard_minutes::numeric / 45)::int;
          v_before_minutes := ceil(v_blocks::numeric / 2)::int * 15;
          v_after_minutes := floor(v_blocks::numeric / 2)::int * 15;
          v_expected_start := v_dashboard_start - make_interval(mins => v_before_minutes);
          v_expected_end := v_dashboard_end + make_interval(mins => v_after_minutes);

          if r.start_time::time(0) is distinct from v_expected_start::time(0)
             or r.end_time::time(0) is distinct from v_expected_end::time(0) then
            v_reasons := v_reasons || jsonb_build_array('שעות הדיווח אינן תואמות לשעות המחושבות מהדשבורד');
          end if;
        end if;
      end if;

      if v_activity.authority_id is not null
         and r.authority_id is distinct from v_activity.authority_id then
        v_reasons := v_reasons || jsonb_build_array('הרשות אינה תואמת לדשבורד');
      end if;

      if v_activity.school_id is not null then
        v_school_valid := r.school_id is not distinct from v_activity.school_id;
      elsif exists (
        select 1 from public.activity_schools acs where acs.activity_id = v_activity.id
      ) then
        v_school_valid := exists (
          select 1
          from public.activity_schools acs
          where acs.activity_id = v_activity.id
            and acs.school_id = r.school_id
        );
      else
        v_school_valid := true;
      end if;

      if not coalesce(v_school_valid, false) then
        v_reasons := v_reasons || jsonb_build_array('בית הספר אינו תואם לדשבורד');
      end if;

      if btrim(coalesce(r.activity_name_snapshot, '')) <> ''
         and btrim(coalesce(v_activity.activity_name, v_activity.program_name, '')) <> ''
         and btrim(r.activity_name_snapshot) <> btrim(coalesce(v_activity.activity_name, v_activity.program_name, '')) then
        v_reasons := v_reasons || jsonb_build_array('שם הפעילות אינו תואם לדשבורד');
      end if;
    end if;

    v_result := v_result || jsonb_build_array(
      jsonb_build_object(
        'record_id', r.id,
        'mismatch', jsonb_array_length(v_reasons) > 0,
        'reasons', v_reasons,
        'expected', case when v_expected is null then null else jsonb_build_object(
          'meeting_no', r.meeting_no,
          'date', case when v_expected_date is null then null else to_char(v_expected_date, 'YYYY-MM-DD') end,
          'dashboard_start_time', case when v_dashboard_start is null then null else to_char(v_dashboard_start, 'HH24:MI') end,
          'dashboard_end_time', case when v_dashboard_end is null then null else to_char(v_dashboard_end, 'HH24:MI') end,
          'attendance_start_time', case when v_expected_start is null then null else to_char(v_expected_start, 'HH24:MI') end,
          'attendance_end_time', case when v_expected_end is null then null else to_char(v_expected_end, 'HH24:MI') end,
          'authority_id', v_activity.authority_id,
          'school_id', v_activity.school_id
        ) end
      )
    );
  end loop;

  return v_result;
end
$$;
