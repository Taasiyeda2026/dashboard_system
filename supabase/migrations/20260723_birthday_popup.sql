create table if not exists public.employee_birthdays (
  id uuid primary key default gen_random_uuid(),
  employee_name text not null,
  employee_slug text not null unique,
  birth_day smallint not null check (birth_day between 1 and 31),
  birth_month smallint not null check (birth_month between 1 and 12),
  image_path text not null,
  is_active boolean not null default true,
  display_order integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.birthday_popup_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  viewer_auth_user_id uuid not null references auth.users(id) on delete cascade,
  birthday_id uuid not null references public.employee_birthdays(id) on delete cascade,
  birthday_year integer not null,
  acknowledged_at timestamptz not null default now(),
  unique (viewer_auth_user_id, birthday_id, birthday_year)
);

alter table public.employee_birthdays enable row level security;
alter table public.birthday_popup_acknowledgements enable row level security;

grant select on table public.employee_birthdays to authenticated;
grant select, insert on table public.birthday_popup_acknowledgements to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'employee_birthdays'
      and policyname = 'authenticated users can read active birthdays'
  ) then
    create policy "authenticated users can read active birthdays"
      on public.employee_birthdays
      for select
      to authenticated
      using (is_active = true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'birthday_popup_acknowledgements'
      and policyname = 'users can read own birthday acknowledgements'
  ) then
    create policy "users can read own birthday acknowledgements"
      on public.birthday_popup_acknowledgements
      for select
      to authenticated
      using ((select auth.uid()) = viewer_auth_user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'birthday_popup_acknowledgements'
      and policyname = 'users can insert own birthday acknowledgements'
  ) then
    create policy "users can insert own birthday acknowledgements"
      on public.birthday_popup_acknowledgements
      for insert
      to authenticated
      with check ((select auth.uid()) = viewer_auth_user_id);
  end if;
end
$$;

insert into public.employee_birthdays
  (employee_name, employee_slug, birth_day, birth_month, image_path, is_active, display_order)
values
  ('יעל אביב', 'yael-aviv', 2, 1, '/birthdays/yael.png', true, 1),
  ('טוני נעים', 'toni-naim', 29, 7, '/birthdays/toni.png', true, 1),
  ('איסראא אבו ראס', 'israa-abu-ras', 19, 9, '/birthdays/esraa.png', true, 1),
  ('עידן נחום', 'idan-nahum', 23, 11, '/birthdays/idan.png', true, 1),
  ('גיל נאמן', 'gil-neeman', 30, 11, '/birthdays/gil.png', true, 1),
  ('עדן כהן', 'eden-cohen', 16, 4, '/birthdays/eden.png', true, 1),
  ('הילה רוזן', 'hila-rozen', 28, 10, '/birthdays/hila.png', true, 1)
on conflict (employee_slug) do update
set
  employee_name = excluded.employee_name,
  birth_day = excluded.birth_day,
  birth_month = excluded.birth_month,
  image_path = excluded.image_path,
  is_active = excluded.is_active,
  display_order = excluded.display_order,
  updated_at = now();
