create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;

create table public.users (
  user_id text primary key, auth_user_id uuid, role text, is_active boolean default true, permissions jsonb default '{}'::jsonb
);
create function public.app_current_role() returns text language sql stable as $$
  select role from public.users where auth_user_id = auth.uid() and is_active limit 1
$$;
create function public.app_has_permission(flag text) returns boolean language sql stable as $$
  select coalesce((select lower(permissions->>flag) in ('yes','true','1') from public.users where auth_user_id = auth.uid() and is_active limit 1), false)
$$;

create table public.proposals_agreements (
  id uuid primary key, authority_id bigint, school_id bigint, contact_name text, contact_phone text,
  phone text, contact_email text, email text, proposal_domain text
);
create table public.proposal_agreement_items (
  id uuid primary key, proposal_agreement_id uuid, item_type text, activity_no text, gefen_number text,
  item_name text, meetings_count integer, total_price numeric, unit_price numeric
);
create table public.israa_program_tracking (
  id uuid primary key, proposal_agreement_id uuid, proposal_items jsonb default '[]', authority text,
  authority_id bigint, school_name text, school_id bigint, contact_person text, phone text, email text,
  updated_at timestamptz default now()
);
create table public.activities (
  row_id text primary key, activity_family text, activity_manager text, authority text, authority_id bigint,
  school text, school_id bigint, grade text, class_group text, activity_type text, item_type text,
  activity_no text, gefen_number text, activity_name text, program_name text, name text, title text,
  sessions text, price bigint, funding text, contact_name text, contact_phone text, contact_email text,
  emp_id bigint, instructor_name text, emp_id_2 bigint, instructor_name_2 text,
  start_date date, end_date date, date_1 date, start_time time, end_time time, notes text, status text,
  activity_season text, activity_domain text, proposal_agreement_id uuid, proposal_item_id uuid,
  updated_at timestamptz default now()
);
