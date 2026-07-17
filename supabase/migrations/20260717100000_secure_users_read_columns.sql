-- Restrict public.users to the caller's row (or an explicitly-authorised user
-- administrator) and expose a deliberately small employee directory.
alter table public.users enable row level security;

revoke select on table public.users from anon, authenticated;

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
      and coalesce(u.permissions ->> 'manage_users', u.permissions ->> 'view_permissions') = 'yes'
  );
$$;
revoke all on function public.app_user_can_manage_users() from public, anon;
grant execute on function public.app_user_can_manage_users() to authenticated;

drop policy if exists users_select_active_public_safe on public.users;
drop policy if exists "users_select_authenticated_active" on public.users;
drop policy if exists users_current_or_manager_select on public.users;
create policy users_current_or_manager_select
on public.users for select to authenticated
using (auth_user_id = auth.uid() or public.app_user_can_manage_users());

-- Direct table reads are required by the existing administration client, but RLS
-- limits a normal user to their own record.  Only an explicit manager permission
-- permits reading other records (and consequently their administrative fields).
grant select on table public.users to authenticated;

drop view if exists public.current_app_user;
create view public.current_app_user
with (security_invoker = true, security_barrier = true)
as
select *
from public.users
where auth_user_id = auth.uid();
revoke all on table public.current_app_user from public, anon;
grant select on table public.current_app_user to authenticated;

-- This view intentionally runs with its owner privileges so RLS on public.users
-- cannot turn it into a one-row directory.  It contains no login or permission data.
drop view if exists public.app_user_directory;
create view public.app_user_directory
with (security_barrier = true)
as
select user_id, coalesce(full_name, name) as name, display_role, emp_id, is_active
from public.users
where is_active = true;
revoke all on table public.app_user_directory from public, anon;
grant select on table public.app_user_directory to authenticated;

comment on view public.current_app_user is
  'The complete public.users row belonging to auth.uid(); never returns another user.';
comment on view public.app_user_directory is
  'Safe directory: internal id, name, display role, employee number and status only.';

do $$
begin
  if has_table_privilege('anon', 'public.users', 'select') then
    raise exception 'Security invariant failed: anon can read public.users';
  end if;
end $$;
