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
