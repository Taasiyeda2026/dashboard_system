-- Grant Hila Rozen the explicit edit-request review capability and align
-- instructor-maintenance RLS with the canonical permission used by the UI.
-- This does not grant activity-completion approval permissions.

insert into public.permission_matrix_audit (migration, user_id, permissions_before)
select '20260917115500', u.user_id, coalesce(u.permissions, '{}'::jsonb)
from public.users u
where u.user_id = '1500'
on conflict (migration, user_id) do nothing;

do $$
begin
  if not exists (
    select 1
    from public.users u
    where u.user_id = '1500'
      and u.full_name = 'הילה רוזן'
      and u.is_active = true
  ) then
    raise exception 'hila_active_user_not_found';
  end if;
end $$;

update public.users
set permissions = jsonb_set(
      coalesce(permissions, '{}'::jsonb),
      '{can_review_requests}',
      '"yes"'::jsonb,
      true
    ),
    can_review_requests = true,
    updated_at = now()
where user_id = '1500';

-- Keep the existing policy names for forward compatibility, but make the
-- authorization decision from the same explicit capability the frontend uses.
drop policy if exists instructor_scheduling_profiles_admin_operations
  on public.instructor_scheduling_profiles;
create policy instructor_scheduling_profiles_admin_operations
  on public.instructor_scheduling_profiles
  for all
  to authenticated
  using (public.app_has_permission('manage_instructor_maintenance'))
  with check (public.app_has_permission('manage_instructor_maintenance'));

drop policy if exists instructor_availability_rules_admin_operations
  on public.instructor_availability_rules;
create policy instructor_availability_rules_admin_operations
  on public.instructor_availability_rules
  for all
  to authenticated
  using (public.app_has_permission('manage_instructor_maintenance'))
  with check (public.app_has_permission('manage_instructor_maintenance'));

drop policy if exists instructor_availability_exceptions_admin_operations
  on public.instructor_availability_exceptions;
create policy instructor_availability_exceptions_admin_operations
  on public.instructor_availability_exceptions
  for all
  to authenticated
  using (public.app_has_permission('manage_instructor_maintenance'))
  with check (public.app_has_permission('manage_instructor_maintenance'));
