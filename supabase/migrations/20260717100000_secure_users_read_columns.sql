-- Secure access to public.users while preserving Supabase Auth.
-- entry_code remains available only to trusted server-side processes.

alter table public.users enable row level security;

-- ============================================================
-- User-management permission
-- ============================================================

create or replace function public.app_user_can_manage_users()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.users as u
    where u.auth_user_id = auth.uid()
      and u.is_active = true
      and (
        u.role = 'admin'
        or u.permissions ->> 'manage_users' = 'yes'
        or u.permissions ->> 'view_permissions' = 'yes'
      )
  );
$$;

revoke all
on function public.app_user_can_manage_users()
from public, anon;

grant execute
on function public.app_user_can_manage_users()
to authenticated;

-- ============================================================
-- Remove unsafe SELECT policies
-- ============================================================

drop policy if exists users_select_active_public_safe
on public.users;

drop policy if exists "users_select_authenticated_active"
on public.users;

drop policy if exists users_current_or_manager_select
on public.users;

drop policy if exists users_current_or_manager_guard
on public.users;

-- A regular user can read only their own application profile.
-- An explicitly authorised administrator can read other profiles,
-- subject to the safe column list defined below.
create policy users_current_or_manager_select
on public.users
for select
to authenticated
using (
  auth_user_id = auth.uid()
  or public.app_user_can_manage_users()
);

-- Restrictive policy prevents another permissive SELECT policy
-- from accidentally broadening access.
create policy users_current_or_manager_guard
on public.users
as restrictive
for select
to authenticated
using (
  auth_user_id = auth.uid()
  or public.app_user_can_manage_users()
);

-- ============================================================
-- Remove all existing browser SELECT privileges
-- ============================================================

revoke select
on table public.users
from public, anon, authenticated;

-- Table-level REVOKE does not remove older column-level grants.
-- Therefore, remove SELECT from every existing column as well.
do $$
declare
  all_columns text;
begin
  select string_agg(
    quote_ident(column_name),
    ', ' order by ordinal_position
  )
  into all_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'users';

  if all_columns is null then
    raise exception 'public.users columns were not found';
  end if;

  execute format(
    'revoke select (%s) on table public.users from anon, authenticated',
    all_columns
  );
end
$$;

-- ============================================================
-- Grant authenticated users only approved columns
-- ============================================================

grant select (
  user_id,
  name,
  full_name,
  role,
  email,
  display_role,
  default_view,
  is_active,
  permissions,
  auth_user_id,
  auth_email,
  migrated_to_auth,
  created_at,
  updated_at,
  can_review_requests,
  username,
  view_certificates,
  view_proposals_agreements,
  manage_proposals_agreements,
  approve_proposals_agreements,
  emp_id,
  display_role2
)
on table public.users
to authenticated;

-- entry_code is intentionally excluded.

-- ============================================================
-- Current authenticated application user
-- ============================================================

drop view if exists public.current_app_user;

create view public.current_app_user
with (
  security_invoker = true,
  security_barrier = true
)
as
select
  user_id,
  username,
  email,
  name,
  full_name,
  role,
  display_role,
  display_role2,
  default_view,
  emp_id,
  is_active,
  permissions,
  created_at,
  updated_at,
  auth_user_id,
  auth_email,
  migrated_to_auth,
  can_review_requests,
  view_certificates,
  view_proposals_agreements,
  manage_proposals_agreements,
  approve_proposals_agreements
from public.users
where auth_user_id = auth.uid();

revoke all
on table public.current_app_user
from public, anon;

grant select
on table public.current_app_user
to authenticated;

comment on view public.current_app_user is
  'Application profile belonging to the current auth.uid(). Excludes entry_code.';

-- ============================================================
-- Safe employee directory
-- ============================================================

drop view if exists public.app_user_directory;

-- This view deliberately exposes only non-sensitive directory fields.
create view public.app_user_directory
with (security_barrier = true)
as
select
  user_id,
  coalesce(full_name, name) as name,
  display_role,
  emp_id,
  is_active
from public.users
where is_active = true;

revoke all
on table public.app_user_directory
from public, anon;

grant select
on table public.app_user_directory
to authenticated;

comment on view public.app_user_directory is
  'Safe employee directory without email, Auth UUID, permissions or entry_code.';

-- ============================================================
-- Security validation
-- ============================================================

do $$
begin
  if has_table_privilege(
    'anon',
    'public.users',
    'select'
  ) then
    raise exception
      'Security invariant failed: anon has table-level SELECT on public.users';
  end if;

  if has_column_privilege(
    'anon',
    'public.users',
    'entry_code',
    'select'
  ) then
    raise exception
      'Security invariant failed: anon can read entry_code';
  end if;

  if has_column_privilege(
    'authenticated',
    'public.users',
    'entry_code',
    'select'
  ) then
    raise exception
      'Security invariant failed: authenticated can read entry_code';
  end if;

  if not has_column_privilege(
    'authenticated',
    'public.users',
    'user_id',
    'select'
  ) then
    raise exception
      'Security invariant failed: authenticated cannot read safe user columns';
  end if;
end
$$;
