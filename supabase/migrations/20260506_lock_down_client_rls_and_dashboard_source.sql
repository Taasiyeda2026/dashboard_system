-- Migration: lock down client-facing RLS/grants and define a Supabase dashboard source table.
-- The anon key may read only the public data needed by the app. Writes must be performed
-- by a trusted backend/service-role process, not directly from the browser.

-- A Supabase-only dashboard should be populated from the same fixed dashboard sheet/read-model
-- contract by a backend sync job. The frontend may read this table by month; it must not
-- synthesize KPI=0 payloads when this source is missing or unreadable.
create table if not exists public.dashboard_monthly_read_models (
  month text primary key check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  payload jsonb not null,
  source text not null default 'dashboard_sheet',
  updated_at timestamptz not null default now()
);

alter table public.dashboard_monthly_read_models enable row level security;

drop policy if exists dashboard_monthly_read_models_select_public on public.dashboard_monthly_read_models;
create policy dashboard_monthly_read_models_select_public
on public.dashboard_monthly_read_models
for select
to anon, authenticated
using (true);

drop policy if exists dashboard_monthly_read_models_insert_public on public.dashboard_monthly_read_models;
drop policy if exists dashboard_monthly_read_models_update_public on public.dashboard_monthly_read_models;
drop policy if exists dashboard_monthly_read_models_delete_public on public.dashboard_monthly_read_models;

grant select on public.dashboard_monthly_read_models to anon, authenticated;
revoke insert, update, delete on public.dashboard_monthly_read_models from anon, authenticated;

-- Undo the broad anon write grants from 20260505_grant_anon_all_tables.sql for sensitive/core data.
revoke insert, update, delete on public.data_long from anon;
revoke insert, update, delete on public.data_short from anon;
revoke insert, update, delete on public.users from anon;
revoke insert, update, delete on public.settings from anon;

-- Keep browser reads explicit. entry_code is intentionally excluded from users column grants.
revoke all on public.users from anon, authenticated;
grant select (user_id, email, name, role, emp_id, is_active, permissions, created_at, updated_at)
on public.users to anon, authenticated;

revoke all on public.settings from anon, authenticated;
grant select on public.settings to anon, authenticated;

-- Data tables are readable by the client screens but not writable with the anon key.
grant select on public.data_long to anon, authenticated;
grant select on public.data_short to anon, authenticated;
revoke insert, update, delete on public.data_long from authenticated;
revoke insert, update, delete on public.data_short from authenticated;

-- Replace permissive users write policies with read-only public access to active users.
drop policy if exists users_insert_all on public.users;
drop policy if exists users_update_all on public.users;
drop policy if exists users_delete_all on public.users;
drop policy if exists users_select_active on public.users;
create policy users_select_active_public_safe
on public.users
for select
to anon, authenticated
using (is_active = true);

-- Replace permissive settings write policies with read-only public access.
drop policy if exists settings_insert_all on public.settings;
drop policy if exists settings_update_all on public.settings;
drop policy if exists settings_delete_all on public.settings;
drop policy if exists settings_select_all on public.settings;
create policy settings_select_public
on public.settings
for select
to anon, authenticated
using (true);

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
