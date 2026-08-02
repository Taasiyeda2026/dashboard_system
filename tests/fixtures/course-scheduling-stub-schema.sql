-- Minimal stand-in for the parts of the production schema that
-- supabase/migrations/20260802220000_course_scheduling_interface_schema.sql and
-- supabase/migrations/20260802221000_course_scheduling_interface_rpcs.sql depend on but do
-- not themselves create (contacts_instructors, users, app_current_role(), auth.uid(), the
-- travel/address resolver functions...). Used only by opt-in integration tests that run
-- the real migration files against a throwaway Postgres database — never applied to a real
-- environment. test.role/test.uid are settable per-connection to stand in for Supabase auth.
create extension if not exists pgcrypto;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid
$$;
create or replace function public.app_current_role() returns text language sql stable as $$
  select nullif(current_setting('test.role', true), '')
$$;

create table public.users (
  auth_user_id uuid,
  role text,
  is_active boolean,
  emp_id text
);

create table public.contacts_instructors (
  emp_id bigint primary key,
  full_name text,
  active text,
  address text
);

create table public.instructor_scheduling_profiles (
  emp_id bigint primary key,
  gender text,
  instruction_languages text[] not null default array['he']::text[],
  education_levels text[] not null default array['elementary','middle_school','high_school']::text[],
  course_restriction_mode text not null default 'all',
  course_ids text[] not null default '{}',
  blocked_authorities text[] not null default '{}',
  blocked_schools text[] not null default '{}',
  friday_allowed boolean not null default false,
  default_start_time time,
  default_end_time time,
  weekly_target_hours numeric,
  weekly_max_hours numeric,
  preferred_work_days integer,
  max_fixed_courses integer
);

create table public.instructor_availability_rules (
  emp_id bigint,
  weekday integer,
  available boolean,
  start_time time,
  end_time time
);

create table public.instructor_availability_exceptions (
  emp_id bigint,
  exception_date date,
  available boolean,
  start_time time,
  end_time time
);

create table public.contacts_schools (
  id bigint primary key,
  school_id bigint,
  school text,
  authority_id bigint,
  authority text,
  address text
);

create table public.schools (
  id bigint primary key,
  institution_address text,
  mailing_address text,
  city text,
  house_number text,
  school_name text,
  authority text
);

create table public.activities (
  row_id text primary key,
  activity_season text,
  activity_type text,
  status text,
  start_time time,
  end_time time,
  start_date date,
  end_date date,
  date_1 text, date_2 text, date_3 text, date_4 text, date_5 text,
  date_6 text, date_7 text, date_8 text, date_9 text, date_10 text,
  date_11 text, date_12 text, date_13 text, date_14 text, date_15 text,
  date_16 text, date_17 text, date_18 text, date_19 text, date_20 text,
  date_21 text, date_22 text, date_23 text, date_24 text, date_25 text,
  date_26 text, date_27 text, date_28 text, date_29 text, date_30 text,
  date_31 text, date_32 text, date_33 text, date_34 text, date_35 text,
  emp_id bigint,
  emp_id_2 bigint,
  instructor_name text,
  instructor_name_2 text,
  school text,
  school_id bigint,
  authority text,
  authority_id bigint,
  instruction_language text,
  required_instructor_gender text,
  education_level text,
  grade text,
  activity_no text,
  activity_name text,
  blocked_instructor_ids text[] not null default '{}',
  allowed_instructor_ids text[] not null default '{}',
  scheduling_note text,
  instructor_assignment_locked boolean not null default false,
  instructor_assignment_status text
);

create table public.instructor_assignment_audit (
  id uuid primary key default gen_random_uuid(),
  activity_id text not null,
  selected_emp_id text not null,
  selected_instructor_name text not null,
  top_recommended_emp_id text,
  selected_score integer,
  top_score integer,
  decision_type text not null,
  reason text,
  selected_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  previous_status text,
  new_status text
);

create table public.scheduling_travel_cache (
  origin_key text not null,
  destination_key text not null,
  distance_km numeric,
  duration_minutes integer,
  provider text not null default 'google',
  calculated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  primary key (origin_key, destination_key)
);

create table public.activity_completion_approval_uploads (
  id uuid primary key default gen_random_uuid(),
  activity_row_id text,
  activity_date date,
  instructor_emp_id text not null,
  status text not null default 'uploaded'
);

-- Verbatim from supabase/migrations/20260730170000_course_scheduling_post_edit_revalidation.sql
create or replace function public.scheduling_school_location(
  p_school_id bigint,
  p_school text,
  p_authority_id bigint,
  p_authority text
) returns text
language sql
stable
security definer
set search_path=public
as $$
  select coalesce(
    nullif((
      select btrim(cs.address)
      from public.contacts_schools cs
      where nullif(btrim(cs.address), '') is not null
        and p_school_id is not null
        and cs.school_id = p_school_id
      order by cs.id desc
      limit 1
    ), ''),
    nullif((
      select btrim(coalesce(nullif(s.institution_address, ''), nullif(s.mailing_address, ''), nullif(s.city, '')))
      from public.schools s
      where p_school_id is not null and s.id = p_school_id
      limit 1
    ), ''),
    nullif((
      select btrim(cs.address)
      from public.contacts_schools cs
      where nullif(btrim(cs.address), '') is not null
        and lower(btrim(coalesce(cs.school, ''))) = lower(btrim(coalesce(p_school, '')))
        and (
          (p_authority_id is not null and cs.authority_id = p_authority_id)
          or lower(btrim(coalesce(cs.authority, ''))) = lower(btrim(coalesce(p_authority, '')))
        )
      order by cs.id desc
      limit 1
    ), ''),
    nullif(concat_ws(', ', nullif(btrim(p_school), ''), nullif(btrim(p_authority), '')), '')
  )
$$;

-- Verbatim from supabase/migrations/20260730160000_course_scheduling_execution_hardening.sql
create or replace function public.scheduling_normalize_location(p_value text)
returns text
language sql
immutable
set search_path=public
as $$
  select lower(regexp_replace(btrim(coalesce(p_value, '')), E'\\s+', ' ', 'g'))
$$;

create or replace function public.scheduling_cached_travel_minutes(p_origin text, p_destination text)
returns integer
language sql
stable
security definer
set search_path=public
as $$
  select stc.duration_minutes
  from public.scheduling_travel_cache stc
  where stc.origin_key = public.scheduling_normalize_location(p_origin)
    and stc.destination_key = public.scheduling_normalize_location(p_destination)
    and stc.expires_at > now()
  order by stc.calculated_at desc
  limit 1
$$;

create or replace function public.scheduling_education_level(p_education_level text, p_grade text)
returns text
language plpgsql
immutable
set search_path=public
as $$
declare
  value text := lower(btrim(coalesce(p_education_level, '')));
  grade_value text := lower(btrim(coalesce(p_grade, '')));
begin
  if value <> '' then return value; end if;
  if grade_value ~ '^(א|ב|ג|ד|ה|ו|1|2|3|4|5|6)$' then return 'elementary'; end if;
  if grade_value ~ '^(ז|ח|ט|7|8|9)$' then return 'middle_school'; end if;
  if grade_value ~ '^(י|יא|יב|10|11|12)$' then return 'high_school'; end if;
  return '';
end
$$;
