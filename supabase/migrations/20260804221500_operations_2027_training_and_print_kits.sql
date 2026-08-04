alter table public.proposal_gefen_courses
  add column if not exists requires_print_kit boolean not null default false;

create table if not exists public.course_instructor_trainings (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.proposal_gefen_courses(id) on delete cascade,
  instructor_name text not null check (btrim(instructor_name) <> ''),
  is_trained boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint course_instructor_trainings_course_instructor_key unique (course_id, instructor_name)
);

create table if not exists public.course_print_kit_inventory (
  course_id uuid primary key references public.proposal_gefen_courses(id) on delete cascade,
  warehouse_quantity integer not null default 0 check (warehouse_quantity >= 0),
  hila_quantity integer not null default 0 check (hila_quantity >= 0),
  idan_quantity integer not null default 0 check (idan_quantity >= 0),
  gil_quantity integer not null default 0 check (gil_quantity >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.course_print_kit_distributions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.proposal_gefen_courses(id) on delete cascade,
  instructor_name text not null check (btrim(instructor_name) <> ''),
  source_location text not null check (source_location in ('warehouse', 'hila', 'idan', 'gil')),
  delivered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint course_print_kit_distributions_course_instructor_key unique (course_id, instructor_name)
);

insert into public.course_print_kit_inventory (course_id)
select id
from public.proposal_gefen_courses
where is_active = true
on conflict (course_id) do nothing;

alter table public.course_instructor_trainings enable row level security;
alter table public.course_print_kit_inventory enable row level security;
alter table public.course_print_kit_distributions enable row level security;

drop policy if exists course_instructor_trainings_select_authenticated on public.course_instructor_trainings;
create policy course_instructor_trainings_select_authenticated
on public.course_instructor_trainings
for select
to authenticated
using (true);

drop policy if exists course_instructor_trainings_insert_ops on public.course_instructor_trainings;
create policy course_instructor_trainings_insert_ops
on public.course_instructor_trainings
for insert
to authenticated
with check ((select public.app_is_admin_or_operation_manager()));

drop policy if exists course_instructor_trainings_update_ops on public.course_instructor_trainings;
create policy course_instructor_trainings_update_ops
on public.course_instructor_trainings
for update
to authenticated
using ((select public.app_is_admin_or_operation_manager()))
with check ((select public.app_is_admin_or_operation_manager()));

drop policy if exists course_print_kit_inventory_select_authenticated on public.course_print_kit_inventory;
create policy course_print_kit_inventory_select_authenticated
on public.course_print_kit_inventory
for select
to authenticated
using (true);

drop policy if exists course_print_kit_distributions_select_authenticated on public.course_print_kit_distributions;
create policy course_print_kit_distributions_select_authenticated
on public.course_print_kit_distributions
for select
to authenticated
using (true);

grant select, insert, update on public.course_instructor_trainings to authenticated;
grant select on public.course_print_kit_inventory to authenticated;
grant select on public.course_print_kit_distributions to authenticated;

create or replace function public.set_course_print_kit_requirement(
  p_course_id uuid,
  p_required boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.app_is_admin_or_operation_manager() then
    raise exception 'אין הרשאה לעדכן ערכות דפוס' using errcode = '42501';
  end if;

  update public.proposal_gefen_courses
  set requires_print_kit = coalesce(p_required, false),
      updated_at = now()
  where id = p_course_id;

  if not found then
    raise exception 'הקורס לא נמצא' using errcode = 'P0002';
  end if;

  if coalesce(p_required, false) then
    insert into public.course_print_kit_inventory (course_id)
    values (p_course_id)
    on conflict (course_id) do nothing;
  end if;
end;
$$;

create or replace function public.set_course_print_kit_stock(
  p_course_id uuid,
  p_location text,
  p_quantity integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_location text := lower(btrim(coalesce(p_location, '')));
  v_quantity integer := coalesce(p_quantity, 0);
begin
  if not public.app_is_admin_or_operation_manager() then
    raise exception 'אין הרשאה לעדכן מלאי ערכות' using errcode = '42501';
  end if;

  if v_location not in ('warehouse', 'hila', 'idan', 'gil') then
    raise exception 'מיקום מלאי לא תקין' using errcode = '22023';
  end if;

  if v_quantity < 0 then
    raise exception 'כמות המלאי אינה יכולה להיות שלילית' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.proposal_gefen_courses
    where id = p_course_id
      and requires_print_kit = true
  ) then
    raise exception 'הקורס אינו מוגדר כקורס עם ערכה' using errcode = '22023';
  end if;

  insert into public.course_print_kit_inventory (course_id)
  values (p_course_id)
  on conflict (course_id) do nothing;

  update public.course_print_kit_inventory
  set warehouse_quantity = case when v_location = 'warehouse' then v_quantity else warehouse_quantity end,
      hila_quantity = case when v_location = 'hila' then v_quantity else hila_quantity end,
      idan_quantity = case when v_location = 'idan' then v_quantity else idan_quantity end,
      gil_quantity = case when v_location = 'gil' then v_quantity else gil_quantity end,
      updated_at = now()
  where course_id = p_course_id;
end;
$$;

create or replace function public.deliver_course_print_kit(
  p_course_id uuid,
  p_instructor_name text,
  p_source_location text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_instructor text := btrim(coalesce(p_instructor_name, ''));
  v_location text := lower(btrim(coalesce(p_source_location, '')));
  v_stock public.course_print_kit_inventory%rowtype;
begin
  if not public.app_is_admin_or_operation_manager() then
    raise exception 'אין הרשאה למסור ערכות דפוס' using errcode = '42501';
  end if;

  if v_instructor = '' then
    raise exception 'שם המדריך חסר' using errcode = '22023';
  end if;

  if v_location not in ('warehouse', 'hila', 'idan', 'gil') then
    raise exception 'מיקום מלאי לא תקין' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.proposal_gefen_courses
    where id = p_course_id
      and requires_print_kit = true
  ) then
    raise exception 'הקורס אינו מוגדר כקורס עם ערכה' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.course_print_kit_distributions
    where course_id = p_course_id
      and instructor_name = v_instructor
  ) then
    return;
  end if;

  insert into public.course_print_kit_inventory (course_id)
  values (p_course_id)
  on conflict (course_id) do nothing;

  select *
  into v_stock
  from public.course_print_kit_inventory
  where course_id = p_course_id
  for update;

  if (v_location = 'warehouse' and v_stock.warehouse_quantity <= 0)
     or (v_location = 'hila' and v_stock.hila_quantity <= 0)
     or (v_location = 'idan' and v_stock.idan_quantity <= 0)
     or (v_location = 'gil' and v_stock.gil_quantity <= 0) then
    raise exception 'אין מלאי זמין במיקום שנבחר' using errcode = 'P0001';
  end if;

  update public.course_print_kit_inventory
  set warehouse_quantity = case when v_location = 'warehouse' then warehouse_quantity - 1 else warehouse_quantity end,
      hila_quantity = case when v_location = 'hila' then hila_quantity - 1 else hila_quantity end,
      idan_quantity = case when v_location = 'idan' then idan_quantity - 1 else idan_quantity end,
      gil_quantity = case when v_location = 'gil' then gil_quantity - 1 else gil_quantity end,
      updated_at = now()
  where course_id = p_course_id;

  insert into public.course_print_kit_distributions (
    course_id,
    instructor_name,
    source_location,
    delivered_at,
    updated_at
  ) values (
    p_course_id,
    v_instructor,
    v_location,
    now(),
    now()
  );
end;
$$;

create or replace function public.return_course_print_kit(
  p_course_id uuid,
  p_instructor_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_instructor text := btrim(coalesce(p_instructor_name, ''));
  v_distribution public.course_print_kit_distributions%rowtype;
begin
  if not public.app_is_admin_or_operation_manager() then
    raise exception 'אין הרשאה להחזיר ערכות דפוס' using errcode = '42501';
  end if;

  if v_instructor = '' then
    raise exception 'שם המדריך חסר' using errcode = '22023';
  end if;

  select *
  into v_distribution
  from public.course_print_kit_distributions
  where course_id = p_course_id
    and instructor_name = v_instructor
  for update;

  if not found then
    return;
  end if;

  insert into public.course_print_kit_inventory (course_id)
  values (p_course_id)
  on conflict (course_id) do nothing;

  update public.course_print_kit_inventory
  set warehouse_quantity = case when v_distribution.source_location = 'warehouse' then warehouse_quantity + 1 else warehouse_quantity end,
      hila_quantity = case when v_distribution.source_location = 'hila' then hila_quantity + 1 else hila_quantity end,
      idan_quantity = case when v_distribution.source_location = 'idan' then idan_quantity + 1 else idan_quantity end,
      gil_quantity = case when v_distribution.source_location = 'gil' then gil_quantity + 1 else gil_quantity end,
      updated_at = now()
  where course_id = p_course_id;

  delete from public.course_print_kit_distributions
  where id = v_distribution.id;
end;
$$;

revoke all on function public.set_course_print_kit_requirement(uuid, boolean) from public, anon;
revoke all on function public.set_course_print_kit_stock(uuid, text, integer) from public, anon;
revoke all on function public.deliver_course_print_kit(uuid, text, text) from public, anon;
revoke all on function public.return_course_print_kit(uuid, text) from public, anon;

grant execute on function public.set_course_print_kit_requirement(uuid, boolean) to authenticated;
grant execute on function public.set_course_print_kit_stock(uuid, text, integer) to authenticated;
grant execute on function public.deliver_course_print_kit(uuid, text, text) to authenticated;
grant execute on function public.return_course_print_kit(uuid, text) to authenticated;
