-- Open role-specific lesson-learned questions for the manager and
-- interface feedback questions for selected employees.

create table if not exists public.manager_review_role_lessons (
  review_id uuid primary key references public.annual_reviews(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint manager_review_role_lessons_answers_object
    check (jsonb_typeof(answers) = 'object')
);

create table if not exists public.employee_review_interface_feedback (
  review_id uuid primary key references public.annual_reviews(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_review_interface_feedback_answers_object
    check (jsonb_typeof(answers) = 'object')
);

alter table public.manager_review_role_lessons enable row level security;
alter table public.employee_review_interface_feedback enable row level security;

create or replace function public.guard_manager_review_role_lessons()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if not public.annual_review_manager_can_prepare(coalesce(new.review_id, old.review_id)) then
    raise exception 'annual_review_manager_role_lessons_wrong_stage';
  end if;
  if tg_op = 'UPDATE' and new.review_id <> old.review_id then
    raise exception 'review_id_immutable';
  end if;
  if tg_op = 'UPDATE' then
    new.version := old.version + 1;
    new.updated_at := now();
  end if;
  return new;
end
$$;

create or replace function public.guard_employee_review_interface_feedback()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if not public.annual_review_employee_can_prepare(coalesce(new.review_id, old.review_id)) then
    raise exception 'annual_review_employee_interface_feedback_wrong_stage';
  end if;
  if tg_op = 'UPDATE' and new.review_id <> old.review_id then
    raise exception 'review_id_immutable';
  end if;
  if tg_op = 'UPDATE' then
    new.version := old.version + 1;
    new.updated_at := now();
  end if;
  return new;
end
$$;

drop trigger if exists manager_review_role_lessons_guard on public.manager_review_role_lessons;
create trigger manager_review_role_lessons_guard
before insert or update on public.manager_review_role_lessons
for each row execute function public.guard_manager_review_role_lessons();

drop trigger if exists employee_review_interface_feedback_guard on public.employee_review_interface_feedback;
create trigger employee_review_interface_feedback_guard
before insert or update on public.employee_review_interface_feedback
for each row execute function public.guard_employee_review_interface_feedback();

drop policy if exists manager_role_lessons_select on public.manager_review_role_lessons;
create policy manager_role_lessons_select
on public.manager_review_role_lessons
for select to authenticated
using (
  public.annual_review_is_manager(review_id)
  or (
    public.annual_review_is_employee(review_id)
    and exists (
      select 1 from public.annual_reviews r
      where r.id = review_id and r.answers_revealed_at is not null
    )
  )
);

drop policy if exists manager_role_lessons_insert on public.manager_review_role_lessons;
create policy manager_role_lessons_insert
on public.manager_review_role_lessons
for insert to authenticated
with check (public.annual_review_manager_can_prepare(review_id));

drop policy if exists manager_role_lessons_update on public.manager_review_role_lessons;
create policy manager_role_lessons_update
on public.manager_review_role_lessons
for update to authenticated
using (public.annual_review_manager_can_prepare(review_id))
with check (public.annual_review_manager_can_prepare(review_id));

drop policy if exists employee_interface_feedback_select on public.employee_review_interface_feedback;
create policy employee_interface_feedback_select
on public.employee_review_interface_feedback
for select to authenticated
using (
  public.annual_review_is_employee(review_id)
  or (
    public.annual_review_is_manager(review_id)
    and exists (
      select 1 from public.annual_reviews r
      where r.id = review_id and r.answers_revealed_at is not null
    )
  )
);

drop policy if exists employee_interface_feedback_insert on public.employee_review_interface_feedback;
create policy employee_interface_feedback_insert
on public.employee_review_interface_feedback
for insert to authenticated
with check (public.annual_review_employee_can_prepare(review_id));

drop policy if exists employee_interface_feedback_update on public.employee_review_interface_feedback;
create policy employee_interface_feedback_update
on public.employee_review_interface_feedback
for update to authenticated
using (public.annual_review_employee_can_prepare(review_id))
with check (public.annual_review_employee_can_prepare(review_id));

revoke all on public.manager_review_role_lessons, public.employee_review_interface_feedback from anon, authenticated;
grant select, insert, update on public.manager_review_role_lessons, public.employee_review_interface_feedback to authenticated;

revoke all on function public.guard_manager_review_role_lessons(), public.guard_employee_review_interface_feedback()
from public, anon, authenticated;
