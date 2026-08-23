-- Forward-only canonical permission repair for the seven explicitly approved users.
-- No role/template/legacy value participates in this matrix.

create table if not exists public.permission_matrix_audit (
  migration text not null,
  user_id text not null,
  permissions_before jsonb not null,
  recorded_at timestamptz not null default now(),
  primary key (migration, user_id)
);
revoke all on public.permission_matrix_audit from public, anon, authenticated;

insert into public.permission_matrix_audit(migration, user_id, permissions_before)
select '20260823200000', user_id, coalesce(permissions, '{}'::jsonb)
from public.users
where user_id = any(array['8000','6000','3000','3030','7000','1500','5000'])
on conflict (migration, user_id) do nothing;

do $$
begin
  if (select count(*) from public.users where user_id = any(array['8000','6000','3000','3030','7000','1500','5000'])) <> 7 then
    raise exception 'approved_permission_matrix_requires_all_seven_users';
  end if;
  if not exists (select 1 from public.users where user_id = '8000' and role = 'admin')
     or exists (select 1 from public.users where user_id = any(array['6000','3000','3030','7000','1500','5000']) and role = 'admin') then
    raise exception 'approved_permission_matrix_admin_role_mismatch';
  end if;
end $$;

with permission_keys as (
  select unnest(array[
    'view_dashboard','view_activities','view_activity_calendar','view_activity_exceptions','view_activity_end_dates','view_activity_archive',
    'manage_activity_archive','can_add_activity','can_edit_direct','can_request_edit','can_request_create_activity','can_review_requests',
    'send_activity_coordination_approvals','view_contacts','view_instructors','view_instructor_list','view_instructor_contacts',
    'view_operations_scheduling','view_instructor_work_schedule','view_attendance_control','manage_instructor_maintenance','view_employee_files',
    'manage_instructor_onboarding','access_attendance_reporting','view_instructor_portal','view_instructor_calendar','view_instructor_data',
    'view_instructor_completion_approvals','view_instructor_guidelines','view_operations_management','view_operations_schedule_overview',
    'view_activity_approvals','view_workshop_stock','view_workshop_stock_distributions','view_orders','view_catalog','manage_catalog',
    'view_certificates','manage_workshop_training','manage_course_training','manage_print_kits','view_proposals_agreements',
    'manage_proposals_agreements','finance_access','view_finance_payroll','view_finance_collection','manage_finance_transactions',
    'can_access_personal_reports','personal_reports_manager','view_israa_management'
  ]::text[]) permission
), matrix(user_id, yes_permissions) as (values
  ('8000', (select array_agg(permission) from permission_keys)),
  ('6000', array['view_dashboard','view_activities','view_activity_calendar','view_activity_exceptions','view_activity_end_dates','view_activity_archive','can_add_activity','can_edit_direct','can_review_requests','send_activity_coordination_approvals','view_contacts','view_instructors','view_instructor_list','view_instructor_contacts','view_operations_scheduling','view_instructor_work_schedule','view_attendance_control','manage_instructor_maintenance','view_employee_files','manage_instructor_onboarding','view_operations_management','view_workshop_stock','view_workshop_stock_distributions','view_orders','view_catalog','view_certificates','manage_workshop_training','manage_course_training','manage_print_kits','view_proposals_agreements','manage_proposals_agreements','can_access_personal_reports']),
  ('3000', array['view_dashboard','view_activities','view_activity_calendar','view_activity_exceptions','view_activity_end_dates','view_activity_archive','can_request_edit','can_request_create_activity','view_contacts','view_instructors','view_instructor_list','view_instructor_contacts','view_instructor_work_schedule','view_employee_files','view_operations_management','view_workshop_stock','view_workshop_stock_distributions','view_orders','view_catalog','view_certificates','manage_workshop_training','manage_course_training','manage_print_kits','view_proposals_agreements','manage_proposals_agreements']),
  ('3030', array['view_dashboard','view_activities','view_activity_calendar','view_activity_exceptions','view_activity_end_dates','view_activity_archive','can_request_edit','can_request_create_activity','view_contacts','view_instructors','view_instructor_list','view_instructor_contacts','view_instructor_work_schedule','view_employee_files','manage_instructor_onboarding','view_operations_management','view_workshop_stock','view_workshop_stock_distributions','view_orders','view_catalog','view_certificates','manage_workshop_training','manage_course_training','manage_print_kits','view_proposals_agreements','manage_proposals_agreements','can_access_personal_reports','view_israa_management']),
  ('7000', array['view_dashboard','view_activities','view_activity_calendar','view_activity_exceptions','view_activity_end_dates','view_activity_archive','can_request_edit','view_contacts','view_instructors','view_instructor_list','view_instructor_contacts','view_instructor_work_schedule','view_attendance_control','view_employee_files','manage_instructor_onboarding','view_operations_management','view_workshop_stock','view_workshop_stock_distributions','view_orders','view_catalog','view_certificates','manage_workshop_training','manage_course_training','manage_print_kits','view_proposals_agreements','manage_proposals_agreements','finance_access','view_finance_payroll','view_finance_collection','manage_finance_transactions','can_access_personal_reports','personal_reports_manager']),
  ('1500', array['view_dashboard','view_activities','view_activity_calendar','view_activity_exceptions','view_activity_end_dates','view_activity_archive','can_request_edit','can_request_create_activity','view_contacts','view_instructors','view_instructor_list','view_instructor_contacts','view_instructor_work_schedule','view_employee_files','manage_instructor_onboarding','view_operations_management','view_workshop_stock','view_workshop_stock_distributions','view_orders','view_catalog','view_certificates','manage_workshop_training','manage_course_training','manage_print_kits','view_proposals_agreements','manage_proposals_agreements','can_access_personal_reports']),
  ('5000', array['view_dashboard','view_activities','view_activity_calendar','view_activity_exceptions','view_activity_end_dates','view_activity_archive','can_request_edit','can_request_create_activity','view_contacts','view_instructors','view_instructor_list','view_instructor_contacts','view_instructor_work_schedule','view_employee_files','manage_instructor_onboarding','view_operations_management','view_workshop_stock','view_workshop_stock_distributions','view_orders','view_catalog','view_certificates','manage_workshop_training','manage_course_training','manage_print_kits','view_proposals_agreements','manage_proposals_agreements','can_access_personal_reports'])
), payload as (
  select m.user_id,
    jsonb_object_agg(k.permission, case when k.permission = any(m.yes_permissions) then 'yes' else 'no' end)
      || jsonb_build_object(
        'can_request_edit_2','no','can_review_requests_2','no','view_inventory','no','view_finance','no','view_proposals','no',
        'view_permissions',case when m.user_id = '8000' then 'yes' else 'no' end,
        'approve_proposals_agreements',case when m.user_id = '8000' then 'yes' else 'no' end
      ) permissions
  from matrix m cross join permission_keys k
  group by m.user_id, m.yes_permissions
)
update public.users u
set permissions = p.permissions || case when nullif(u.permissions->>'display_role2','') is not null
      then jsonb_build_object('display_role2', u.permissions->>'display_role2') else '{}'::jsonb end,
    can_review_requests = p.user_id in ('8000','6000'),
    view_proposals_agreements = true,
    manage_proposals_agreements = true,
    approve_proposals_agreements = p.user_id = '8000',
    updated_at = now()
