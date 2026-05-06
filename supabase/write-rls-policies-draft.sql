-- ============================================================
-- DRAFT ONLY — DO NOT RUN WITHOUT EXPLICIT APPROVAL
-- Safe write RLS policies for Supabase Auth migration.
--
-- Goals:
-- - No broad authenticated write policies.
-- - Keep entry_code intact; it is not used by these policies.
-- - Derive app roles/flags from public.users by auth.uid() = auth_user_id.
--
-- IMPORTANT PRIVATE NOTES LIMITATION:
-- Row Level Security cannot hide a single column inside public.activities per app role
-- when the table remains directly selected by the browser. This draft blocks writes to
-- activities.operations_private_notes for non admin/operation_manager via trigger.
-- For strict read isolation, move private notes to public.operations_private_notes or
-- expose activity reads through role-aware views/RPC before revoking column access.
-- ============================================================

begin;

-- Required auth linkage for Supabase Auth users.
alter table public.users add column if not exists auth_user_id uuid unique;
alter table public.users add column if not exists display_role text;
create index if not exists users_auth_user_id_idx on public.users(auth_user_id);

-- ---------- Helper functions ----------
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

create or replace function public.app_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.app_current_role() = 'admin', false)
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

create or replace function public.app_can_add_activity()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.app_is_admin_or_operation_manager() or public.app_has_permission('can_add_activity'), false)
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

create or replace function public.app_can_request_edit()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.app_is_admin_or_operation_manager() or public.app_has_permission('can_request_edit'), false)
$$;

revoke all on function public.app_current_user_id() from public;
revoke all on function public.app_current_role() from public;
revoke all on function public.app_has_permission(text) from public;
revoke all on function public.app_is_admin() from public;
revoke all on function public.app_is_admin_or_operation_manager() from public;
revoke all on function public.app_can_add_activity() from public;
revoke all on function public.app_can_edit_direct() from public;
revoke all on function public.app_can_request_edit() from public;
grant execute on function public.app_current_user_id() to authenticated;
grant execute on function public.app_current_role() to authenticated;
grant execute on function public.app_has_permission(text) to authenticated;
grant execute on function public.app_is_admin() to authenticated;
grant execute on function public.app_is_admin_or_operation_manager() to authenticated;
grant execute on function public.app_can_add_activity() to authenticated;
grant execute on function public.app_can_edit_direct() to authenticated;
grant execute on function public.app_can_request_edit() to authenticated;

-- ---------- public.users ----------
alter table public.users enable row level security;

drop policy if exists users_select_active on public.users;
drop policy if exists users_select_active_public_safe on public.users;
drop policy if exists users_insert_all on public.users;
drop policy if exists users_update_all on public.users;
drop policy if exists users_delete_all on public.users;
drop policy if exists users_select_self_or_managers on public.users;
drop policy if exists users_insert_admin_only on public.users;
drop policy if exists users_update_admin_only on public.users;
drop policy if exists users_delete_admin_only on public.users;

create policy users_select_self_or_managers
on public.users
for select
to authenticated
using (auth.uid() = auth_user_id or public.app_is_admin_or_operation_manager());

create policy users_insert_admin_only
on public.users
for insert
to authenticated
with check (public.app_is_admin());

create policy users_update_admin_only
on public.users
for update
to authenticated
using (public.app_is_admin())
with check (public.app_is_admin());

create policy users_delete_admin_only
on public.users
for delete
to authenticated
using (public.app_is_admin());

-- OPTIONAL ONLY — do not enable without product approval:
-- create policy users_update_operation_manager_optional
-- on public.users
-- for update
-- to authenticated
-- using (public.app_is_admin_or_operation_manager())
-- with check (public.app_is_admin_or_operation_manager());

revoke all on public.users from anon, authenticated;
grant select (user_id, email, name, role, display_role, emp_id, is_active, permissions, auth_user_id, created_at, updated_at)
  on public.users to authenticated;
grant insert, update, delete on public.users to authenticated;

-- ---------- public.activities ----------
alter table public.activities enable row level security;

drop policy if exists activities_select_public on public.activities;
drop policy if exists activities_write_authenticated on public.activities;
drop policy if exists activities_select_authenticated on public.activities;
drop policy if exists activities_insert_can_add on public.activities;
drop policy if exists activities_update_direct_editors on public.activities;
drop policy if exists activities_delete_none on public.activities;

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

-- No DELETE policy for activities.

revoke insert, update, delete on public.activities from anon;
grant select, insert, update on public.activities to authenticated;
revoke delete on public.activities from authenticated;

-- Block private-note column writes by non admin/operation_manager even when they can edit activities.
create or replace function public.prevent_private_note_update_by_non_managers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.operations_private_notes is distinct from new.operations_private_notes
     and not public.app_is_admin_or_operation_manager() then
    raise exception 'operations_private_notes can be changed only by admin or operation_manager';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_private_note_update_by_non_managers on public.activities;
create trigger trg_prevent_private_note_update_by_non_managers
before update on public.activities
for each row
execute function public.prevent_private_note_update_by_non_managers();

-- ---------- public.edit_requests ----------
alter table public.edit_requests enable row level security;

