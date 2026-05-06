create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  user_id text not null unique,
  email text unique,
  name text not null default '',
  role text not null default 'authorized_user',
  emp_id text,
  is_active boolean not null default true,
  permissions jsonb not null default '{}'::jsonb,
  entry_code text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_role_check check (role in ('admin', 'operation_manager', 'authorized_user', 'instructor'))
);

create index if not exists users_role_idx on public.users(role);
create index if not exists users_is_active_idx on public.users(is_active);
create index if not exists users_emp_id_idx on public.users(emp_id);

create or replace function public.touch_users_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_users_updated_at on public.users;
create trigger trg_touch_users_updated_at
before update on public.users
for each row
execute function public.touch_users_updated_at();

alter table public.users enable row level security;

drop policy if exists users_select_active on public.users;
create policy users_select_active
on public.users
for select
to anon, authenticated
using (is_active = true);

drop policy if exists users_insert_all on public.users;
create policy users_insert_all
on public.users
for insert
to anon, authenticated
with check (true);

drop policy if exists users_update_all on public.users;
create policy users_update_all
on public.users
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists users_delete_all on public.users;
create policy users_delete_all
on public.users
for delete
to anon, authenticated
using (true);

grant select, insert, update, delete on public.users to anon, authenticated;
-- Login validates entry_code server-side and returns explicit diagnostics without exposing entry_code.
drop function if exists public.login_user_by_entry_code(text, text);
create function public.login_user_by_entry_code(p_login text, p_entry_code text)
returns table (
  login_status text,
  user_id text,
  email text,
  name text,
  role text,
  emp_id text,
  is_active boolean,
  permissions jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  with input as (
    select trim(coalesce(p_login, '')) as login, trim(coalesce(p_entry_code, '')) as code
  ), candidate as (
    select u.*
    from public.users u
    cross join input i
    where u.user_id = i.login
       or u.email = i.login
       or u.emp_id = i.login
    order by case
      when u.user_id = i.login then 1
      when u.email = i.login then 2
      when u.emp_id = i.login then 3
      else 4
    end, u.created_at desc
    limit 1
  ), diagnostic as (
    select
      case
        when not exists (select 1 from candidate) then 'user_not_found'
        when not (select c.is_active from candidate c) then 'inactive_user'
        when trim(coalesce((select c.entry_code from candidate c), '')) <> (select i.code from input i) then 'entry_code_mismatch'
        when coalesce((select c.role from candidate c), '') not in ('admin', 'operation_manager', 'authorized_user', 'instructor') then 'invalid_role'
        else 'ok'
      end as login_status
  )
  select
    d.login_status,
    case when d.login_status = 'ok' then c.user_id end as user_id,
    case when d.login_status = 'ok' then c.email end as email,
    case when d.login_status = 'ok' then c.name end as name,
    case when d.login_status = 'ok' then c.role end as role,
    case when d.login_status = 'ok' then c.emp_id end as emp_id,
    case when d.login_status = 'ok' then c.is_active end as is_active,
    case when d.login_status = 'ok' then c.permissions end as permissions,
    case when d.login_status = 'ok' then c.created_at end as created_at,
    case when d.login_status = 'ok' then c.updated_at end as updated_at
  from diagnostic d
  left join candidate c on true;
$$;

revoke all on function public.login_user_by_entry_code(text, text) from public;
grant execute on function public.login_user_by_entry_code(text, text) to anon, authenticated;
