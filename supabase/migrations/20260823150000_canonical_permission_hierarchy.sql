-- Audit first, then preserve legacy-effective grants and canonicalize storage.
-- The audit rows intentionally remain queryable after deployment.
create table if not exists public.permission_migration_audit (
  migration text not null,
  finding text not null,
  affected_user_ids text[] not null default '{}',
  affected_count integer not null default 0,
  recorded_at timestamptz not null default now(),
  primary key (migration, finding)
);
revoke all on public.permission_migration_audit from public, anon, authenticated;

insert into public.permission_migration_audit(migration, finding, affected_user_ids, affected_count)
select '20260823150000', finding, ids, cardinality(ids)
from (
  select 'create_activity_granted_only_by_request_edit' finding,
    coalesce(array_agg(user_id order by user_id) filter (where user_id is not null), '{}') ids
  from public.users
  where role <> 'admin'
    and lower(coalesce(permissions->>'can_request_create_activity', '')) not in ('yes','true','1')
    and (lower(coalesce(permissions->>'can_request_edit', '')) in ('yes','true','1')
      or lower(coalesce(permissions->>'can_request_edit_2', '')) in ('yes','true','1'))
  union all
  select 'can_review_requests_column_conflict',
    coalesce(array_agg(user_id order by user_id) filter (where user_id is not null), '{}')
  from public.users
  where permissions ? 'can_review_requests'
    and (lower(coalesce(permissions->>'can_review_requests', '')) in ('yes','true','1'))
      is distinct from coalesce(can_review_requests, false)
  union all
  select 'legacy_proposals_alias_only',
    coalesce(array_agg(user_id order by user_id) filter (where user_id is not null), '{}')
  from public.users
  where role <> 'admin'
    and lower(coalesce(permissions->>'view_proposals', '')) in ('yes','true','1')
    and lower(coalesce(permissions->>'view_proposals_agreements', '')) not in ('yes','true','1')
) audit
on conflict (migration, finding) do nothing;

-- Preserve every user who received create-request access through the old
-- can_request_edit fallback before removing that fallback from runtime.
update public.users
set permissions = coalesce(permissions, '{}'::jsonb)
    || jsonb_build_object('can_request_create_activity', 'yes'),
    updated_at = now()
where role <> 'admin'
  and lower(coalesce(permissions->>'can_request_create_activity', '')) not in ('yes','true','1')
  and (lower(coalesce(permissions->>'can_request_edit', '')) in ('yes','true','1')
    or lower(coalesce(permissions->>'can_request_edit_2', '')) in ('yes','true','1'));

-- Nested JSON is canonical. When it has no canonical value, retain the legacy
-- column/alias grant; then mirror the legacy column to prevent old clients from
-- observing a contradictory result during the rollout.
update public.users
set permissions = coalesce(permissions, '{}'::jsonb) || jsonb_build_object(
      'can_review_requests', case
        when lower(coalesce(permissions->>'can_review_requests', '')) in ('yes','true','1') then 'yes'
        when not (permissions ? 'can_review_requests') and (
          coalesce(can_review_requests, false)
          or lower(coalesce(permissions->>'can_review_requests_2', '')) in ('yes','true','1')
        ) then 'yes'
        else 'no'
      end),
    updated_at = now();

update public.users
set can_review_requests = lower(coalesce(permissions->>'can_review_requests', '')) in ('yes','true','1'),
    updated_at = now()
where can_review_requests is distinct from
  (lower(coalesce(permissions->>'can_review_requests', '')) in ('yes','true','1'));

