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
