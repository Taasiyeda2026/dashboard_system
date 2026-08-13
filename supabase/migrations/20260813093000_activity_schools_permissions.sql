-- Allow authenticated direct activity editors to maintain the activity↔school association table.
-- Mirrors the permission model used by activity_funding_sources.

alter table public.activity_schools enable row level security;

grant select, insert, update, delete on public.activity_schools to authenticated;

drop policy if exists activity_schools_read_authenticated on public.activity_schools;
create policy activity_schools_read_authenticated
on public.activity_schools
for select
to authenticated
using (true);

drop policy if exists activity_schools_write_managers on public.activity_schools;
create policy activity_schools_write_managers
on public.activity_schools
for all
to authenticated
using ((select public.app_can_edit_direct()))
with check ((select public.app_can_edit_direct()));
