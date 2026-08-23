-- Unified employee profile data for the admin-only users & permissions workspace.
-- Keeps the application account/permission model in public.users and stores
-- personal employment/contact details separately, while synchronising instructors.

create table if not exists public.employee_profiles (
  user_id text primary key references public.users(user_id) on delete cascade,
  emp_id text unique,
  full_name text,
  email text,
  mobile text,
  address text,
  birth_date date,
  direct_manager text,
  employment_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.employee_profiles enable row level security;

revoke all on table public.employee_profiles from public, anon;
grant select, insert, update, delete on table public.employee_profiles to authenticated;

drop policy if exists employee_profiles_admin_select on public.employee_profiles;
create policy employee_profiles_admin_select
on public.employee_profiles
for select
to authenticated
using (public.app_current_role() = 'admin');

drop policy if exists employee_profiles_admin_insert on public.employee_profiles;
create policy employee_profiles_admin_insert
on public.employee_profiles
for insert
to authenticated
with check (public.app_current_role() = 'admin');

drop policy if exists employee_profiles_admin_update on public.employee_profiles;
create policy employee_profiles_admin_update
on public.employee_profiles
for update
to authenticated
using (public.app_current_role() = 'admin')
with check (public.app_current_role() = 'admin');

drop policy if exists employee_profiles_admin_delete on public.employee_profiles;
create policy employee_profiles_admin_delete
on public.employee_profiles
for delete
to authenticated
using (public.app_current_role() = 'admin');

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
      and u.role = 'admin'
  );
$$;

revoke all on function public.app_user_can_manage_users() from public, anon;
grant execute on function public.app_user_can_manage_users() to authenticated;

insert into public.employee_profiles (
  user_id, emp_id, full_name, email, mobile, address, birth_date,
  direct_manager, employment_type, created_at, updated_at
)
select
  u.user_id,
  coalesce(nullif(u.emp_id, ''), nullif(u.user_id, '')) as emp_id,
  coalesce(nullif(ci.full_name, ''), nullif(u.full_name, ''), nullif(u.name, '')) as full_name,
  coalesce(nullif(ci.email, ''), nullif(u.email, '')) as email,
  nullif(ci.mobile, '') as mobile,
  nullif(ci.address, '') as address,
  ci.birth_date,
  nullif(ci.direct_manager, '') as direct_manager,
  nullif(ci.employment_type, '') as employment_type,
  coalesce(u.created_at, now()),
  now()
from public.users u
left join public.contacts_instructors ci
  on ci.emp_id::text = coalesce(nullif(u.emp_id, ''), nullif(u.user_id, ''))
on conflict (user_id) do update set
  emp_id = excluded.emp_id,
  full_name = coalesce(excluded.full_name, public.employee_profiles.full_name),
  email = coalesce(excluded.email, public.employee_profiles.email),
  mobile = coalesce(excluded.mobile, public.employee_profiles.mobile),
  address = coalesce(excluded.address, public.employee_profiles.address),
  birth_date = coalesce(excluded.birth_date, public.employee_profiles.birth_date),
  direct_manager = coalesce(excluded.direct_manager, public.employee_profiles.direct_manager),
  employment_type = coalesce(excluded.employment_type, public.employee_profiles.employment_type),
  updated_at = now();

create or replace function private.sync_instructor_contact_to_employee_profile()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_emp text;
  v_user_id text;
  v_active boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and coalesce(public.app_current_role(), '') not in ('admin','operation_manager','activities_manager','domain_manager','instructor_manager','business_development_manager') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    v_emp := old.emp_id::text;
    update public.users
       set is_active = false,
           updated_at = now()
     where coalesce(nullif(emp_id, ''), user_id) = v_emp
       and is_active is distinct from false;
    return old;
  end if;

  v_emp := new.emp_id::text;
  v_active := lower(coalesce(nullif(new.active, ''), 'yes')) not in ('no', 'false', '0', 'inactive');

  insert into public.users (
    user_id, emp_id, username, name, full_name, role, display_role,
    email, is_active, permissions
  ) values (
    v_emp, v_emp, v_emp, new.full_name, new.full_name, 'instructor', 'instructor',
    new.email, v_active, jsonb_build_object('can_request_edit', 'yes')
  )
  on conflict (user_id) do update set
    emp_id = coalesce(nullif(public.users.emp_id, ''), excluded.emp_id),
    name = coalesce(nullif(excluded.name, ''), public.users.name),
    full_name = coalesce(nullif(excluded.full_name, ''), public.users.full_name),
    email = coalesce(nullif(excluded.email, ''), public.users.email),
    is_active = excluded.is_active,
    updated_at = now()
  where (public.users.emp_id, public.users.name, public.users.full_name, public.users.email, public.users.is_active)
        is distinct from
        (coalesce(nullif(public.users.emp_id, ''), excluded.emp_id),
         coalesce(nullif(excluded.name, ''), public.users.name),
         coalesce(nullif(excluded.full_name, ''), public.users.full_name),
         coalesce(nullif(excluded.email, ''), public.users.email),
         excluded.is_active);

  select u.user_id
    into v_user_id
    from public.users u
   where u.user_id = v_emp or u.emp_id = v_emp
   order by case when u.user_id = v_emp then 0 else 1 end
   limit 1;

  if v_user_id is not null then
    insert into public.employee_profiles (
      user_id, emp_id, full_name, email, mobile, address, birth_date,
      direct_manager, employment_type, updated_at
    ) values (
      v_user_id, v_emp, new.full_name, new.email, new.mobile, new.address,
      new.birth_date, new.direct_manager, new.employment_type, now()
    )
    on conflict (user_id) do update set
      emp_id = excluded.emp_id,
      full_name = excluded.full_name,
      email = excluded.email,
      mobile = excluded.mobile,
      address = excluded.address,
      birth_date = excluded.birth_date,
      direct_manager = excluded.direct_manager,
      employment_type = excluded.employment_type,
      updated_at = now()
    where (public.employee_profiles.emp_id, public.employee_profiles.full_name, public.employee_profiles.email,
           public.employee_profiles.mobile, public.employee_profiles.address, public.employee_profiles.birth_date,
           public.employee_profiles.direct_manager, public.employee_profiles.employment_type)
          is distinct from
          (excluded.emp_id, excluded.full_name, excluded.email, excluded.mobile, excluded.address,
           excluded.birth_date, excluded.direct_manager, excluded.employment_type);
  end if;

  return new;
