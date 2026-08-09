-- Repair the draft lifecycle without replaying earlier scheduling migrations.
-- No activity, course, instructor, or meeting data is backfilled here.

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

create or replace function public.cancel_course_assignment_draft(p_activity_id text)
returns public.activities
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.activities;
  caller_role text := public.app_current_role();
begin
  if caller_role is null or caller_role not in ('admin', 'operation_manager') then
    raise exception 'scheduling_permission_denied' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.users u where u.auth_user_id = auth.uid() and u.is_active is true
  ) then
    raise exception 'scheduling_permission_denied' using errcode = '42501';
  end if;

  select * into result from public.activities where row_id = p_activity_id for update;
  if not found then raise exception 'activity_not_found'; end if;

  update public.activities
  set draft_emp_id = null,
      draft_instructor_name = null,
      draft_created_at = null,
      draft_created_by = null,
      draft_proposed_meetings = null
  where row_id = p_activity_id
  returning * into result;

  insert into public.instructor_assignment_audit(
    activity_id, selected_emp_id, selected_instructor_name, decision_type,
    previous_status, new_status
  ) values (
    p_activity_id, '', '', 'draft_cancelled',
    result.instructor_assignment_status, result.instructor_assignment_status
  );
  return result;
end
$$;

revoke all on function public.cancel_course_assignment_draft(text) from public;
grant execute on function public.cancel_course_assignment_draft(text) to authenticated;

