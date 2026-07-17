-- Secure browser reads from public.users while preserving Supabase Auth.
-- entry_code remains available only to trusted server-side/database processes.

alter table public.users enable row level security;

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
        u.permissions ->> 'manage_users' = 'yes'
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

-- Remove known broad read policies.
drop policy if exists users_select_active_public_safe on public.users;
drop policy if exists "users_select_authenticated_active" on public.users;
drop policy if exists users_current_or_manager_select on public.users;
drop policy if exists users_current_or_manager_guard on public.users;

-- A normal user can read only their own row.
-- An explicitly authorised user administrator can read other rows,
-- but only through the safe column grants defined below.
create policy users_current_or_manager_select
on public.users
for select
to authenticated
using (
  auth_user_id = auth.uid()
  or public.app_user_can_manage_users()
);

-- Restrictive protection prevents another permissive SELECT policy from
-- accidentally broadening access.
create policy users_current_or_manager_guard
on public.users
as restrictive
for select
to authenticated
using (
  auth_user_id = auth.uid()
  or public.app_user_can_manage_users()
);

-- Remove table-wide browser access.
revoke select on table public.users from public, anon, authenticated;

-- Grant only explicitly approved columns.
-- entry_code is intentionally excluded.
do $$
declare
  safe_columns text[] := array[
    'user_id',
    'username',
    'email',
    'name',
    'full_name',
    'role',
    'display_role',
    'display_role2',
    'default_view',
    'emp_id',
    'is_active',
    'permissions',
    'created_at',
    'updated_at',
    'auth_user_id',
    'auth_email',
    'migrated_to_auth',
    'can_review_requests',
    'can_request_edit',
    'can_request_edit_2',
    'can_edit_direct',
    'can_add_activity',
    'view_certificates',
    'view_proposals_agreements',
    'manage_proposals_agreements',
    'approve_proposals_agreements'
  ];
  existing_columns text;
begin
  select string_agg(
    quote_ident(column_name),
    ', ' order by array_position(safe_columns, column_name)
  )
  into existing_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'users'
    and column_name = any(safe_columns);

  if existing_columns is null then
    raise exception 'No approved public.users columns were found';
  end if;

  execute format(
    'grant select (%s) on table public.users to authenticated',
    existing_columns
  );
end
$$;

-- The current signed-in user's application profile.
-- Never use SELECT * here.
drop view if exists public.current_app_user;

create view public.current_app_user
with (security_invoker = true, security_barrier = true)
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
  can_request_edit,
  can_request_edit_2,
  can_edit_direct,
  can_add_activity,
  view_certificates,
  view_proposals_agreements,
  manage_proposals_agreements,
  approve_proposals_agreements
from public.users
where auth_user_id = auth.uid();

revoke all on table public.current_app_user from public, anon;
grant select on table public.current_app_user to authenticated;

-- Safe employee directory. The view exposes no email, Auth UUID,
-- permission map or entry_code.
drop view if exists public.app_user_directory;

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

revoke all on table public.app_user_directory from public, anon;
grant select on table public.app_user_directory to authenticated;

comment on view public.current_app_user is
  'Application profile of the current auth.uid(). Excludes entry_code.';

comment on view public.app_user_directory is
  'Safe employee directory without email, Auth UUID, permissions or entry_code.';

-- Security invariants.
do $$
begin
  if has_table_privilege('anon', 'public.users', 'select') then
    raise exception 'Security invariant failed: anon can read public.users';
  end if;

  if has_column_privilege(
    'anon',
    'public.users',
    'entry_code',
    'select'
  ) then
    raise exception 'Security invariant failed: anon can read entry_code';
  end if;

  if has_column_privilege(
    'authenticated',
    'public.users',
    'entry_code',
    'select'
  ) then
    raise exception 'Security invariant failed: authenticated can read entry_code';
  end if;
end
$$;
