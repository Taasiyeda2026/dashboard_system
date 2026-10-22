-- Admin-only removal of activities with already-sent coordination.
-- Keeps audit links intact by retaining the row with deleted UI status; does
-- NOT delete attendance, accounting evidence, instructor history or sent mails.
-- Other authorized operators preserve all historical deletion restrictions.
-- Planning-only meeting metadata must not block permanent deletion.
-- Attendance, completion approvals, sent coordination, finance, cancellations and
-- instructor-history evidence continue to block deletion.

create or replace function public.hard_delete_activity_after_deleted_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  sent_coordination_exists boolean := false;
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

  -- An administrator may remove a sent-coordination activity from active
  -- lists without destroying its legally/operationally important audit trail.
  -- Non-admin deletion keeps the existing block intact.
  select exists (
    select 1
    from public.activity_coordination_dispatch_items i
    join public.activity_coordination_dispatches d on d.id = i.dispatch_id
    where i.activity_row_id = new.row_id
      and (
        d.sent_at is not null
        or d.sent_verified_at is not null
        or lower(btrim(coalesce(d.status, ''))) in ('sent', 'verified', 'נשלח', 'נשלחה')
      )
  ) into sent_coordination_exists;

  if sent_coordination_exists and public.app_current_role() is distinct from 'admin' then
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

  -- All execution, finance, approval and schedule-history guards have passed.
  -- For an administrator with sent coordination, retain the activity and its
  -- dispatch-item FK rows, preserving PDF/dispatch history for later audit.
  -- The status update to 'נמחק' remains committed, hiding it from active tabs.
  if sent_coordination_exists then
    return new;
  end if;

  -- activity_meetings stores planning/editor metadata, not execution evidence.
  -- Hard evidence is guarded above, so these planning rows may be removed with the activity.
  delete from public.activity_meetings
  where source_row_id = new.row_id;

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
