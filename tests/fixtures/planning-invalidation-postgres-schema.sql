create schema auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid
$$;

create role authenticated;

create table public.users (
  auth_user_id uuid,
  role text,
  is_active boolean not null default true
);

create or replace function public.app_current_role() returns text language sql stable as $$
  select nullif(current_setting('test.role', true), '')
$$;

create or replace function public.app_has_permission(p_permission text) returns boolean
language sql stable as $$ select true $$;

create table public.activities (
  row_id text primary key,
  activity_season text,
  required_instructor_gender text,
  instruction_language text,
  start_date date,
  end_date date,
  start_time time,
  end_time time,
  sessions text,
  school text,
  school_id bigint,
  authority text,
  authority_id bigint,
  activity_name text,
  activity_no text,
  gefen_number text,
  status text,
  emp_id bigint,
  emp_id_2 bigint,
  instructor_name text,
  instructor_name_2 text,
  draft_emp_id text,
  instructor_assignment_locked boolean not null default false,
  updated_at timestamptz not null default now(),
  notes text,
  school_contact_id bigint,
  date_1 date, date_2 date, date_3 date, date_4 date, date_5 date,
  date_6 date, date_7 date, date_8 date, date_9 date, date_10 date,
  date_11 date, date_12 date, date_13 date, date_14 date, date_15 date,
  date_16 date, date_17 date, date_18 date, date_19 date, date_20 date,
  date_21 date, date_22 date, date_23 date, date_24 date, date_25 date,
  date_26 date, date_27 date, date_28 date, date_29 date, date_30 date,
  date_31 date, date_32 date, date_33 date, date_34 date, date_35 date
);

create table public.scheduling_planning_workspaces (
  id bigint generated always as identity primary key,
  period_key text not null default '2027',
  district text not null default 'north',
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table public.scheduling_planning_rows (
  workspace_id bigint references public.scheduling_planning_workspaces(id),
  activity_id text,
  row_data jsonb not null default '{}',
  locked_option jsonb,
  needs_recalc boolean not null default false,
  activity_updated_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.contacts_instructors (
  emp_id bigint primary key,
  full_name text,
  active text,
  address text
);

create table public.instructor_availability_exceptions (
  emp_id bigint,
  exception_date date,
  available boolean,
  start_time time,
  end_time time
);

create table public.instructor_availability_rules (
  emp_id bigint,
  weekday integer,
  available boolean,
  start_time time,
  end_time time
);

create table public.instructor_scheduling_profiles (
  emp_id bigint,
  gender text,
  instruction_languages text[],
  course_restriction_mode text,
  course_ids text[],
  blocked_authorities text[],
  blocked_schools text[]
);

create or replace function public.scheduling_lock_instructor_for_write(p_emp_id bigint)
returns void language sql as $$ select $$;
create or replace function public.school_calendar_sector_for_school_id(p_school_id bigint)
returns text language sql stable as $$ select 'jewish'::text $$;
create or replace function public.scheduling_course_instructor_violations(
  p_activity_id text, p_emp_id bigint, p_strict boolean, p_skip_dates date[]
) returns text[] language sql stable as $$ select array[]::text[] $$;
create or replace function public.scheduling_assert_assignment_calendar(
  p_activity_id text, p_emp_id bigint, p_meetings jsonb
) returns void language sql as $$ select $$;
create or replace function public.set_course_meeting_substitute(
  p_activity_id text, p_date date, p_emp_id bigint
) returns void language sql as $$ select $$;
create or replace function public.set_scheduling_planning_lock(
  p_period text, p_district text, p_activity_id text, p_value text, p_revision bigint
) returns void language sql as $$ select $$;
create or replace function public.assign_activity_instructor(
  p_activity_id text, p_emp_id bigint, p_name text, p_selected_emp_id bigint,
  p_selected_score integer, p_top_score integer, p_decision_type text, p_reason text
) returns public.activities language plpgsql as $$
declare v_result public.activities;
begin
  update public.activities a
  set emp_id = p_emp_id, instructor_name = p_name
  where a.row_id = p_activity_id
  returning a.* into v_result;
  return v_result;
end
$$;