from payload p
where u.user_id = p.user_id;

update public.profiles p
set can_access_personal_reports = u.user_id in ('8000','6000','3030','7000','1500','5000'),
    updated_at = now()
from public.users u
where p.id = u.auth_user_id
  and u.user_id = any(array['8000','6000','3000','3030','7000','1500','5000']);

-- Canonical JSON lookup. A canonical NO always wins over a legacy alias.
create or replace function public.app_permission_parent(flag text)
returns text language sql immutable set search_path = public as $$
  select case
    when flag = 'manage_activity_archive' then 'view_activity_archive'
    when flag = any(array['view_activity_calendar','view_activity_exceptions','view_activity_end_dates','view_activity_archive','can_add_activity','can_edit_direct','can_request_edit','can_request_create_activity','can_review_requests','send_activity_coordination_approvals']) then 'view_activities'
    when flag = any(array['view_instructor_list','view_instructor_contacts','view_operations_scheduling','view_instructor_work_schedule','view_attendance_control','manage_instructor_maintenance','view_employee_files','manage_instructor_onboarding']) then 'view_instructors'
    when flag = 'view_workshop_stock_distributions' then 'view_workshop_stock'
    when flag = 'manage_catalog' then 'view_catalog'
    when flag = any(array['view_operations_schedule_overview','view_activity_approvals','view_workshop_stock','view_orders','view_catalog','view_certificates','manage_workshop_training','manage_course_training','manage_print_kits']) then 'view_operations_management'
    when flag = 'manage_proposals_agreements' then 'view_proposals_agreements'
    when flag = any(array['view_finance_payroll','view_finance_collection','manage_finance_transactions']) then 'finance_access'
    when flag = any(array['view_instructor_calendar','view_instructor_data','view_instructor_completion_approvals','view_instructor_guidelines']) then 'view_instructor_portal'
    when flag = 'personal_reports_manager' then 'can_access_personal_reports'
  end
$$;

