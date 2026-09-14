-- Restore permanent deletion for draft/unfinalized activities.
--
-- The client continues to use status = 'נמחק' as the authorized delete signal.
-- For admin/operation_manager users, that signal is converted into a physical
-- DELETE only when no operational records exist. If attendance, coordination,
-- finance, completion, or executed-meeting data already exists, deletion is
-- rejected and the status update is rolled back.
--
-- Direct table DELETE remains unavailable to authenticated clients; the guarded
-- trigger is the single deletion path used by the application.

create or replace function public.hard_delete_activity_after_deleted_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if not public.app_can_delete_activity() then
    raise exception 'Only admin or operation_manager can permanently delete activities'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.attendance_records r
    where r.activity_id = new.id
       or r.activity_row_id = new.row_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'לא ניתן למחוק את הפעילות כי כבר קיימים עבורה נתוני ביצוע, נוכחות, תיאום או כספים.',
      detail = 'activity_has_operational_records:attendance_records';
  end if;

  if exists (
    select 1
    from public.activity_completion_approval_uploads r
    where r.activity_row_id = new.row_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'לא ניתן למחוק את הפעילות כי כבר קיימים עבורה נתוני ביצוע, נוכחות, תיאום או כספים.',
      detail = 'activity_has_operational_records:completion_approval';
  end if;

  if exists (
    select 1
    from public.activity_coordination_dispatch_items r
    where r.activity_row_id = new.row_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'לא ניתן למחוק את הפעילות כי כבר קיימים עבורה נתוני ביצוע, נוכחות, תיאום או כספים.',
      detail = 'activity_has_operational_records:coordination';
  end if;

  if exists (
    select 1
    from public.finance_collection_tracking r
    where r.activity_row_id = new.row_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'לא ניתן למחוק את הפעילות כי כבר קיימים עבורה נתוני ביצוע, נוכחות, תיאום או כספים.',
      detail = 'activity_has_operational_records:finance_collection';
  end if;

  if exists (
    select 1
    from public.finance_transaction_account_lines r
    where r.activity_row_id = new.row_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'לא ניתן למחוק את הפעילות כי כבר קיימים עבורה נתוני ביצוע, נוכחות, תיאום או כספים.',
      detail = 'activity_has_operational_records:finance_lines';
  end if;

  if exists (
    select 1
    from public.finance_transaction_account_meetings r
    where r.activity_row_id = new.row_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'לא ניתן למחוק את הפעילות כי כבר קיימים עבורה נתוני ביצוע, נוכחות, תיאום או כספים.',
      detail = 'activity_has_operational_records:finance_meetings';
  end if;

  if exists (
    select 1
    from public.activity_meetings r
    where r.source_row_id = new.row_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'לא ניתן למחוק את הפעילות כי כבר קיימים עבורה נתוני ביצוע, נוכחות, תיאום או כספים.',
      detail = 'activity_has_operational_records:activity_meetings';
  end if;

  if exists (
    select 1
    from public.course_meeting_cancellations r
    where r.activity_id = new.row_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'לא ניתן למחוק את הפעילות כי כבר קיימים עבורה נתוני ביצוע, נוכחות, תיאום או כספים.',
      detail = 'activity_has_operational_records:meeting_cancellations';
  end if;

  if exists (
    select 1
    from public.course_meeting_instructor_history r
    where r.activity_id = new.row_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'לא ניתן למחוק את הפעילות כי כבר קיימים עבורה נתוני ביצוע, נוכחות, תיאום או כספים.',
      detail = 'activity_has_operational_records:instructor_history';
  end if;

  -- Private operational notes belong to the activity itself and are not an
  -- execution record. Remove them together with a draft activity so no orphaned
  -- note remains after the physical delete.
  delete from public.operations_private_notes
  where source_row_id = new.row_id;

  delete from public.activities
  where id = new.id
    and row_id = new.row_id;

  return new;
end;
$function$;

revoke all on function public.hard_delete_activity_after_deleted_status() from public;

-- Keep direct DELETE closed. The app deletes through the guarded status signal.
drop policy if exists activities_delete_admin_operation_only on public.activities;
revoke delete on table public.activities from authenticated;
revoke delete on table public.activities from anon;

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
  'Permanently deletes an authorized draft activity only when no operational attendance, coordination, finance, completion, or executed-meeting records exist.';

comment on table public.activities is
  'Operational activities. Authorized application deletion is permanent for draft/unfinalized activities and is blocked when operational records already exist; proposal links remain provenance and do not lock later catalog edits.';
