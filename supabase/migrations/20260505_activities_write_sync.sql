-- ============================================================
-- Combined migration section from: 20260505_activities_write_sync.sql
-- Original migration version prefix: 20260505
-- ============================================================

-- ============================================================
-- Migration: Activities write-sync tables + UNIQUE constraints
-- Supabase project: szinlhjuwyiyszdpsdop
--
-- Tables created (if not exist):
--   activity_meetings        — meeting dates per long-program row
--   edit_requests            — edit-request workflow records
--   operations_private_notes — private notes per activity row
--
-- UNIQUE constraints added safely:
--   data_long(RowID)                      — only if table exists
--   data_short(RowID)                     — only if table exists
--   activity_meetings(source_row_id, meeting_no)
--   edit_requests(request_id)
--   operations_private_notes(source_sheet, source_row_id)
--
-- Safe for Supabase Preview:
--   If legacy tables data_long / data_short do not exist, their UNIQUE blocks are skipped.
--
-- All blocks are idempotent — safe to re-run.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. activity_meetings
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.activity_meetings (
  id              bigserial PRIMARY KEY,
  source_row_id   text NOT NULL,
  meeting_no      text NOT NULL,
  meeting_date    text,
  notes           text,
  active          text DEFAULT 'yes',
  created_at      timestamptz DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'activity_meetings'
      AND i.indisunique
      AND array_length(i.indkey, 1) = 2
      AND EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = t.oid
          AND a.attnum = ANY(i.indkey)
          AND a.attname = 'source_row_id'
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = t.oid
          AND a.attnum = ANY(i.indkey)
          AND a.attname = 'meeting_no'
      )
  ) THEN
    ALTER TABLE public.activity_meetings
      ADD CONSTRAINT activity_meetings_source_row_id_meeting_no_key
        UNIQUE (source_row_id, meeting_no);

    RAISE NOTICE 'Created UNIQUE(source_row_id, meeting_no) on activity_meetings';
  ELSE
    RAISE NOTICE 'UNIQUE(source_row_id, meeting_no) on activity_meetings already exists — skipped';
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────
-- 2. edit_requests
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.edit_requests (
  id                    bigserial PRIMARY KEY,
  request_id            text NOT NULL,
  source_sheet          text,
  source_row_id         text,
  activity_name         text,
  school                text,
  authority             text,
  requested_by_user_id  text,
  requested_by_name     text,
  requested_at          text,
  status                text DEFAULT 'pending',
  changed_fields        text,
  original_values       text,
  requested_values      text,
  reviewer_user_id      text,
  reviewed_by           text,
  reviewed_at           text,
  review_note           text,
  reviewer_notes        text,
  active                text DEFAULT 'yes',
  created_at            timestamptz DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(i.indkey)
    WHERE n.nspname = 'public'
      AND t.relname = 'edit_requests'
      AND i.indisunique
      AND array_length(i.indkey, 1) = 1
      AND a.attname = 'request_id'
  ) THEN
    ALTER TABLE public.edit_requests
      ADD CONSTRAINT edit_requests_request_id_key UNIQUE (request_id);

    RAISE NOTICE 'Created UNIQUE(request_id) on edit_requests';
  ELSE
    RAISE NOTICE 'UNIQUE(request_id) on edit_requests already exists — skipped';
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────
-- 3. operations_private_notes
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.operations_private_notes (
  id              bigserial PRIMARY KEY,
  source_sheet    text NOT NULL,
  source_row_id   text NOT NULL,
  note_text       text,
  updated_at      text,
  updated_by      text,
  active          text DEFAULT 'yes',
  created_at      timestamptz DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'operations_private_notes'
      AND i.indisunique
      AND array_length(i.indkey, 1) = 2
      AND EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = t.oid
          AND a.attnum = ANY(i.indkey)
          AND a.attname = 'source_sheet'
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = t.oid
          AND a.attnum = ANY(i.indkey)
          AND a.attname = 'source_row_id'
      )
  ) THEN
    ALTER TABLE public.operations_private_notes
      ADD CONSTRAINT operations_private_notes_source_sheet_source_row_id_key
        UNIQUE (source_sheet, source_row_id);

    RAISE NOTICE 'Created UNIQUE(source_sheet, source_row_id) on operations_private_notes';
  ELSE
    RAISE NOTICE 'UNIQUE(source_sheet, source_row_id) on operations_private_notes already exists — skipped';
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────
-- 4. UNIQUE(RowID) on data_long
-- Legacy table. Skip safely if the table does not exist.
-- ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.data_long') IS NULL THEN
    RAISE NOTICE 'Table public.data_long does not exist — skipped UNIQUE(RowID)';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(i.indkey)
    WHERE n.nspname = 'public'
      AND t.relname = 'data_long'
      AND i.indisunique
      AND array_length(i.indkey, 1) = 1
      AND a.attname = 'RowID'
  ) THEN
    EXECUTE 'ALTER TABLE public.data_long ADD CONSTRAINT data_long_rowid_key UNIQUE ("RowID")';

    RAISE NOTICE 'Created UNIQUE(RowID) on data_long';
  ELSE
    RAISE NOTICE 'UNIQUE(RowID) on data_long already exists — skipped';
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────
-- 5. UNIQUE(RowID) on data_short
-- Legacy table. Skip safely if the table does not exist.
-- ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.data_short') IS NULL THEN
    RAISE NOTICE 'Table public.data_short does not exist — skipped UNIQUE(RowID)';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(i.indkey)
    WHERE n.nspname = 'public'
      AND t.relname = 'data_short'
      AND i.indisunique
      AND array_length(i.indkey, 1) = 1
      AND a.attname = 'RowID'
  ) THEN
    EXECUTE 'ALTER TABLE public.data_short ADD CONSTRAINT data_short_rowid_key UNIQUE ("RowID")';

    RAISE NOTICE 'Created UNIQUE(RowID) on data_short';
  ELSE
    RAISE NOTICE 'UNIQUE(RowID) on data_short already exists — skipped';
  END IF;
