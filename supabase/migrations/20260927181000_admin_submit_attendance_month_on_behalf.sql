-- Admin-only attendance month submission on behalf of an employee.
-- Used when an employee cannot complete the monthly confirmation themselves.
-- The action moves the month to the normal submitted workflow, with explicit audit metadata.

alter table public.attendance_month_approvals
  add column if not exists submitted_on_behalf boolean not null default false,
  add column if not exists submitted_on_behalf_by_user_id uuid,
  add column if not exists submitted_on_behalf_by_name text,
  add column if not exists submitted_on_behalf_reason text,
  add column if not exists submitted_on_behalf_at timestamptz;

comment on column public.attendance_month_approvals.submitted_on_behalf is
  'True when an admin submitted the employee month on the employee behalf.';
comment on column public.attendance_month_approvals.submitted_on_behalf_by_user_id is
  'Authenticated admin user that submitted the month on behalf of the employee.';
comment on column public.attendance_month_approvals.submitted_on_behalf_by_name is
  'Display name of the admin that submitted the month on behalf of the employee.';
comment on column public.attendance_month_approvals.submitted_on_behalf_reason is
  'Required operational reason for admin submission on behalf of the employee.';
comment on column public.attendance_month_approvals.submitted_on_behalf_at is
  'Timestamp of the admin submission on behalf of the employee.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'attendance_month_approvals_on_behalf_audit_check'
      and conrelid = 'public.attendance_month_approvals'::regclass
  ) then
    alter table public.attendance_month_approvals
      add constraint attendance_month_approvals_on_behalf_audit_check
      check (
        not submitted_on_behalf
        or (
          submitted_on_behalf_by_user_id is not null
          and nullif(btrim(coalesce(submitted_on_behalf_by_name, '')), '') is not null
          and nullif(btrim(coalesce(submitted_on_behalf_reason, '')), '') is not null
          and submitted_on_behalf_at is not null
        )
      );
  end if;
end
$$;

-- Preserve the anti-spoof trigger for normal employee submissions, while allowing
-- one transaction-scoped admin override used only by the dedicated SECURITY DEFINER RPC.
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
    if v_override_emp_id !~ '^\\d+$' then
      raise exception 'attendance_admin_submission_invalid_employee' using errcode = '22023';
    end if;
    new.emp_id := v_override_emp_id::bigint;
  else
    new.emp_id := v_emp_id;
  end if;

  return new;
end;
$$;

-- Employee self-submission always clears any prior admin-on-behalf audit state.
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
  if coalesce(btrim(p_employee_id), '') !~ '^\\d+$' then
    raise exception 'attendance_admin_submission_invalid_employee' using errcode = '22023';
  end if;
  if coalesce(btrim(p_month_key), '') !~ '^\\d{4}-(0[1-9]|1[0-2])$' then
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

revoke all on function public.admin_submit_attendance_month_on_behalf(text, text, text)
  from public, anon;
grant execute on function public.admin_submit_attendance_month_on_behalf(text, text, text)
  to authenticated;

comment on function public.admin_submit_attendance_month_on_behalf(text, text, text) is
  'Admin-only exception: submits an employee attendance month on the employee behalf with required audit reason.';
