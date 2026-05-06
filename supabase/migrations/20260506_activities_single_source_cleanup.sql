-- Enforce public.activities as the single client-facing activities source.
-- Legacy activity/read-model tables may exist historically, but app roles should not
-- read or write them after activities_system_ready.csv is loaded into public.activities.

insert into public.settings(key, value, description)
values
  ('sheet_activities', 'activities', 'Supabase source for activities'),
  ('available_sheets', '["activities","contacts_instructors","contacts_schools","lists","edit_requests","operations_private_notes","users","settings"]', 'Available datasets for admin mapping')
on conflict (key) do update set
  value = excluded.value,
  description = excluded.description;

do $$
declare
  legacy_table text;
begin
  foreach legacy_table in array array['data_long', 'data_short', 'activity_meetings', 'dashboard_monthly_read_models'] loop
    if to_regclass(format('public.%I', legacy_table)) is not null then
      execute format('revoke all privileges on table public.%I from anon, authenticated', legacy_table);
    end if;
  end loop;
end $$;
