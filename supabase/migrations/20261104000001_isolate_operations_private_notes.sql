-- Preserve original private notes and eliminate the publicly readable duplicate.
insert into public.operations_private_notes (source_sheet,source_row_id,note_text,updated_at,updated_by,active)
select 'activities',row_id,operations_private_notes,now()::text,'migration_20261104','yes'
from public.activities
where nullif(btrim(operations_private_notes),'') is not null
on conflict (source_sheet,source_row_id) do nothing;

drop policy if exists operations_private_notes_select_admin_operation_only on public.operations_private_notes;
drop policy if exists operations_private_notes_insert_admin_operation_only on public.operations_private_notes;
drop policy if exists operations_private_notes_update_admin_operation_only on public.operations_private_notes;
drop policy if exists operations_private_notes_delete_admin_operation_only on public.operations_private_notes;
drop policy if exists operations_private_notes_select_operation_only on public.operations_private_notes;
drop policy if exists operations_private_notes_insert_operation_only on public.operations_private_notes;
drop policy if exists operations_private_notes_update_operation_only on public.operations_private_notes;
drop policy if exists operations_private_notes_delete_operation_only on public.operations_private_notes;
create policy operations_private_notes_select_operation_only on public.operations_private_notes
for select to authenticated using (auth.uid() is not null and app_current_role()='operation_manager');
create policy operations_private_notes_insert_operation_only on public.operations_private_notes
for insert to authenticated with check (auth.uid() is not null and app_current_role()='operation_manager');
create policy operations_private_notes_update_operation_only on public.operations_private_notes
for update to authenticated using (auth.uid() is not null and app_current_role()='operation_manager')
with check (auth.uid() is not null and app_current_role()='operation_manager');
create policy operations_private_notes_delete_operation_only on public.operations_private_notes
for delete to authenticated using (auth.uid() is not null and app_current_role()='operation_manager');
update public.activities set operations_private_notes=null where operations_private_notes is not null;
create or replace function public.prevent_shared_operational_note()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  new.operations_private_notes:=null;
  return new;
end $$;
drop trigger if exists enforce_private_operational_note on public.activities;
create trigger enforce_private_operational_note before insert or update of operations_private_notes
on public.activities for each row execute function public.prevent_shared_operational_note();
