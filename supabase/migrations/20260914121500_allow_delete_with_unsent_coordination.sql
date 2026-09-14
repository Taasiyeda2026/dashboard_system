-- Allow permanent deletion of an unfinalized activity when its only coordination
-- history is unsent draft/cancelled/failed work. Sent coordination remains a hard
-- blocker. This keeps the permanent-delete safety rule aligned with the business
-- rule: draft activities may be removed, but execution/sent evidence is preserved.

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

  -- Coordination blocks deletion only after it was actually sent/verified.
  -- Draft, cancelled and failed dispatches are pre-execution work and may be
  -- detached from a draft activity that is being permanently removed.
  if exists (
    select 1
    from public.activity_coordination_dispatch_items i
    join public.activity_coordination_dispatches d on d.id = i.dispatch_id
    where i.activity_row_id = new.row_id
      and (
        d.sent_at is not null
        or d.sent_verified_at is not null
        or lower(btrim(coalesce(d.status, ''))) in ('sent', 'verified', 'נשלח', 'נשלחה')
      )
  ) then
    raise exception using
      errcode = '23503',
      message = 'לא ניתן למחוק את הפעילות כי כבר נשלח עבורה תיאום פעילות.',
      detail = 'activity_has_operational_records:coordination_sent';
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

  -- At this point any coordination rows are guaranteed to be unsent. Remove the
  -- activity-item link so the RESTRICT FK cannot turn an unsent draft into a
  -- permanent-delete blocker. The dispatch header may remain as draft history.
  delete from public.activity_coordination_dispatch_items
  where activity_row_id = new.row_id;

  delete from public.operations_private_notes
  where source_row_id = new.row_id;

  delete from public.activities
  where id = new.id
    and row_id = new.row_id;

  return new;
end;
$function$;

revoke all on function public.hard_delete_activity_after_deleted_status() from public;

comment on function public.hard_delete_activity_after_deleted_status() is
  'Permanently deletes an authorized draft activity when no execution/finance/sent-coordination evidence exists; unsent coordination item links do not block deletion.';