drop policy if exists edit_requests_select_all on public.edit_requests;
drop policy if exists edit_requests_insert_all on public.edit_requests;
drop policy if exists edit_requests_update_all on public.edit_requests;
drop policy if exists edit_requests_delete_all on public.edit_requests;
drop policy if exists edit_requests_insert_requesters on public.edit_requests;
drop policy if exists edit_requests_select_own_or_reviewers on public.edit_requests;
drop policy if exists edit_requests_update_reviewers on public.edit_requests;

create policy edit_requests_insert_requesters
on public.edit_requests
for insert
to authenticated
with check (
  public.app_can_request_edit()
  and requested_by_user_id = public.app_current_user_id()
  and coalesce(status, 'pending') = 'pending'
);

create policy edit_requests_select_own_or_reviewers
on public.edit_requests
for select
to authenticated
using (
  public.app_is_admin_or_operation_manager()
  or requested_by_user_id = public.app_current_user_id()
);

create policy edit_requests_update_reviewers
on public.edit_requests
for update
to authenticated
using (public.app_is_admin_or_operation_manager())
with check (
  public.app_is_admin_or_operation_manager()
  and status in ('approved', 'rejected', 'conflict', 'pending')
);

-- No DELETE policy for edit_requests.

revoke insert, update, delete on public.edit_requests from anon;
grant select, insert, update on public.edit_requests to authenticated;
revoke delete on public.edit_requests from authenticated;

-- ---------- public.settings ----------
alter table public.settings enable row level security;

drop policy if exists settings_select_all on public.settings;
drop policy if exists settings_select_public on public.settings;
drop policy if exists settings_insert_all on public.settings;
drop policy if exists settings_update_all on public.settings;
drop policy if exists settings_delete_all on public.settings;
drop policy if exists settings_select_authenticated on public.settings;
drop policy if exists settings_insert_admin_only on public.settings;
drop policy if exists settings_update_admin_only on public.settings;

create policy settings_select_authenticated
on public.settings
for select
to authenticated
using (auth.uid() is not null);

create policy settings_insert_admin_only
on public.settings
for insert
to authenticated
with check (public.app_is_admin());

create policy settings_update_admin_only
on public.settings
for update
to authenticated
using (public.app_is_admin())
with check (public.app_is_admin());

-- No DELETE policy for settings.

revoke insert, update, delete on public.settings from anon;
grant select, insert, update on public.settings to authenticated;
revoke delete on public.settings from authenticated;

-- ---------- public.lists ----------
alter table public.lists enable row level security;

drop policy if exists lists_select_all on public.lists;
drop policy if exists lists_select_authenticated on public.lists;
drop policy if exists lists_insert_all on public.lists;
drop policy if exists lists_update_all on public.lists;
drop policy if exists lists_delete_all on public.lists;

create policy lists_select_authenticated
on public.lists
for select
to authenticated
using (auth.uid() is not null);

-- No INSERT/UPDATE/DELETE policies for lists because admin-lists has no active write UI.

revoke insert, update, delete on public.lists from anon, authenticated;
grant select on public.lists to authenticated;

-- ---------- contacts ----------
alter table public.contacts_instructors enable row level security;
alter table public.contacts_schools enable row level security;

drop policy if exists contacts_instructors_select_authenticated on public.contacts_instructors;
drop policy if exists contacts_instructors_insert_managers on public.contacts_instructors;
drop policy if exists contacts_instructors_update_managers on public.contacts_instructors;
drop policy if exists contacts_schools_select_authenticated on public.contacts_schools;
drop policy if exists contacts_schools_insert_managers on public.contacts_schools;
drop policy if exists contacts_schools_update_managers on public.contacts_schools;
drop policy if exists contacts_schools_delete_managers on public.contacts_schools;

create policy contacts_instructors_select_authenticated
on public.contacts_instructors
for select
to authenticated
using (auth.uid() is not null);

create policy contacts_instructors_insert_managers
on public.contacts_instructors
for insert
to authenticated
with check (public.app_is_admin_or_operation_manager());

create policy contacts_instructors_update_managers
on public.contacts_instructors
for update
to authenticated
using (public.app_is_admin_or_operation_manager())
with check (public.app_is_admin_or_operation_manager());

-- No DELETE policy for contacts_instructors.

create policy contacts_schools_select_authenticated
on public.contacts_schools
for select
to authenticated
using (auth.uid() is not null);

create policy contacts_schools_insert_managers
on public.contacts_schools
for insert
to authenticated
with check (public.app_is_admin_or_operation_manager());

create policy contacts_schools_update_managers
on public.contacts_schools
for update
to authenticated
using (public.app_is_admin_or_operation_manager())
with check (public.app_is_admin_or_operation_manager());

-- DELETE is required only for school-contact key changes in api.saveContact.
create policy contacts_schools_delete_managers
on public.contacts_schools
for delete
to authenticated
using (public.app_is_admin_or_operation_manager());

revoke insert, update, delete on public.contacts_instructors from anon;
grant select, insert, update on public.contacts_instructors to authenticated;
revoke delete on public.contacts_instructors from authenticated;

revoke insert, update, delete on public.contacts_schools from anon;
grant select, insert, update, delete on public.contacts_schools to authenticated;

commit;
