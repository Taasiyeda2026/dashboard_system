-- Read-only access to persisted staged schedules for the existing team scheduling agent.
-- Never mutate drafts, assignments, dates or approvals.
create or replace function public.scheduling_agent_team_read_staged_schedule(p_activity_id text)
returns jsonb language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  a public.activities;
begin
  perform public.scheduling_agent_team_assert_member();
  select * into a from public.activities
   where row_id = p_activity_id
     and activity_season = 'school_2027'
     and activity_type = 'course';
  if not found then raise exception 'scheduling_agent_team_course_only'; end if;
  return jsonb_build_object(
    'activityId', a.row_id,
    'school', a.school,
    'classGroup', a.class_group,
    'instructorId', a.emp_id,
    'draftInstructorId', a.draft_emp_id,
    'startTime', a.start_time,
    'endTime', a.end_time,
    'requiredMeetingCount', a.sessions,
    'draftMeetings', coalesce(a.draft_proposed_meetings, '[]'::jsonb),
    'draftCreatedAt', a.draft_created_at,
    'activityUpdatedAt', a.updated_at,
    'isCallerOwned', a.draft_created_by is not distinct from auth.uid() and a.draft_created_by is not null,
    'assignmentLocked', a.instructor_assignment_locked,
    'status', case when a.emp_id is not null then 'assigned'
      when a.draft_emp_id is not null then 'staged'
      else 'missing_draft' end
  );
end;
$$;
revoke all on function public.scheduling_agent_team_read_staged_schedule(text) from public, anon;
grant execute on function public.scheduling_agent_team_read_staged_schedule(text) to authenticated;
