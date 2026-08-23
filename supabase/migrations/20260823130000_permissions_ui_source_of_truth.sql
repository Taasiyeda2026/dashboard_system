-- Align sensitive DB predicates with the explicit permissions managed in the
-- Admin permissions workspace. Roles remain templates; only admin bypasses flags.

-- Preserve every access path that roles supplied before this migration. Existing
-- explicit values win, including "no", so no administrator override is changed.
with role_templates(role, defaults) as (values
  ('operation_manager', jsonb_build_object(
    'view_activities','yes','can_add_activity','yes','can_edit_direct','yes',
    'can_request_edit','yes','can_review_requests','yes','view_catalog','yes',
    'view_orders','yes','view_proposals_agreements','yes','view_proposals','yes',
    'manage_proposals_agreements','yes','view_operations_management','yes',
    'view_operations_scheduling','yes','view_attendance_control','yes',
    'view_activity_approvals','yes','view_workshop_stock','yes',
    'view_workshop_stock_distributions','yes','view_employee_files','yes',
    'can_access_personal_reports','yes')),
  ('activities_manager', jsonb_build_object(
    'view_activities','yes','can_add_activity','yes','can_request_edit','yes',
    'view_catalog','yes','view_orders','yes','view_operations_management','yes',
    'view_employee_files','yes','can_access_personal_reports','yes')),
  ('finance', jsonb_build_object(
    'view_activities','yes','finance_access','yes','view_finance','yes',
    'view_catalog','yes','view_orders','yes','view_employee_files','yes',
    'can_access_personal_reports','yes')),
  ('domain_manager', jsonb_build_object(
    'view_activities','yes','view_catalog','yes','view_orders','yes',
    'view_proposals_agreements','yes','view_proposals','yes',
    'manage_proposals_agreements','yes','view_employee_files','yes',
    'can_access_personal_reports','yes')),
  ('business_development_manager', jsonb_build_object(
    'view_activities','yes','can_add_activity','yes','can_request_edit','yes',
    'view_catalog','yes','view_orders','yes','view_proposals_agreements','yes',
    'view_proposals','yes','view_employee_files','yes','can_access_personal_reports','yes')),
  ('instructor_manager', jsonb_build_object(
    'view_activities','yes','can_add_activity','yes','can_request_edit','yes',
    'view_catalog','yes','view_orders','yes','view_employee_files','yes',
    'can_access_personal_reports','yes')),
  ('authorized_user', jsonb_build_object(
    'view_activities','yes','can_add_activity','yes','can_request_edit','yes',
    'can_access_personal_reports','yes')),
  ('instructor', jsonb_build_object('can_access_personal_reports','yes'))
)
update public.users u
set permissions = t.defaults || coalesce(u.permissions, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
      'view_proposals_agreements', u.view_proposals_agreements,
      'manage_proposals_agreements', u.manage_proposals_agreements,
      'approve_proposals_agreements', u.approve_proposals_agreements)),
    updated_at = now()
from role_templates t
where u.role = t.role
  and coalesce(u.permissions, '{}'::jsonb) is distinct from
      (t.defaults || coalesce(u.permissions, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
        'view_proposals_agreements', u.view_proposals_agreements,
        'manage_proposals_agreements', u.manage_proposals_agreements,
        'approve_proposals_agreements', u.approve_proposals_agreements)));

create or replace function public.app_can_edit_direct()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_current_role() = 'admin' or public.app_has_permission('can_edit_direct'), false)
$$;

create or replace function public.app_can_add_activity()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_current_role() = 'admin' or public.app_has_permission('can_add_activity'), false)
$$;

create or replace function public.app_can_use_proposals_agreements()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_current_role() = 'admin'
    or public.app_has_permission('view_proposals_agreements')
    or public.app_has_permission('view_proposals'), false)
$$;

create or replace function public.app_can_manage_proposals_agreements()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_current_role() = 'admin'
    or public.app_has_permission('manage_proposals_agreements'), false)
$$;

create or replace function public.app_can_approve_proposals_agreements()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_current_role() = 'admin'
    or public.app_has_permission('approve_proposals_agreements'), false)
$$;

create or replace function public.app_can_access_finance()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_current_role() = 'admin'
    or public.app_has_permission('finance_access')
    or public.app_has_permission('view_finance'), false)
$$;

create or replace function public.app_can_access_operations_area(flag text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_current_role() = 'admin' or public.app_has_permission(flag), false)
$$;

revoke all on function public.app_can_access_operations_area(text) from public, anon;
grant execute on function public.app_can_access_operations_area(text) to authenticated;

-- The distribution table contains employee-level issue history. Replace broad
-- authenticated policies with the explicit distribution permission when present.
do $do$
begin
  if to_regclass('public.workshop_stock_distributions') is null then return; end if;
  alter table public.workshop_stock_distributions enable row level security;
  drop policy if exists workshop_stock_distributions_explicit_select on public.workshop_stock_distributions;
  create policy workshop_stock_distributions_explicit_select
    on public.workshop_stock_distributions for select to authenticated
    using (public.app_can_access_operations_area('view_workshop_stock_distributions'));
  drop policy if exists workshop_stock_distributions_permission_boundary on public.workshop_stock_distributions;
  create policy workshop_stock_distributions_permission_boundary
    on public.workshop_stock_distributions as restrictive for all to authenticated
    using (public.app_can_access_operations_area('view_workshop_stock_distributions'))
    with check (public.app_can_access_operations_area('view_workshop_stock_distributions'));
  drop policy if exists workshop_stock_distributions_explicit_write on public.workshop_stock_distributions;
  create policy workshop_stock_distributions_explicit_write
    on public.workshop_stock_distributions for all to authenticated
    using (public.app_can_access_operations_area('view_workshop_stock_distributions'))
    with check (public.app_can_access_operations_area('view_workshop_stock_distributions'));
end
$do$;