END $$;


-- ============================================================
-- Combined migration section from: 20260505_add_unique_constraints_contacts.sql
-- Original migration version prefix: 20260505
-- ============================================================

-- Migration: Add UNIQUE constraints required for contacts upsert
-- Supabase project: szinlhjuwyiyszdpsdop
--
-- The app uses upsert with onConflict on these columns:
--   contacts_instructors  → emp_id
--   contacts_schools      → (authority, school, contact_name)
--
-- Without these constraints every save inserts a new row instead of updating.
--
-- ────────────────────────────────────────────────────────────────────────────
-- BEFORE RUNNING: check for existing duplicates (queries below).
-- If duplicates are found, resolve them first or the ALTER TABLE will fail.
-- ────────────────────────────────────────────────────────────────────────────

-- Step 0 — preflight: detect duplicates (run these SELECTs first, read-only)

-- 0a. Duplicates in contacts_instructors on emp_id
SELECT emp_id, COUNT(*) AS cnt
FROM   public.contacts_instructors
GROUP  BY emp_id
HAVING COUNT(*) > 1
ORDER  BY cnt DESC;

-- 0b. Duplicates in contacts_schools on (authority, school, contact_name)
SELECT authority, school, contact_name, COUNT(*) AS cnt
FROM   public.contacts_schools
GROUP  BY authority, school, contact_name
HAVING COUNT(*) > 1
ORDER  BY cnt DESC;

-- If either query returns rows, de-duplicate before proceeding.
-- Suggested cleanup (keep the row with the highest id / latest ctid):
--
--   DELETE FROM public.contacts_instructors
--   WHERE  id NOT IN (
--     SELECT MAX(id) FROM public.contacts_instructors GROUP BY emp_id
--   );
--
--   DELETE FROM public.contacts_schools
--   WHERE  id NOT IN (
--     SELECT MAX(id) FROM public.contacts_schools
--     GROUP  BY authority, school, contact_name
--   );
--
-- Adjust the id column name to match the actual PK column if it differs.

-- ────────────────────────────────────────────────────────────────────────────
-- Step 1 — contacts_instructors: UNIQUE on emp_id
-- ────────────────────────────────────────────────────────────────────────────
-- Idempotency: skips if ANY unique constraint/index already covers emp_id alone,
-- regardless of the constraint name.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM   pg_index     i
    JOIN   pg_class     t ON t.oid = i.indrelid
    JOIN   pg_namespace n ON n.oid = t.relnamespace
    JOIN   pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(i.indkey)
    WHERE  n.nspname   = 'public'
      AND  t.relname   = 'contacts_instructors'
      AND  i.indisunique
      AND  a.attname   = 'emp_id'
      AND  array_length(i.indkey, 1) = 1   -- exactly one column in the index
  ) THEN
    RAISE NOTICE 'UNIQUE index on contacts_instructors(emp_id) already exists — skipped';
  ELSE
    ALTER TABLE public.contacts_instructors
      ADD CONSTRAINT contacts_instructors_emp_id_key UNIQUE (emp_id);
    RAISE NOTICE 'Created UNIQUE(emp_id) on contacts_instructors';
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- Step 2 — contacts_schools: UNIQUE on (authority, school, contact_name)
-- ────────────────────────────────────────────────────────────────────────────
-- Idempotency: skips if ANY unique index already covers exactly these three
-- columns (in any order), regardless of the constraint/index name.
DO $$
DECLARE
  v_col_ids   int2[];
  v_auth_id   int2;
  v_school_id int2;
  v_cname_id  int2;
