-- Phase 1: unified instructor workspace and structured scheduling constraints.
-- Additive only: no existing activity or instructor data is changed.

create table if not exists public.instructor_scheduling_profiles (
  emp_id bigint primary key references public.contacts_instructors(emp_id) on delete cascade,
  default_start_time time without time zone not null default '08:00',
  default_end_time time without time zone not null default '15:00',
  friday_allowed boolean not null default false,
  notes text,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  constraint instructor_scheduling_profiles_time_check check (default_end_time > default_start_time)
);

create table if not exists public.instructor_availability_rules (
  id uuid primary key default gen_random_uuid(),
  emp_id bigint not null references public.contacts_instructors(emp_id) on delete cascade,
  weekday smallint not null constraint instructor_availability_rules_weekday_check check (weekday between 0 and 6),
  available boolean not null default true,
  start_time time without time zone,
  end_time time without time zone,
  notes text,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  constraint instructor_availability_rules_time_check check (
    (available = false and start_time is null and end_time is null)
    or
    (available = true and start_time is not null and end_time is not null and end_time > start_time)
  ),
  constraint instructor_availability_rules_unique_day unique (emp_id, weekday)
);

create table if not exists public.instructor_availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  emp_id bigint not null references public.contacts_instructors(emp_id) on delete cascade,
  exception_date date not null,
  available boolean not null default false,
  start_time time without time zone,
  end_time time without time zone,
  notes text,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  constraint instructor_availability_exceptions_time_check check (
    (available = false and start_time is null and end_time is null)
    or
    (available = true and start_time is not null and end_time is not null and end_time > start_time)
  ),
  constraint instructor_availability_exceptions_unique_date unique (emp_id, exception_date)
);

create index if not exists instructor_availability_rules_emp_id_idx
  on public.instructor_availability_rules(emp_id);
create index if not exists instructor_availability_exceptions_emp_date_idx
  on public.instructor_availability_exceptions(emp_id, exception_date);

alter table public.instructor_scheduling_profiles enable row level security;
alter table public.instructor_availability_rules enable row level security;
alter table public.instructor_availability_exceptions enable row level security;

grant select, insert, update, delete on table public.instructor_scheduling_profiles to authenticated;
grant select, insert, update, delete on table public.instructor_availability_rules to authenticated;
grant select, insert, update, delete on table public.instructor_availability_exceptions to authenticated;

-- Scheduling data is intentionally limited to the two roles approved for this workflow.
create policy instructor_scheduling_profiles_admin_operations
  on public.instructor_scheduling_profiles
  for all
  to authenticated
  using (public.app_current_role() = any (array['admin'::text, 'operation_manager'::text]))
  with check (public.app_current_role() = any (array['admin'::text, 'operation_manager'::text]));

create policy instructor_availability_rules_admin_operations
  on public.instructor_availability_rules
  for all
  to authenticated
  using (public.app_current_role() = any (array['admin'::text, 'operation_manager'::text]))
  with check (public.app_current_role() = any (array['admin'::text, 'operation_manager'::text]));

create policy instructor_availability_exceptions_admin_operations
  on public.instructor_availability_exceptions
  for all
  to authenticated
  using (public.app_current_role() = any (array['admin'::text, 'operation_manager'::text]))
  with check (public.app_current_role() = any (array['admin'::text, 'operation_manager'::text]));

comment on table public.instructor_scheduling_profiles is 'Default scheduling preferences and internal notes for instructors.';
comment on table public.instructor_availability_rules is 'Recurring weekly instructor availability; weekday 0=Sunday through 6=Saturday.';
comment on table public.instructor_availability_exceptions is 'Dated availability overrides and blocked dates for instructors.';