end;
$$;

create or replace function private.sync_user_to_employee_profile()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_emp text;
  v_active_text text;
begin
  if tg_op = 'DELETE' then
    v_emp := coalesce(nullif(old.emp_id, ''), nullif(old.user_id, ''));
    if v_emp ~ '^[0-9]+$' then
      update public.contacts_instructors
         set active = 'no'
       where emp_id = v_emp::bigint
         and lower(coalesce(active, 'yes')) <> 'no';
    end if;
    return old;
  end if;

  v_emp := coalesce(nullif(new.emp_id, ''), nullif(new.user_id, ''));
  v_active_text := case when new.is_active then 'yes' else 'no' end;

  insert into public.employee_profiles (user_id, emp_id, full_name, email, updated_at)
  values (new.user_id, v_emp, coalesce(new.full_name, new.name), new.email, now())
  on conflict (user_id) do update set
    emp_id = excluded.emp_id,
    full_name = coalesce(excluded.full_name, public.employee_profiles.full_name),
    email = coalesce(excluded.email, public.employee_profiles.email),
    updated_at = now()
  where (public.employee_profiles.emp_id, public.employee_profiles.full_name, public.employee_profiles.email)
        is distinct from
        (excluded.emp_id,
         coalesce(excluded.full_name, public.employee_profiles.full_name),
         coalesce(excluded.email, public.employee_profiles.email));

  if new.role = 'instructor' and v_emp ~ '^[0-9]+$' then
    update public.contacts_instructors
       set full_name = coalesce(new.full_name, new.name, full_name),
           email = coalesce(new.email, email),
           active = v_active_text
     where emp_id = v_emp::bigint
       and (full_name, email, lower(coalesce(active, 'yes')))
           is distinct from
           (coalesce(new.full_name, new.name, full_name), coalesce(new.email, email), v_active_text);
  end if;

  return new;
end;
$$;

create or replace function private.sync_employee_profile_to_instructor_contact()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_role text;
  v_active boolean;
begin
  select u.role, u.is_active
    into v_role, v_active
    from public.users u
   where u.user_id = new.user_id;

  if v_role = 'instructor' and new.emp_id ~ '^[0-9]+$' then
    update public.contacts_instructors
       set full_name = coalesce(new.full_name, full_name),
           email = coalesce(new.email, email),
           mobile = new.mobile,
           address = new.address,
           birth_date = new.birth_date,
           direct_manager = new.direct_manager,
           employment_type = new.employment_type,
           active = case when coalesce(v_active, true) then 'yes' else 'no' end
     where emp_id = new.emp_id::bigint
       and (full_name, email, mobile, address, birth_date, direct_manager, employment_type, lower(coalesce(active, 'yes')))
           is distinct from
           (coalesce(new.full_name, full_name), coalesce(new.email, email), new.mobile, new.address,
            new.birth_date, new.direct_manager, new.employment_type,
            case when coalesce(v_active, true) then 'yes' else 'no' end);
  end if;

  return new;
end;
$$;

drop trigger if exists sync_employee_profile_from_instructor_contact on public.contacts_instructors;
create trigger sync_employee_profile_from_instructor_contact
after insert or update or delete on public.contacts_instructors
for each row execute function private.sync_instructor_contact_to_employee_profile();

drop trigger if exists sync_employee_profile_from_user on public.users;
create trigger sync_employee_profile_from_user
after insert or update or delete on public.users
for each row execute function private.sync_user_to_employee_profile();

drop trigger if exists sync_instructor_contact_from_employee_profile on public.employee_profiles;
create trigger sync_instructor_contact_from_employee_profile
after update of emp_id, full_name, email, mobile, address, birth_date, direct_manager, employment_type on public.employee_profiles
for each row execute function private.sync_employee_profile_to_instructor_contact();

comment on table public.employee_profiles is
  'Admin-managed employee contact/employment details keyed to public.users. Instructor details are synchronized with contacts_instructors.';