BEGIN
  SELECT a.attnum INTO v_auth_id
  FROM   pg_attribute a
  JOIN   pg_class     t ON t.oid = a.attrelid
  JOIN   pg_namespace n ON n.oid = t.relnamespace
  WHERE  n.nspname = 'public' AND t.relname = 'contacts_schools'
    AND  a.attname = 'authority';

  SELECT a.attnum INTO v_school_id
  FROM   pg_attribute a
  JOIN   pg_class     t ON t.oid = a.attrelid
  JOIN   pg_namespace n ON n.oid = t.relnamespace
  WHERE  n.nspname = 'public' AND t.relname = 'contacts_schools'
    AND  a.attname = 'school';

  SELECT a.attnum INTO v_cname_id
  FROM   pg_attribute a
  JOIN   pg_class     t ON t.oid = a.attrelid
  JOIN   pg_namespace n ON n.oid = t.relnamespace
  WHERE  n.nspname = 'public' AND t.relname = 'contacts_schools'
    AND  a.attname = 'contact_name';

  IF v_auth_id IS NULL OR v_school_id IS NULL OR v_cname_id IS NULL THEN
    RAISE EXCEPTION 'contacts_schools is missing one of: authority, school, contact_name';
  END IF;

  v_col_ids := ARRAY[v_auth_id, v_school_id, v_cname_id];

  IF EXISTS (
    SELECT 1
    FROM   pg_index     i
    JOIN   pg_class     t ON t.oid = i.indrelid
    JOIN   pg_namespace n ON n.oid = t.relnamespace
    WHERE  n.nspname   = 'public'
      AND  t.relname   = 'contacts_schools'
      AND  i.indisunique
      AND  array_length(i.indkey, 1) = 3
      AND  (i.indkey::int2[] @> v_col_ids AND v_col_ids @> i.indkey::int2[])
  ) THEN
    RAISE NOTICE 'UNIQUE index on contacts_schools(authority,school,contact_name) already exists — skipped';
  ELSE
    ALTER TABLE public.contacts_schools
      ADD CONSTRAINT contacts_schools_authority_school_contact_name_key
        UNIQUE (authority, school, contact_name);
    RAISE NOTICE 'Created UNIQUE(authority,school,contact_name) on contacts_schools';
  END IF;
END $$;


-- ============================================================
-- Combined migration section from: 20260505_grant_anon_all_tables.sql
-- Original migration version prefix: 20260505
-- ============================================================

-- Migration: Grant anon/authenticated access to all app tables
-- Required in addition to RLS policies — table-level GRANT must exist
-- for Supabase to allow the anon role to reach the RLS check at all.
-- Safe to re-run (idempotent).

DO $$
BEGIN
  IF to_regclass('public.data_long') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.data_long TO anon, authenticated';
    RAISE NOTICE 'Granted access on public.data_long';
  ELSE
    RAISE NOTICE 'Table public.data_long does not exist — skipped grants';
  END IF;

  IF to_regclass('public.data_short') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.data_short TO anon, authenticated';
    RAISE NOTICE 'Granted access on public.data_short';
  ELSE
    RAISE NOTICE 'Table public.data_short does not exist — skipped grants';
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.activity_meetings      TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts_instructors   TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts_schools       TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lists                  TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.edit_requests          TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.operations_private_notes TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.users                  TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.settings               TO anon, authenticated;


-- ============================================================
-- Combined migration section from: 20260505_settings_admin_config.sql
-- Original migration version prefix: 20260505
-- ============================================================

create table if not exists public.settings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  value text not null default '',
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_settings_updated_at on public.settings;
create trigger trg_touch_settings_updated_at
before update on public.settings
for each row
execute function public.touch_settings_updated_at();

alter table public.settings enable row level security;

drop policy if exists settings_select_all on public.settings;
create policy settings_select_all
on public.settings
for select
to anon, authenticated
using (true);

drop policy if exists settings_insert_all on public.settings;
create policy settings_insert_all
on public.settings
for insert
to anon, authenticated
with check (true);

drop policy if exists settings_update_all on public.settings;
create policy settings_update_all
on public.settings
for update
to anon, authenticated
using (true)
with check (true);

grant select, insert, update, delete on public.settings to anon, authenticated;

insert into public.settings(key, value, description)
values
  ('sheet_activities', 'activities', 'Supabase source for activities'),
  ('available_sheets', '["activities","contacts_instructors","contacts_schools","lists","edit_requests","operations_private_notes","users","settings"]', 'Available datasets for admin mapping')
on conflict (key) do update set
  value = excluded.value,
  description = excluded.description;


-- ============================================================
-- Combined migration section from: 20260505_users_auth_bootstrap.sql
-- Original migration version prefix: 20260505
-- ============================================================

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
