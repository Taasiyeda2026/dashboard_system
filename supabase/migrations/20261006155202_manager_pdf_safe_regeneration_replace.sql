create or replace function public.replace_manager_attendance_month_pdf(
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
as $function$
declare
  v_emp_id bigint;
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
  if v_jwt_role <> 'service_role' then
    raise exception 'payroll_attendance_permission_denied' using errcode = '42501';
  end if;

  v_emp_id := trim(p_employee_id)::bigint;

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

  v_version := greatest(
    coalesce(p_manager_pdf_version, 0),
    coalesce(v_row.manager_pdf_version, 0) + 1
  );

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
    'replaced', true,
    'manager_pdf_sharepoint_url', v_row.manager_pdf_sharepoint_url,
    'manager_pdf_sharepoint_item_id', v_row.manager_pdf_sharepoint_item_id,
    'manager_pdf_file_name', v_row.manager_pdf_file_name,
    'manager_pdf_version', v_row.manager_pdf_version
  );
end
$function$;

revoke all on function public.replace_manager_attendance_month_pdf(text, text, text, text, text, integer) from public;
revoke all on function public.replace_manager_attendance_month_pdf(text, text, text, text, text, integer) from anon, authenticated;
grant execute on function public.replace_manager_attendance_month_pdf(text, text, text, text, text, integer) to service_role;
