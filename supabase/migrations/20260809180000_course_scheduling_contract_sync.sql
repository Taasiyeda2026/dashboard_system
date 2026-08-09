-- Focused school_2027 scheduling contract synchronization.
-- This migration is intentionally data-free: no activity changes and no backfill.
-- Reapplying it is safe because it only replaces existing function definitions.
-- Travel transitions continue to be enforced centrally by
-- scheduling_assert_assignment_calendar as raw cached travel + one 15-minute buffer.

create or replace function public.scheduling_effective_meetings(
  p_activity public.activities,
  p_emp_id bigint
) returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(item order by item->>'date'), '[]'::jsonb)
  from (
    select value as item
    from jsonb_array_elements(
      case
        -- Proposed dates belong only to the instructor holding this exact draft.
        when p_activity.draft_emp_id = p_emp_id::text
          and p_activity.draft_proposed_meetings is not null
          then p_activity.draft_proposed_meetings
        else public.scheduling_activity_official_meetings(p_activity)
      end
    ) proposed(value)
    where nullif(value->>'date', '') is not null
      and not exists (
        select 1
        from public.course_meeting_cancellations cancellation
        where cancellation.activity_id = p_activity.row_id
          and cancellation.meeting_date = (value->>'date')::date
      )
  ) effective
$$;

revoke all on function public.scheduling_effective_meetings(public.activities, bigint) from public;

-- Operational replacement remains available regardless of how many meetings have
-- already occurred. Completed-meeting count is retained for audit/reason policy only;
-- course status is never changed here and closure remains a separate manual action.
create or replace function public.reassign_locked_course_instructor(
  p_activity_id text,
  p_new_emp_id bigint,
  p_new_instructor_name text,
  p_top_emp_id bigint,
  p_selected_score integer,
  p_top_score integer,
  p_decision_type text,
  p_reason text default null
) returns public.activities
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.activities;
  selected_instructor public.contacts_instructors;
  caller_role text := public.app_current_role();
  prior_status text;
  prior_emp_id text;
  prior_instructor_name text;
  violations text[];
  final_status text;
  meetings_done integer;
begin
  if caller_role is null or caller_role not in ('admin','operation_manager') then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
  if not exists (select 1 from public.users u where u.auth_user_id = auth.uid() and u.is_active is true) then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
  if p_decision_type not in ('approved','overridden','exception_approved') then raise exception 'invalid_decision_type'; end if;

  select * into result from public.activities where row_id = p_activity_id for update;
  if not found then raise exception 'activity_not_found'; end if;
  if nullif(result.emp_id::text, '') is null then raise exception 'scheduling_no_existing_assignment'; end if;

  meetings_done := public.scheduling_course_meetings_completed(p_activity_id);
  if (meetings_done >= 1 or p_decision_type in ('overridden','exception_approved') or p_new_emp_id is distinct from p_top_emp_id)
    and nullif(btrim(p_reason), '') is null
  then raise exception 'scheduling_reason_required'; end if;

  perform public.scheduling_lock_instructor_for_write(p_new_emp_id);

  violations := public.scheduling_course_instructor_violations(p_activity_id, p_new_emp_id, false);
  if coalesce(array_length(violations, 1), 0) > 0 then
    raise exception '%', violations[1];
  end if;

  select * into selected_instructor from public.contacts_instructors where emp_id = p_new_emp_id;
  if btrim(coalesce(selected_instructor.full_name, '')) <> btrim(coalesce(p_new_instructor_name, '')) then raise exception 'instructor_name_mismatch'; end if;

  prior_status := result.instructor_assignment_status;
  prior_emp_id := result.emp_id::text;
  prior_instructor_name := result.instructor_name;
  final_status := 'שובץ';

  update public.activities
  set emp_id = p_new_emp_id,
      instructor_name = selected_instructor.full_name,
      instructor_assignment_locked = true,
      instructor_assignment_status = final_status
  where row_id = p_activity_id
  returning * into result;

  insert into public.instructor_assignment_audit(
    activity_id, selected_emp_id, selected_instructor_name, top_recommended_emp_id,
    selected_score, top_score, decision_type, reason, previous_status, new_status,
    bypassed_constraints, meetings_completed_at_decision, previous_emp_id, previous_instructor_name
  ) values (
    p_activity_id, p_new_emp_id::text, selected_instructor.full_name, p_top_emp_id::text,
    p_selected_score, p_top_score, p_decision_type, nullif(btrim(p_reason), ''), prior_status, final_status,
    '{}', meetings_done, prior_emp_id, prior_instructor_name
  );
  return result;
end
$$;
revoke all on function public.reassign_locked_course_instructor(text,bigint,text,bigint,integer,integer,text,text) from public;
grant execute on function public.reassign_locked_course_instructor(text,bigint,text,bigint,integer,integer,text,text) to authenticated;
