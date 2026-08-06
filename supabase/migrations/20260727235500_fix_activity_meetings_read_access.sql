-- Allow authenticated dashboard users to read meeting notes for activity editing.
-- The table had RLS enabled but no SELECT policy or authenticated grant, causing 403 responses.

grant select on table public.activity_meetings to authenticated;

create policy "activity_meetings_select_authenticated"
on public.activity_meetings
for select
to authenticated
using (auth.uid() is not null);

create index if not exists activity_meetings_source_row_id_idx
on public.activity_meetings (source_row_id);