create or replace function public.app_has_permission(flag text)
returns boolean language sql stable security definer set search_path = public as $$
  with recursive current_user_permissions as (
    select u.role, coalesce(u.permissions, '{}'::jsonb) permissions
    from public.users u where u.auth_user_id = auth.uid() and u.is_active = true limit 1
  ), chain(flag) as (
    select app_has_permission.flag
    union all select public.app_permission_parent(chain.flag) from chain where public.app_permission_parent(chain.flag) is not null
  ), evaluated as (
    select c.role, c.permissions, chain.flag,
      case chain.flag
        when 'can_request_edit' then coalesce(c.permissions->>chain.flag, c.permissions->>'can_request_edit_2')
        when 'can_review_requests' then coalesce(c.permissions->>chain.flag, c.permissions->>'can_review_requests_2')
        when 'view_workshop_stock' then coalesce(c.permissions->>chain.flag, c.permissions->>'view_inventory')
        when 'finance_access' then coalesce(c.permissions->>chain.flag, c.permissions->>'view_finance')
        else c.permissions->>chain.flag
      end value
    from current_user_permissions c cross join chain
  )
  select coalesce(bool_or(role = 'admin') or bool_and(lower(coalesce(value,'')) in ('yes','true','1')), false)
  from evaluated
$$;
revoke all on function public.app_has_permission(text) from public, anon;
grant execute on function public.app_has_permission(text) to authenticated;

-- Compatibility name retained for deployed clients; semantics are now the dedicated permission.
create or replace function public.activity_coordination_is_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.app_current_role() = 'admin' or public.app_has_permission('send_activity_coordination_approvals'), false)
$$;

-- Instructor onboarding is independent from employee-file access.
create or replace function public.create_instructor_onboarding(
  p_full_name text, p_mobile text, p_email text, p_employment_type text, p_direct_manager text, p_gender text
) returns table (emp_id bigint, full_name text, already_exists boolean)
language plpgsql security invoker set search_path = public as $$
declare
  v_existing public.contacts_instructors%rowtype; v_emp_id bigint;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_phone text := regexp_replace(coalesce(p_mobile, ''), '[^0-9+]', '', 'g');
  v_employment_type text := trim(coalesce(p_employment_type, ''));
  v_gender text := trim(coalesce(p_gender, ''));
begin
  if not public.app_has_permission('manage_instructor_onboarding') then raise exception 'permission_denied:manage_instructor_onboarding' using errcode = '42501'; end if;
  if trim(coalesce(p_full_name, '')) = '' or v_phone = '' or v_email = '' or trim(coalesce(p_direct_manager, '')) = '' then raise exception 'onboarding_required_fields_missing'; end if;
  if v_gender not in ('male', 'female') then raise exception 'onboarding_gender_invalid' using errcode = '22023'; end if;
  if v_employment_type = '' then v_employment_type := 'עצמאי'; end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'onboarding_invalid_email'; end if;
  perform pg_advisory_xact_lock(hashtext('contacts_instructors:onboarding'));
  select ci.* into v_existing from public.contacts_instructors ci
    where lower(trim(coalesce(ci.email, ''))) = v_email or regexp_replace(coalesce(ci.mobile, ''), '[^0-9+]', '', 'g') = v_phone
    order by ci.emp_id limit 1;
  if found then return query select v_existing.emp_id::bigint, v_existing.full_name::text, true; return; end if;
  select coalesce(max(ci.emp_id::bigint), 0) + 1 into v_emp_id from public.contacts_instructors ci;
  insert into public.contacts_instructors (emp_id, full_name, mobile, email, employment_type, direct_manager, active)
    values (v_emp_id, trim(p_full_name), trim(p_mobile), trim(p_email), v_employment_type, trim(p_direct_manager), 'yes');
  insert into public.instructor_scheduling_profiles (emp_id, gender) values (v_emp_id, v_gender)
    on conflict (emp_id) do update set gender = excluded.gender;
  return query select v_emp_id, trim(p_full_name), false;
end $$;

create or replace function public.update_instructor_onboarding_folder_url(p_emp_id bigint, p_school_year text, p_folder_web_url text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare mapping_id uuid; clean_url text := nullif(trim(coalesce(p_folder_web_url, '')), '');
begin
  if not public.app_has_permission('manage_instructor_onboarding') then raise exception 'permission_denied:manage_instructor_onboarding' using errcode = '42501'; end if;
  if clean_url is not null and clean_url !~ '^https://think365orgil[.]sharepoint[.]com/' then raise exception 'employee_files_invalid_sharepoint_url' using errcode = '22023'; end if;
  mapping_id := public.employee_file_active_mapping(p_emp_id, p_school_year);
  update public.instructor_employee_folders set folder_web_url = clean_url, updated_at = now() where id = mapping_id;
  return jsonb_build_object('folder_web_url', clean_url);
end $$;
