-- Prevent browser clients from reading login secrets while preserving the existing
-- Supabase Auth flow and the safe user fields required by the dashboard.
-- This migration intentionally does not delete entry_code: server-side legacy login
-- and one-off Auth migration scripts may still use it.

alter table public.users enable row level security;

-- Remove every table-wide read grant (including the grant introduced by the admin
-- permissions migration). Column grants below are the only direct browser reads.
revoke select on table public.users from anon, authenticated;
revoke select (entry_code) on table public.users from anon, authenticated;

-- No unauthenticated directory access is required after Supabase Auth login.
-- Existing SECURITY DEFINER login RPCs retain owner access and are unaffected.

-- Safe fields used by authenticated bootstrap/auth resolution, activity permission
-- context, and the permissions administration screen. email/auth_user_id are retained
-- because auth-user-resolve.js maps the Auth identity to the active application row;
-- neither is exposed through the employee-directory view below.
do $$
declare
  safe_columns text[] := array[
    'user_id', 'username', 'email', 'name', 'full_name', 'role',
    'display_role', 'display_role2', 'default_view', 'emp_id', 'is_active',
    'permissions', 'created_at', 'updated_at', 'auth_user_id', 'auth_email',
    'migrated_to_auth', 'can_review_requests', 'can_request_edit',
    'can_request_edit_2', 'can_edit_direct', 'can_add_activity',
    'view_certificates', 'view_proposals_agreements',
    'manage_proposals_agreements', 'approve_proposals_agreements'
  ];
  existing_columns text;
begin
  select string_agg(quote_ident(column_name), ', ' order by array_position(safe_columns, column_name))
    into existing_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'users'
    and column_name = any(safe_columns);

  if existing_columns is null then
    raise exception 'No safe public.users columns found for authenticated SELECT grant';
  end if;

  execute format('grant select (%s) on table public.users to authenticated', existing_columns);
end $$;

-- A deliberately small employee directory for screens that need names/identifiers.
-- security_invoker ensures the caller's public.users RLS and column privileges apply.
drop view if exists public.app_user_directory;
create view public.app_user_directory
with (security_invoker = true)
as
select user_id, name, full_name, display_role, emp_id, is_active
from public.users
where is_active = true;

revoke all on table public.app_user_directory from public, anon;
grant select on table public.app_user_directory to authenticated;

comment on view public.app_user_directory is
  'Authenticated, RLS-respecting employee directory. Excludes email, Auth UUIDs, permissions and entry_code.';

-- Fail migration validation if a future edit accidentally grants the secret column.
do $$
begin
  if has_column_privilege('anon', 'public.users', 'entry_code', 'select')
     or has_column_privilege('authenticated', 'public.users', 'entry_code', 'select') then
    raise exception 'Security invariant failed: entry_code is browser-readable';
  end if;
end $$;
