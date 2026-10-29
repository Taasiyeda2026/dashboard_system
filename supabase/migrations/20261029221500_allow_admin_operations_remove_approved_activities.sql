-- Admin and operation_manager: removing an activity that already has approval, attendance,
-- finance, sent coordination or other execution evidence is a soft removal only.
-- Preserve the activity row and all related evidence for audit; remove draft-only
-- activities permanently as before. Other explicit-permission users retain the
-- historical safeguards for protected records.

create or replace function public.hard_delete_activity_after_deleted_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  sent_coordination_exists boolean := false;
  protected_evidence_exists boolean := false;
begin
  if not public.app_can_delete_activity() then
    raise exception 'Only admin or operation_manager can permanently delete activities'
      using errcode = '42501';
  end if;

  protected_evidence_exists := protected_evidence_exists or exists (
    select 1
    from public.attendance_records r
    where r.activity_id = new.id
       or r.activity_row_id = new.row_id
  );

  protected_evidence_exists := protected_evidence_exists or exists (
    select 1
    from public.activity_completion_approval_uploads r
    where r.activity_row_id = new.row_id
  );

  -- Sent coordination is retained with the activity (not unlinked or deleted).
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


  protected_evidence_exists := protected_evidence_exists or exists (
    select 1
    from public.finance_collection_tracking r
    where r.activity_row_id = new.row_id
  );

  protected_evidence_exists := protected_evidence_exists or exists (
    select 1
    from public.finance_transaction_account_lines r
    where r.activity_row_id = new.row_id
  );

  protected_evidence_exists := protected_evidence_exists or exists (
    select 1
    from public.finance_transaction_account_meetings r
    where r.activity_row_id = new.row_id
  );


  protected_evidence_exists := protected_evidence_exists or exists (
    select 1
    from public.course_meeting_cancellations r
    where r.activity_id = new.row_id
  );

  protected_evidence_exists := protected_evidence_exists or exists (
    select 1
    from public.course_meeting_instructor_history r
    where r.activity_id = new.row_id
  );

  -- Operational evidence requires a retained activity row for referential integrity.
  if sent_coordination_exists or protected_evidence_exists then
    if coalesce(public.app_current_role(), '') not in ('admin', 'operation_manager') then
      raise exception using
        errcode = '23503',
        message = 'לא ניתן למחוק פעילות עם נתוני ביצוע או תיאום שנשלח.',
        detail = 'activity_has_operational_records:protected_evidence';
    end if;
    -- Keep approved and sent material referenced by their original activity.
    -- The caller's status update to 'נמחק' hides the activity from active lists.
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
