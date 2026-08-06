-- Activity deletion is permanent.
-- The deployed client currently marks an activity with status = 'נמחק'.
-- Convert that authorized delete signal into a physical DELETE while keeping
-- direct DELETE available for the corrected client implementation.

-- The Data API needs both a table privilege and an RLS policy.
grant delete on table public.activities to authenticated;
revoke delete on table public.activities from anon;

drop policy if exists activities_delete_admin_operation_only on public.activities;
create policy activities_delete_admin_operation_only
  on public.activities
  for delete
  to authenticated
  using ((select public.app_can_delete_activity()));

-- A school_2027 course is deleted in the same statement, but PostgreSQL checks
-- row constraints before AFTER triggers run. Permit the transient delete marker;
-- the trigger below removes the row before the statement completes.
alter table public.activities
  drop constraint if exists activities_school_2027_course_status_check;

alter table public.activities
  add constraint activities_school_2027_course_status_check
  check (
    not (
      activity_season = 'school_2027'
      and lower(trim(coalesce(activity_type, ''))) = any (array['קורס', 'course', 'program'])
    )
    or trim(coalesce(status, '')) = any (array['פתוח', 'סגור', 'נמחק'])
  );

create or replace function public.hard_delete_activity_after_deleted_status()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.app_can_delete_activity() then
    raise exception 'Only admin or operation_manager can permanently delete activities'
      using errcode = '42501';
  end if;

  delete from public.activities
  where id = new.id
    and row_id = new.row_id;

  return new;
end;
$$;

revoke all on function public.hard_delete_activity_after_deleted_status() from public;

drop trigger if exists trg_hard_delete_activity_after_deleted_status on public.activities;
create trigger trg_hard_delete_activity_after_deleted_status
after update of status on public.activities
for each row
when (
  old.status is distinct from new.status
  and new.status = 'נמחק'
)
execute function public.hard_delete_activity_after_deleted_status();

comment on function public.hard_delete_activity_after_deleted_status() is
  'Physically deletes an activity when an authorized client requests deletion through the legacy deleted-status action.';
