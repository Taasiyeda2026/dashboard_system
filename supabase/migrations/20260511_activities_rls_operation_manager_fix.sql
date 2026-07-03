-- Align activities RLS with role-aware helper functions so operation_manager
-- is evaluated by auth.uid() -> public.users.auth_user_id mapping.

alter table public.users add column if not exists auth_user_id uuid unique;

create index if not exists users_auth_user_id_idx on public.users(auth_user_id);

create or replace function public.app_current_user_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.user_id
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.is_active = true
  limit 1
$$;

create or replace function public.app_current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.role
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.is_active = true
  limit 1
$$;

create or replace function public.app_has_permission(flag text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    lower(coalesce(u.permissions ->> flag, '')) in ('yes', 'true', '1'),
    false
  )
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.is_active = true
  limit 1
$$;

create or replace function public.app_is_admin_or_operation_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.app_current_role() in ('admin', 'operation_manager'), false)
$$;

create or replace function public.app_can_edit_direct()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.app_is_admin_or_operation_manager() or public.app_has_permission('can_edit_direct'), false)
$$;

create or replace function public.app_can_add_activity()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.app_is_admin_or_operation_manager() or public.app_has_permission('can_add_activity'), false)
$$;

revoke all on function public.app_current_user_id() from public;

revoke all on function public.app_current_role() from public;

revoke all on function public.app_has_permission(text) from public;

revoke all on function public.app_is_admin_or_operation_manager() from public;

revoke all on function public.app_can_edit_direct() from public;

revoke all on function public.app_can_add_activity() from public;

grant execute on function public.app_current_user_id() to authenticated;

grant execute on function public.app_current_role() to authenticated;

grant execute on function public.app_has_permission(text) to authenticated;

grant execute on function public.app_is_admin_or_operation_manager() to authenticated;

grant execute on function public.app_can_edit_direct() to authenticated;

grant execute on function public.app_can_add_activity() to authenticated;

alter table public.activities enable row level security;

drop policy if exists activities_write_authenticated on public.activities;

drop policy if exists activities_select_authenticated on public.activities;

drop policy if exists activities_insert_can_add on public.activities;

drop policy if exists activities_update_direct_editors on public.activities;

create policy activities_select_authenticated
on public.activities
for select
to authenticated
using (auth.uid() is not null);

create policy activities_insert_can_add
on public.activities
for insert
to authenticated
with check (public.app_can_add_activity());

create policy activities_update_direct_editors
on public.activities
for update
to authenticated
using (public.app_can_edit_direct())
with check (public.app_can_edit_direct());

revoke insert, update, delete on public.activities from anon;

grant select, insert, update on public.activities to authenticated;

revoke delete on public.activities from authenticated;
