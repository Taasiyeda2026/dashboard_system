-- Two additional preparation questions for every employee and manager.
-- Stored separately so the existing preparation payload remains backwards compatible.

create table if not exists public.employee_review_next_school_year (
  review_id uuid primary key references public.annual_reviews(id) on delete cascade,
  readiness text not null default '',
  priorities text not null default '',
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.manager_review_next_school_year (
  review_id uuid primary key references public.annual_reviews(id) on delete cascade,
  readiness text not null default '',
  priorities text not null default '',
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.employee_review_next_school_year enable row level security;
alter table public.manager_review_next_school_year enable row level security;

create or replace function public.guard_employee_review_next_school_year()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if not public.annual_review_employee_can_prepare(coalesce(new.review_id, old.review_id)) then
    raise exception 'annual_review_employee_next_school_year_wrong_stage';
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

create or replace function public.guard_manager_review_next_school_year()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if not public.annual_review_manager_can_prepare(coalesce(new.review_id, old.review_id)) then
    raise exception 'annual_review_manager_next_school_year_wrong_stage';
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

drop trigger if exists employee_review_next_school_year_guard on public.employee_review_next_school_year;
create trigger employee_review_next_school_year_guard
before insert or update on public.employee_review_next_school_year
for each row execute function public.guard_employee_review_next_school_year();

drop trigger if exists manager_review_next_school_year_guard on public.manager_review_next_school_year;
create trigger manager_review_next_school_year_guard
before insert or update on public.manager_review_next_school_year
for each row execute function public.guard_manager_review_next_school_year();

drop policy if exists employee_next_school_year_select on public.employee_review_next_school_year;
create policy employee_next_school_year_select
on public.employee_review_next_school_year
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

drop policy if exists employee_next_school_year_insert on public.employee_review_next_school_year;
create policy employee_next_school_year_insert
on public.employee_review_next_school_year
for insert to authenticated
with check (public.annual_review_employee_can_prepare(review_id));

drop policy if exists employee_next_school_year_update on public.employee_review_next_school_year;
create policy employee_next_school_year_update
on public.employee_review_next_school_year
for update to authenticated
using (public.annual_review_employee_can_prepare(review_id))
with check (public.annual_review_employee_can_prepare(review_id));

drop policy if exists manager_next_school_year_select on public.manager_review_next_school_year;
create policy manager_next_school_year_select
on public.manager_review_next_school_year
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

drop policy if exists manager_next_school_year_insert on public.manager_review_next_school_year;
create policy manager_next_school_year_insert
on public.manager_review_next_school_year
for insert to authenticated
with check (public.annual_review_manager_can_prepare(review_id));

drop policy if exists manager_next_school_year_update on public.manager_review_next_school_year;
create policy manager_next_school_year_update
on public.manager_review_next_school_year
for update to authenticated
using (public.annual_review_manager_can_prepare(review_id))
with check (public.annual_review_manager_can_prepare(review_id));

revoke all on public.employee_review_next_school_year, public.manager_review_next_school_year from anon, authenticated;
grant select, insert, update on public.employee_review_next_school_year, public.manager_review_next_school_year to authenticated;

revoke all on function public.guard_employee_review_next_school_year(), public.guard_manager_review_next_school_year()
from public, anon, authenticated;
