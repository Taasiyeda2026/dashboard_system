-- ============================================================
-- Combined migration section from: 20260506_activities_single_source_cleanup.sql
-- Original migration version prefix: 20260506
-- ============================================================

-- Enforce public.activities as the single client-facing activities source.
-- Legacy activity/read-model tables may exist historically, but app roles should not
-- read or write them after activities_system_ready.csv is loaded into public.activities.

insert into public.settings(key, value, description)
values
  ('sheet_activities', 'activities', 'Supabase source for activities'),
  ('available_sheets', '["activities","contacts_instructors","contacts_schools","lists","edit_requests","operations_private_notes","users","settings"]', 'Available datasets for admin mapping')
on conflict (key) do update set
  value = excluded.value,
  description = excluded.description;

do $$
declare
  legacy_table text;
begin
  foreach legacy_table in array array['data_long', 'data_short', 'activity_meetings', 'dashboard_monthly_read_models'] loop
    if to_regclass(format('public.%I', legacy_table)) is not null then
      execute format('revoke all privileges on table public.%I from anon, authenticated', legacy_table);
    end if;
  end loop;
end $$;


-- ============================================================
-- Combined migration section from: 20260506_create_public_activities.sql
-- Original migration version prefix: 20260506
-- ============================================================

-- Supabase-only activities source of truth.
-- The frontend reads and writes public.activities only for activity data.
-- Existing legacy tables are intentionally left in place for historical rollback/audit,
-- but this migration does not grant new usage to them.

create table if not exists public.activities (
  row_id text primary key,
  activity_family text,
  activity_manager text,
  authority text,
  school text,
  grade text,
  class_group text,
  activity_type text,
  activity_no text,
  activity_name text,
  sessions text,
  price text,
  funding text,
  start_time text,
  end_time text,
  emp_id text,
  instructor_name text,
  emp_id_2 text,
  instructor_name_2 text,
  start_date text,
  end_date text,
  date_1 text,
  date_2 text,
  date_3 text,
  date_4 text,
  date_5 text,
  date_6 text,
  date_7 text,
  date_8 text,
  date_9 text,
  date_10 text,
  date_11 text,
  date_12 text,
  date_13 text,
  date_14 text,
  date_15 text,
  date_16 text,
  date_17 text,
  date_18 text,
  date_19 text,
  date_20 text,
  date_21 text,
  date_22 text,
  date_23 text,
  date_24 text,
  date_25 text,
  date_26 text,
  date_27 text,
  date_28 text,
  date_29 text,
  date_30 text,
  date_31 text,
  date_32 text,
  date_33 text,
  date_34 text,
  date_35 text,
  status text,
  notes text,
  finance_status text,
  finance_notes text,
  operations_private_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint activities_activity_family_check check (activity_family is null or activity_family in ('one_day', 'program')),
  constraint activities_start_date_format_check check (start_date is null or start_date = '' or start_date ~ '^\d{4}-\d{2}-\d{2}$'),
  constraint activities_end_date_format_check check (end_date is null or end_date = '' or end_date ~ '^\d{4}-\d{2}-\d{2}$'),
  constraint activities_start_time_format_check check (start_time is null or start_time = '' or start_time ~ '^\d{2}:\d{2}$'),
  constraint activities_end_time_format_check check (end_time is null or end_time = '' or end_time ~ '^\d{2}:\d{2}$')
);

-- Add missing columns idempotently for projects where public.activities already exists.
alter table public.activities add column if not exists row_id text;
alter table public.activities add column if not exists activity_family text;
alter table public.activities add column if not exists activity_manager text;
alter table public.activities add column if not exists authority text;
alter table public.activities add column if not exists school text;
alter table public.activities add column if not exists grade text;
alter table public.activities add column if not exists class_group text;
alter table public.activities add column if not exists activity_type text;
alter table public.activities add column if not exists activity_no text;
alter table public.activities add column if not exists activity_name text;
alter table public.activities add column if not exists sessions text;
alter table public.activities add column if not exists price text;
alter table public.activities add column if not exists funding text;
alter table public.activities add column if not exists start_time text;
alter table public.activities add column if not exists end_time text;
alter table public.activities add column if not exists emp_id text;
alter table public.activities add column if not exists instructor_name text;
alter table public.activities add column if not exists emp_id_2 text;
alter table public.activities add column if not exists instructor_name_2 text;
alter table public.activities add column if not exists start_date text;
alter table public.activities add column if not exists end_date text;
do $$
begin
  for i in 1..35 loop
    execute format('alter table public.activities add column if not exists date_%s text', i);
  end loop;
end $$;
alter table public.activities add column if not exists status text;
alter table public.activities add column if not exists notes text;
alter table public.activities add column if not exists finance_status text;
alter table public.activities add column if not exists finance_notes text;
alter table public.activities add column if not exists operations_private_notes text;
alter table public.activities add column if not exists created_at timestamptz not null default now();
alter table public.activities add column if not exists updated_at timestamptz not null default now();


