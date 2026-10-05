-- Decouple manager month approval from SharePoint PDF persistence.
-- Approval locks the month and stores the approved snapshot immediately.
-- PDF/SharePoint/email remain best-effort artifacts completed by the edge
-- function and the existing av2_retry_missing_pdfs cron architecture.

create or replace function public.manager_finalize_attendance_month_review(
  p_employee_id text,
  p_month_key text,
  p_manager_name text,
  p_manager_pdf_sharepoint_url text default null,
  p_manager_pdf_sharepoint_item_id text default null,
  p_manager_pdf_file_name text default null,
  p_manager_pdf_version integer default null,
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

  -- PDF artifact is optional at finalize time. A missing PDF must not block
  -- manager approval; retry and attach fill it later from the locked snapshot.
  if (v_pdf_url is null) <> (v_pdf_file_name is null) then
    raise exception 'manager_pdf_fields_incomplete' using errcode = '22023';
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

  if v_pdf_url is not null then
    v_version := greatest(coalesce(p_manager_pdf_version, 0), coalesce(v_row.manager_pdf_version, 0) + 1);
  else
    v_version := coalesce(v_row.manager_pdf_version, 0);
  end if;

  update public.attendance_month_approvals
  set
    status = 'locked',
    manager_approved_at = now(),
    manager_approved_by_user_id = auth.uid(),
    manager_approved_by_name = coalesce(v_actor_name, ''),
    manager_pdf_sharepoint_url = coalesce(v_pdf_url, manager_pdf_sharepoint_url),
    manager_pdf_sharepoint_item_id = coalesce(v_pdf_item_id, manager_pdf_sharepoint_item_id),
    manager_pdf_file_name = coalesce(v_pdf_file_name, manager_pdf_file_name),
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

revoke all on function public.manager_finalize_attendance_month_review(text, text, text, text, text, text, integer, jsonb)
  from public, anon;
grant execute on function public.manager_finalize_attendance_month_review(text, text, text, text, text, text, integer, jsonb)
  to authenticated;

comment on function public.manager_finalize_attendance_month_review(text, text, text, text, text, text, integer, jsonb) is
  'Locks a submitted attendance month after manager review. SharePoint PDF fields are optional artifacts filled immediately or later by retry.';

create or replace function public.attach_manager_attendance_month_pdf(
  p_employee_id text,
  p_month_key text,
  p_manager_pdf_sharepoint_url text,
  p_manager_pdf_sharepoint_item_id text default null,
  p_manager_pdf_file_name text default null,
  p_manager_pdf_version integer default null
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
  v_pdf_url text := nullif(trim(coalesce(p_manager_pdf_sharepoint_url, '')), '');
  v_pdf_item_id text := nullif(trim(coalesce(p_manager_pdf_sharepoint_item_id, '')), '');
  v_pdf_file_name text := nullif(trim(coalesce(p_manager_pdf_file_name, '')), '');
  v_version integer;
  v_jwt_role text := lower(trim(coalesce(auth.jwt() ->> 'role', '')));
begin
  if coalesce(trim(p_month_key), '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_month_key' using errcode = '22023';
  end if;
  if coalesce(trim(p_employee_id), '') !~ '^[0-9]+$' then
    raise exception 'invalid_employee_id' using errcode = '22023';
  end if;
  if v_pdf_url is null or v_pdf_file_name is null then
    raise exception 'manager_pdf_required' using errcode = '22023';
  end if;
  v_emp_id := trim(p_employee_id)::bigint;

  if v_jwt_role = 'service_role' then
    v_role := 'service_role';
  else
    select lower(trim(coalesce(u.role, '')))
    into v_role
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
  end if;

  select *
  into v_row
  from public.attendance_month_approvals
  where emp_id = v_emp_id
    and month_key = trim(p_month_key)
  limit 1
  for update;

  if not found then
    raise exception 'attendance_month_not_found' using errcode = '22023';
  end if;
  if coalesce(nullif(trim(v_row.status), ''), 'open') <> 'locked'
     or v_row.manager_approved_at is null then
    raise exception 'attendance_month_not_manager_approved' using errcode = '22023';
  end if;

  -- Idempotent: never create a second PDF attachment for the same approval.
  if nullif(trim(coalesce(v_row.manager_pdf_sharepoint_url, '')), '') is not null then
    return jsonb_build_object(
      'employee_id', p_employee_id,
      'month_key', p_month_key,
      'attached', false,
      'already_attached', true,
      'manager_pdf_sharepoint_url', v_row.manager_pdf_sharepoint_url,
      'manager_pdf_sharepoint_item_id', v_row.manager_pdf_sharepoint_item_id,
      'manager_pdf_file_name', v_row.manager_pdf_file_name,
      'manager_pdf_version', v_row.manager_pdf_version
    );
  end if;

  v_version := greatest(coalesce(p_manager_pdf_version, 0), coalesce(v_row.manager_pdf_version, 0) + 1);

  update public.attendance_month_approvals
  set
    manager_pdf_sharepoint_url = v_pdf_url,
    manager_pdf_sharepoint_item_id = v_pdf_item_id,
    manager_pdf_file_name = v_pdf_file_name,
    manager_pdf_version = v_version,
    updated_at = now()
  where emp_id = v_emp_id
    and month_key = trim(p_month_key)
  returning *
  into v_row;

  return jsonb_build_object(
    'employee_id', p_employee_id,
    'month_key', p_month_key,
    'attached', true,
    'already_attached', false,
    'manager_pdf_sharepoint_url', v_row.manager_pdf_sharepoint_url,
    'manager_pdf_sharepoint_item_id', v_row.manager_pdf_sharepoint_item_id,
    'manager_pdf_file_name', v_row.manager_pdf_file_name,
    'manager_pdf_version', v_row.manager_pdf_version
  );
end
$$;

revoke all on function public.attach_manager_attendance_month_pdf(text, text, text, text, text, integer)
  from public, anon;
grant execute on function public.attach_manager_attendance_month_pdf(text, text, text, text, text, integer)
  to authenticated, service_role;

comment on function public.attach_manager_attendance_month_pdf(text, text, text, text, text, integer) is
  'Attaches SharePoint manager-approval PDF metadata to an already-locked attendance month. Idempotent when a PDF URL already exists.';

create or replace function public.av2_verify_trigger_secret(p_secret text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'av2_trigger_secret';
  return v_secret is not null
    and nullif(trim(coalesce(p_secret, '')), '') is not null
    and trim(p_secret) = trim(v_secret);
end
$$;

revoke all on function public.av2_verify_trigger_secret(text) from public, anon, authenticated;
grant execute on function public.av2_verify_trigger_secret(text) to service_role;

create or replace function public.av2_request_manager_pdf(p_emp_id bigint, p_month_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_row public.attendance_month_approvals%rowtype;
begin
  select *
  into v_row
  from public.attendance_month_approvals
  where emp_id = p_emp_id
    and month_key = p_month_key
  limit 1;

  if not found then
    return;
  end if;
  if coalesce(nullif(trim(v_row.status), ''), 'open') <> 'locked'
     or v_row.manager_approved_at is null then
    return;
  end if;
  if nullif(trim(coalesce(v_row.manager_pdf_sharepoint_url, '')), '') is not null then
    return;
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'av2_trigger_secret';
  if v_secret is null then
    raise warning 'av2_trigger_secret missing from Vault — manager PDF not requested for % %', p_emp_id, p_month_key;
    return;
  end if;

  update public.attendance_month_approvals
  set pdf_generation_attempts = coalesce(pdf_generation_attempts, 0) + 1,
      pdf_last_attempt_at = now()
  where emp_id = p_emp_id and month_key = p_month_key;

  perform net.http_post(
    url := 'https://szinlhjuwyiyszdpsdop.supabase.co/functions/v1/payroll-attendance-pdf-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer sb_publishable_k0IbDJlgPA9KTVuDWrCyFw_Zsa5kZIM',
      'x-av2-trigger-secret', v_secret
    ),
    body := jsonb_build_object(
      'employeeId', p_emp_id::text,
      'monthKey', p_month_key,
      'retry', true
    )
  );
end
$$;

revoke all on function public.av2_request_manager_pdf(bigint, text) from public, anon, authenticated;
grant execute on function public.av2_request_manager_pdf(bigint, text) to service_role;

create or replace function public.av2_retry_missing_pdfs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n integer := 0;
begin
  -- Legacy storage-PDF retry path (kept intact).
  for r in
    select a.emp_id, a.month_key
    from public.attendance_month_approvals a
    where a.status = 'locked'
      and a.pdf_generation_attempts < 20
      and a.locked_at < now() - interval '90 seconds'
      and coalesce(a.pdf_last_attempt_at, 'epoch'::timestamptz) < now() - interval '90 seconds'
      and (
        a.pdf_storage_path is null
        or not exists (
          select 1 from storage.objects o
          where o.bucket_id = 'attendance-pdfs' and o.name = a.pdf_storage_path
        )
      )
      -- Do not mix with manager SharePoint retry rows that never used legacy storage PDFs.
      and a.manager_approved_at is null
  loop
    perform public.av2_request_pdf(r.emp_id, r.month_key);
    n := n + 1;
  end loop;

  -- Manager SharePoint PDF artifact retry for locked approvals missing PDF metadata.
  for r in
    select a.emp_id, a.month_key
    from public.attendance_month_approvals a
    where a.status = 'locked'
      and a.manager_approved_at is not null
      and nullif(trim(coalesce(a.manager_pdf_sharepoint_url, '')), '') is null
      and coalesce(a.pdf_generation_attempts, 0) < 20
      and a.manager_approved_at < now() - interval '90 seconds'
      and coalesce(a.pdf_last_attempt_at, 'epoch'::timestamptz) < now() - interval '90 seconds'
  loop
    perform public.av2_request_manager_pdf(r.emp_id, r.month_key);
    n := n + 1;
  end loop;

  return n;
end
$$;

revoke all on function public.av2_retry_missing_pdfs() from public, anon, authenticated;
grant execute on function public.av2_retry_missing_pdfs() to service_role;

comment on function public.av2_retry_missing_pdfs() is
  'Retries missing attendance PDFs: legacy storage PDFs and manager SharePoint approval artifacts.';
