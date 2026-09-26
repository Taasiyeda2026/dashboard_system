create table if not exists public.instructor_training_schedule (
  id uuid primary key default gen_random_uuid(),
  emp_id bigint not null references public.contacts_instructors(emp_id) on update cascade on delete restrict,
  training_date date not null,
  activity_type text not null default 'הכשרה' check (btrim(activity_type) = 'הכשרה'),
  course_id uuid references public.proposal_gefen_courses(id) on delete set null,
  course_name text not null check (btrim(course_name) <> ''),
  start_time time without time zone not null,
  end_time time without time zone not null,
  is_online boolean not null default false,
  location_name text,
  location_address text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_by uuid default auth.uid(),
  constraint instructor_training_schedule_time_check check (end_time > start_time)
);

comment on table public.instructor_training_schedule is
  'Back-office source of truth for planned instructor training attendance. One row per instructor per training event; activity_type is always הכשרה and course_name is the course selected for the training.';

comment on column public.instructor_training_schedule.course_name is
  'Course/activity name used by the attendance training report. Mirrors the course selected when activity_type is הכשרה.';

create index if not exists instructor_training_schedule_emp_date_idx
  on public.instructor_training_schedule (emp_id, training_date);

create index if not exists instructor_training_schedule_date_idx
  on public.instructor_training_schedule (training_date)
  where is_active = true;

create unique index if not exists instructor_training_schedule_active_unique_idx
  on public.instructor_training_schedule (
    emp_id,
    training_date,
    lower(btrim(course_name)),
    start_time,
    end_time
  )
  where is_active = true;

create or replace function public.touch_instructor_training_schedule()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists instructor_training_schedule_touch on public.instructor_training_schedule;
create trigger instructor_training_schedule_touch
before update on public.instructor_training_schedule
for each row execute function public.touch_instructor_training_schedule();

alter table public.instructor_training_schedule enable row level security;

grant select, insert, update, delete on public.instructor_training_schedule to authenticated;

drop policy if exists instructor_training_schedule_read on public.instructor_training_schedule;
create policy instructor_training_schedule_read
on public.instructor_training_schedule
for select
to authenticated
using (
  public.app_current_role() = any (
    array['admin','operation_manager','activities_manager','instructor_manager','finance']::text[]
  )
);

drop policy if exists instructor_training_schedule_write on public.instructor_training_schedule;
create policy instructor_training_schedule_write
on public.instructor_training_schedule
for all
to authenticated
using (
  public.app_current_role() = any (
    array['admin','operation_manager','activities_manager','instructor_manager']::text[]
  )
)
with check (
  public.app_current_role() = any (
    array['admin','operation_manager','activities_manager','instructor_manager']::text[]
  )
);