do $$
begin
  if exists (select 1 from public.activities where row_id is null or btrim(row_id) = '') then
    raise exception 'public.activities.row_id must be populated before enforcing the primary key';
  end if;

  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'activities'
      and c.contype = 'p'
  ) then
    alter table public.activities alter column row_id set not null;
    alter table public.activities add constraint activities_pkey primary key (row_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_index i
    join pg_class t on t.oid = i.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_attribute a on a.attrelid = t.oid and a.attnum = any(i.indkey)
    where n.nspname = 'public'
      and t.relname = 'activities'
      and i.indisunique
      and array_length(i.indkey, 1) = 1
      and a.attname = 'row_id'
  ) then
    alter table public.activities add constraint activities_row_id_key unique (row_id);
  end if;
end $$;

create index if not exists activities_status_idx on public.activities (status);
create index if not exists activities_activity_family_idx on public.activities (activity_family);
create index if not exists activities_end_date_idx on public.activities (end_date);
create index if not exists activities_emp_id_idx on public.activities (emp_id);
create index if not exists activities_emp_id_2_idx on public.activities (emp_id_2);

create or replace function public.set_activities_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_activities_updated_at on public.activities;
create trigger set_activities_updated_at
before update on public.activities
for each row execute function public.set_activities_updated_at();

alter table public.activities enable row level security;

drop policy if exists activities_select_public on public.activities;
create policy activities_select_public
on public.activities
for select
to anon, authenticated
using (true);

-- Keep the same browser-write stance used by the current Supabase client: authenticated
-- application users may edit activities through RLS, while anon can only read.
drop policy if exists activities_write_authenticated on public.activities;
create policy activities_write_authenticated
on public.activities
for all
to authenticated
using (true)
with check (true);

grant select on public.activities to anon, authenticated;
grant insert, update, delete on public.activities to authenticated;
revoke insert, update, delete on public.activities from anon;


-- ============================================================
-- Combined migration section from: 20260506_lock_down_client_rls_and_dashboard_source.sql
-- Original migration version prefix: 20260506
-- ============================================================

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
DO $$
BEGIN
  IF to_regclass('public.data_long') IS NOT NULL THEN
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON public.data_long FROM anon';
    RAISE NOTICE 'Revoked anon writes on public.data_long';
  ELSE
    RAISE NOTICE 'Table public.data_long does not exist — skipped anon write revoke';
  END IF;

  IF to_regclass('public.data_short') IS NOT NULL THEN
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON public.data_short FROM anon';
    RAISE NOTICE 'Revoked anon writes on public.data_short';
  ELSE
    RAISE NOTICE 'Table public.data_short does not exist — skipped anon write revoke';
  END IF;
END $$;

revoke insert, update, delete on public.users from anon;
revoke insert, update, delete on public.settings from anon;

-- Keep browser reads explicit. entry_code is intentionally excluded from users column grants.
revoke all on public.users from anon, authenticated;
grant select (user_id, email, name, role, emp_id, is_active, permissions, created_at, updated_at)
on public.users to anon, authenticated;

revoke all on public.settings from anon, authenticated;
grant select on public.settings to anon, authenticated;

-- Legacy data tables are optional. If present, they are readable by the client screens but not writable.
DO $$
BEGIN
  IF to_regclass('public.data_long') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT ON public.data_long TO anon, authenticated';
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON public.data_long FROM authenticated';
    RAISE NOTICE 'Applied read-only client grants on public.data_long';
  ELSE
    RAISE NOTICE 'Table public.data_long does not exist — skipped client grants';
  END IF;

  IF to_regclass('public.data_short') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT ON public.data_short TO anon, authenticated';
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON public.data_short FROM authenticated';
    RAISE NOTICE 'Applied read-only client grants on public.data_short';
  ELSE
    RAISE NOTICE 'Table public.data_short does not exist — skipped client grants';
  END IF;
END $$;

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
  status text,
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
        when (select i.login from input i) = '' or (select i.code from input i) = '' then 'missing_user_id_or_entry_code'
        when not exists (select 1 from candidate) then 'user_not_found'
        when not (select c.is_active from candidate c) then 'inactive_user'
        when trim(coalesce((select c.entry_code from candidate c), '')) <> (select i.code from input i) then 'entry_code_mismatch'
        when coalesce((select c.role from candidate c), '') not in ('admin', 'operation_manager', 'authorized_user', 'instructor') then 'invalid_role'
        else 'ok'
      end as status
  )
  select
    d.status,
    case when d.status = 'ok' then c.user_id end as user_id,
    case when d.status = 'ok' then c.email end as email,
    case when d.status = 'ok' then c.name end as name,
    case when d.status = 'ok' then c.role end as role,
    case when d.status = 'ok' then c.emp_id end as emp_id,
    case when d.status = 'ok' then c.is_active end as is_active,
    case when d.status = 'ok' then c.permissions end as permissions,
    case when d.status = 'ok' then c.created_at end as created_at,
    case when d.status = 'ok' then c.updated_at end as updated_at
  from diagnostic d
  left join candidate c on true;
$$;

revoke all on function public.login_user_by_entry_code(text, text) from public;
grant execute on function public.login_user_by_entry_code(text, text) to anon, authenticated;
