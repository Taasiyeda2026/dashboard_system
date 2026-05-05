create table if not exists public.settings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  value text not null default '',
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_settings_updated_at on public.settings;
create trigger trg_touch_settings_updated_at
before update on public.settings
for each row
execute function public.touch_settings_updated_at();

alter table public.settings enable row level security;

drop policy if exists settings_select_all on public.settings;
create policy settings_select_all
on public.settings
for select
to anon, authenticated
using (true);

drop policy if exists settings_insert_all on public.settings;
create policy settings_insert_all
on public.settings
for insert
to anon, authenticated
with check (true);

drop policy if exists settings_update_all on public.settings;
create policy settings_update_all
on public.settings
for update
to anon, authenticated
using (true)
with check (true);

grant select, insert, update, delete on public.settings to anon, authenticated;

insert into public.settings(key, value, description)
values
  ('sheet_short_activities', 'data_short', 'Supabase source for short activities'),
  ('sheet_long_activities', 'data_long', 'Supabase source for long activities'),
  ('available_sheets', '["data_short","data_long","activity_meetings","contacts_instructors","contacts_schools","lists","edit_requests","operations_private_notes","users","settings"]', 'Available datasets for admin mapping')
on conflict (key) do nothing;