-- Clear all ineffective descendants. Opening a parent later does not recreate
-- these grants; children must be selected explicitly in the admin workspace.
with parent_children(parent_key, child_keys) as (values
  ('view_activities', array['view_activity_calendar','view_activity_exceptions','view_activity_end_dates','view_activity_archive','manage_activity_archive','can_add_activity','can_edit_direct','can_request_edit','can_request_create_activity','can_review_requests']),
  ('view_instructors', array['view_instructor_list','view_instructor_contacts','view_operations_scheduling','view_instructor_work_schedule','view_attendance_control','manage_instructor_maintenance','view_employee_files']),
  ('view_operations_management', array['view_operations_schedule_overview','view_activity_approvals','view_workshop_stock','view_workshop_stock_distributions','view_orders','view_catalog','manage_catalog','view_certificates','manage_workshop_training','manage_course_training','manage_print_kits']),
  ('view_workshop_stock', array['view_workshop_stock_distributions']),
  ('view_catalog', array['manage_catalog']),
  ('view_proposals_agreements', array['manage_proposals_agreements']),
  ('finance_access', array['view_finance_payroll','view_finance_collection','manage_finance_transactions'])
), blocked as (
  select u.user_id, array_agg(child_key) child_keys
  from public.users u
  cross join parent_children pc
  cross join unnest(pc.child_keys) child_key
  where u.role <> 'admin'
    and lower(coalesce(u.permissions->>pc.parent_key, '')) not in ('yes','true','1')
    and lower(coalesce(u.permissions->>child_key, '')) in ('yes','true','1')
  group by u.user_id
)
update public.users u
set permissions = (
      select u.permissions || coalesce(jsonb_object_agg(key, 'no'), '{}'::jsonb)
      from unnest(blocked.child_keys) key
    ),
    updated_at = now()
from blocked
where u.user_id = blocked.user_id;

-- Enforce the same parent chain in every RLS/RPC call that uses app_has_permission.
create or replace function public.app_has_permission(flag text)
returns boolean language sql stable security definer set search_path = public as $$
  with current_user_permissions as (
    select u.role, coalesce(u.permissions, '{}'::jsonb) permissions
    from public.users u where u.auth_user_id = auth.uid() and u.is_active = true limit 1
  ), requested as (
    select role, permissions,
      case flag
        when 'can_request_edit' then coalesce(permissions->>flag, permissions->>'can_request_edit_2')
        when 'can_review_requests' then coalesce(permissions->>flag, permissions->>'can_review_requests_2')
        when 'view_workshop_stock' then coalesce(permissions->>flag, permissions->>'view_inventory')
        when 'finance_access' then coalesce(permissions->>flag, permissions->>'view_finance')
        else permissions->>flag
      end value,
      case
        when flag = any(array['view_activity_calendar','view_activity_exceptions','view_activity_end_dates','view_activity_archive','manage_activity_archive','can_add_activity','can_edit_direct','can_request_edit','can_request_create_activity','can_review_requests']) then 'view_activities'
        when flag = any(array['view_instructor_list','view_instructor_contacts','view_operations_scheduling','view_instructor_work_schedule','view_attendance_control','manage_instructor_maintenance','view_employee_files']) then 'view_instructors'
        when flag = 'view_workshop_stock_distributions' then 'view_workshop_stock'
        when flag = 'manage_catalog' then 'view_catalog'
        when flag = any(array['view_operations_schedule_overview','view_activity_approvals','view_workshop_stock','view_orders','view_catalog','view_certificates','manage_workshop_training','manage_course_training','manage_print_kits']) then 'view_operations_management'
        when flag = 'manage_proposals_agreements' then 'view_proposals_agreements'
        when flag = any(array['view_finance_payroll','view_finance_collection','manage_finance_transactions']) then 'finance_access'
      end parent_flag
    from current_user_permissions
  )
  select coalesce(role = 'admin' or (
    lower(coalesce(value, '')) in ('yes','true','1')
    and (parent_flag is null or lower(coalesce(
      case parent_flag
        when 'finance_access' then coalesce(permissions->>parent_flag, permissions->>'view_finance')
        else permissions->>parent_flag
      end, '')) in ('yes','true','1'))
    and (flag not in ('view_workshop_stock_distributions', 'manage_catalog')
      or lower(coalesce(permissions->>'view_operations_management', '')) in ('yes','true','1'))
  ), false) from requested
$$;
revoke all on function public.app_has_permission(text) from public, anon;
grant execute on function public.app_has_permission(text) to authenticated;
