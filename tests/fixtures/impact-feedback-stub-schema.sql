-- Minimal stand-in for the production tables the impact feedback module references.
-- Column names/types mirror production (activities dates/emp_id are text there).
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub',
    nullif(current_setting('test.uid', true), '')
  ), '')::uuid
$$;

do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create table public.users (
  user_id text primary key,
  auth_user_id uuid,
  role text,
  is_active boolean default true,
  permissions jsonb default '{}'::jsonb
);

create table public.contacts_schools (
  id bigserial primary key,
  school_id bigint,
  authority text,
  school text,
  contact_name text,
  contact_role text,
  phone text,
  mobile text,
  email text,
  active text
);

create table public.contacts_instructors (
  emp_id bigint primary key,
  full_name text,
  mobile text,
  email text,
  active text
);

create table public.activities (
  row_id text primary key,
  activity_season text,
  activity_family text,
  activity_manager text,
  activity_type text,
  activity_name text,
  gefen_number text,
  authority text,
  authority_id bigint,
  school text,
  school_id bigint,
  grade text,
  class_group text,
  emp_id text,
  instructor_name text,
  start_date text,
  end_date text,
  status text,
  school_contact_id bigint references public.contacts_schools(id) on delete set null,
  contact_name text,
  contact_phone text,
  contact_email text
);
alter table public.activities enable row level security;
