-- Chat users may finalize ordinary authorized course assignments just as they can in
-- the dashboard. This operates on their OWN previously validated manual draft only.
-- Any pending manager approval is checked inside the existing assignment trigger.
-- Only the designated owner can approve exceptions; workers cannot change policy.

create or replace function public.scheduling_agent_team_confirm_own_draft(
  p_activity_id text
) returns jsonb
language plpgsql security definer
set search_path=public,pg_temp
as $$
declare
  a public.activities;
  confirmed public.activities;
  approval_state jsonb;
begin
  perform public.scheduling_agent_team_assert_member();
  if p_activity_id is null or length(btrim(p_activity_id)) not between 1 and 200
  then raise exception 'scheduling_agent_invalid_selection'; end if;

  select * into a from public.activities where row_id=p_activity_id for update;
  if not found or a.activity_season <> 'school_2027'
     or a.activity_type <> 'course' or a.status <> 'פתוח'
  then raise exception 'scheduling_agent_team_course_only'; end if;
  if a.emp_id is not null or a.instructor_assignment_locked
     or nullif(btrim(coalesce(a.emp_id_2,'')), '') is not null
  then raise exception 'scheduling_assignment_locked'; end if;

  if nullif(btrim(coalesce(a.draft_emp_id,'')), '') is null
     or a.draft_created_by is distinct from auth.uid()
     or nullif(btrim(coalesce(a.draft_instructor_name,'')), '') is null
     or a.draft_emp_id !~ '^[0-9]+$'
  then raise exception 'scheduling_agent_team_draft_ownership_required'
    using errcode='42501'; end if;

  approval_state := public.course_assignment_manager_approval_state(p_activity_id);
  if coalesce((approval_state->>'approval_required')::boolean,false)
    and coalesce(approval_state->>'request_status','') <> 'approved'
  then raise exception 'scheduling_manager_approval_required' using errcode='42501'; end if;

  -- Existing function rechecks instructor status, overlaps, hard violations, manual
  -- exceptions and the manager-approval trigger atomically under the caller JWT.
  confirmed := public.assign_activity_instructor(
     p_activity_id,a.draft_emp_id::bigint,a.draft_instructor_name,
     null,null,null,'approved','שיבוץ מתוך סוכן השיבוצים הארגוני'
  );
  return jsonb_build_object(
    'activityId',confirmed.row_id,
    'instructorId',confirmed.emp_id,
    'instructorName',confirmed.instructor_name,
    'startDate',confirmed.start_date,
    'endDate',confirmed.end_date,
    'state','confirmed'
  );
end
$$;

revoke all on function public.scheduling_agent_team_confirm_own_draft(text)
from public,anon;
grant execute on function public.scheduling_agent_team_confirm_own_draft(text)
to authenticated;
