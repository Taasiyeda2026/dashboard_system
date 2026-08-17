-- Allow the same users who can edit activities directly to persist per-meeting notes.
-- The frontend upserts activity_meetings rows, so authenticated direct editors need
-- INSERT/UPDATE table privileges, sequence usage for new rows, and matching RLS policies.
-- Keep RLS explicit here so a fresh environment is protected before write grants apply.

alter table public.activity_meetings enable row level security;

grant insert, update on table public.activity_meetings to authenticated;
grant usage, select on sequence public.activity_meetings_id_seq to authenticated;

drop policy if exists activity_meetings_insert_direct_editors on public.activity_meetings;
create policy activity_meetings_insert_direct_editors
  on public.activity_meetings
  for insert
  to authenticated
  with check (public.app_can_edit_direct());

drop policy if exists activity_meetings_update_direct_editors on public.activity_meetings;
create policy activity_meetings_update_direct_editors
  on public.activity_meetings
  for update
  to authenticated
  using (public.app_can_edit_direct())
  with check (public.app_can_edit_direct());
