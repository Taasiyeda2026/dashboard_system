-- Organizational ChatGPT scheduling agent: least-privilege team boundary.
-- Deploy only with explicit owner approval. No existing owner RPCs are modified.
-- Never expose raw Google Sheets, contacts, budget, payroll, financial or configuration fields.

create or replace function public.scheduling_agent_team_assert_member()
returns void language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null
     or not public.app_has_permission('view_operations_scheduling')
     or not exists (
       select 1 from public.users u
       where u.auth_user_id = auth.uid() and u.is_active is true
       and (
         (u.auth_user_id = (select c.approver_id from public.scheduling_agent_control c where c.singleton)
          and u.role = 'admin' and lower(u.email) = 'idann@think.org.il')
         or (lower(u.email) = 'edenc@think.org.il' and u.role = 'operation_manager')
         or (lower(u.email) = 'esraas@think.org.il' and u.role = 'business_development_manager')
       )
     )
  then
    raise exception 'scheduling_agent_team_permission_denied' using errcode = '42501';
  end if;
end
$$;

create or replace function public.scheduling_agent_team_identity()
returns jsonb language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  perform public.scheduling_agent_team_assert_member();
  return jsonb_build_object('authorized',true);
end
$$;

create or replace function public.scheduling_agent_team_read_snapshot()
returns jsonb language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare rows jsonb;
begin
  perform public.scheduling_agent_team_assert_member();
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'activityId', a.row_id,
      'school', a.school,
      'schoolId', a.school_id,
      'authority', a.authority,
      'program', a.activity_name,
      'programId', a.activity_no,
      'instructorId', a.emp_id,
      'instructorName', a.instructor_name,
      'startDate', a.start_date,
      'endDate', a.end_date,
      'startTime', a.start_time,
      'endTime', a.end_time,
      'sessions', a.sessions,
      'assignmentLocked', a.instructor_assignment_locked,
      'draftInstructorId', a.draft_emp_id,
      'draftInstructorName', a.draft_instructor_name,
      'needsRecalc', coalesce(r.needs_recalc,false),
      'options', (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'instructorId', opt.value->>'instructorEmpId',
            'instructorName', opt.value->>'instructorName',
            'eligible', opt.value->'eligible',
            'score', opt.value->'score',
            'reason', opt.value->>'recommendationReason',
            'meetings', (
              select coalesce(jsonb_agg(jsonb_build_object(
                'date', mt.value->>'date',
                'startTime', mt.value->>'start_time',
                'endTime', mt.value->>'end_time',
                'meetingNo', mt.value->>'meeting_no'
              )), '[]'::jsonb)
              from jsonb_array_elements(
                case when jsonb_typeof(opt.value->'meetings')='array'
                  then opt.value->'meetings' else '[]'::jsonb end
              ) as mt(value)
            )
          )
        ), '[]'::jsonb)
        from jsonb_array_elements(
          case when jsonb_typeof(r.row_data->'options')='array'
            then r.row_data->'options' else '[]'::jsonb end
        ) as opt(value)
      )
    ) order by a.row_id
  ), '[]'::jsonb)
  into rows
  from public.activities a
  left join public.scheduling_planning_workspaces w
    on w.period_key='year' and w.district=''
  left join public.scheduling_planning_rows r
    on r.workspace_id=w.id and r.activity_id=a.row_id
  where a.activity_season='school_2027'
    and a.status='פתוח'
    and a.activity_type='course'
    and a.activity_no is distinct from '13990'
    and coalesce(a.activity_name,'') not like '%התנסות בתעשייה%';

  return jsonb_build_object('mode','team_scheduling_only','rows',rows);
end
$$;

-- Only stages an existing, validation-checked manual assignment as the actual caller.
-- Does not authorize any distance exception or approve any assignment.
create or replace function public.scheduling_agent_team_stage_manual_draft(
  p_activity_id text, p_emp_id bigint, p_reason text default null
) returns jsonb language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  instructor_name text;
  staged public.activities;
  target public.activities;
  instructor public.contacts_instructors;
  target_location text;
  home_distance_km numeric;
  effective_reason text;
  hard_violations text[];
begin
  perform public.scheduling_agent_team_assert_member();
  if p_activity_id is null or length(p_activity_id) not between 1 and 200
    or p_emp_id is null or p_emp_id <= 0
    or length(coalesce(p_reason,'')) > 500
  then raise exception 'scheduling_agent_invalid_selection'; end if;
  select * into target from public.activities where row_id=p_activity_id;
  if not found or target.activity_season <> 'school_2027'
    or target.activity_type <> 'course' or target.status <> 'פתוח'
  then raise exception 'scheduling_agent_team_course_only'; end if;
  select * into instructor from public.contacts_instructors where emp_id=p_emp_id;
  if not found then raise exception 'instructor_not_found'; end if;
  instructor_name := instructor.full_name;

  -- Distance exceptions are derived from the trusted route cache, NEVER from
  -- the staff member's editable reason. Prevent the old 'בחירה ידנית' shortcut
  -- from accidentally skipping the existing >=60 km dashboard approval rule.
  target_location := public.scheduling_school_location(
    target.school_id, target.school, target.authority_id, target.authority
  );
  home_distance_km := public.scheduling_cached_travel_distance_km(instructor.address,target_location);
  if home_distance_km is null then
    raise exception 'scheduling_home_route_unverified';
  end if;
  effective_reason := nullif(btrim(coalesce(p_reason,'')), '');
  if home_distance_km > 40 then
    effective_reason := concat_ws(' · ',effective_reason,
      'מרחק הנסיעה לבית הספר מעל מגבלה של 40 ק״מ');
  end if;

  hard_violations := public.scheduling_manual_assignment_hard_violations(p_activity_id,p_emp_id);
  if 'scheduling_transition_distance_exceeded'=any(hard_violations) then
    effective_reason := concat_ws(' · ',effective_reason,
      'המרחק בין הפעילויות גדול מ־20 ק״מ');
  end if;

  select * into staged from public.save_course_assignment_manual_draft(
    p_activity_id, p_emp_id, instructor_name, null, null, null, effective_reason
  );
  return jsonb_build_object(
    'activityId',staged.row_id,
    'draftInstructorId',staged.draft_emp_id,
    'draftInstructorName',staged.draft_instructor_name,
    'state','draft_saved',
    'approvalNeeded','check_manager_approval_state'
  );
end
$$;

-- Submits the SAME approval request used by the dashboard, not a parallel queue.
-- Team members can submit only drafts actually created under their own auth.uid().
create or replace function public.scheduling_agent_team_submit_manager_approval(
  p_activity_id text
) returns jsonb language plpgsql security definer
set search_path = public, pg_temp
as $$
declare a public.activities; submitted public.edit_requests;
begin
  perform public.scheduling_agent_team_assert_member();
  if p_activity_id is null or length(p_activity_id) not between 1 and 200
  then raise exception 'scheduling_agent_invalid_selection'; end if;
  select * into a from public.activities where row_id=p_activity_id;
  if not found or a.draft_created_by is distinct from auth.uid()
  then raise exception 'scheduling_agent_team_draft_ownership_required' using errcode='42501'; end if;
  select * into submitted from public.submit_course_assignment_manager_approval(p_activity_id);
  return jsonb_build_object('requestId',submitted.request_id,'status',submitted.status,
    'activityId',submitted.source_row_id,'requestedBy',submitted.requested_by_name);
end
$$;

create or replace function public.scheduling_agent_team_manager_approval_state(
  p_activity_id text
) returns jsonb language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  perform public.scheduling_agent_team_assert_member();
  return public.course_assignment_manager_approval_state(p_activity_id);
end
$$;

revoke all on function public.scheduling_agent_team_assert_member() from public, anon, authenticated;
revoke all on function public.scheduling_agent_team_identity() from public, anon;
revoke all on function public.scheduling_agent_team_read_snapshot() from public, anon;
revoke all on function public.scheduling_agent_team_stage_manual_draft(text,bigint,text) from public, anon;
revoke all on function public.scheduling_agent_team_submit_manager_approval(text) from public, anon;
revoke all on function public.scheduling_agent_team_manager_approval_state(text) from public, anon;

grant execute on function public.scheduling_agent_team_identity() to authenticated;
grant execute on function public.scheduling_agent_team_read_snapshot() to authenticated;
grant execute on function public.scheduling_agent_team_stage_manual_draft(text,bigint,text) to authenticated;
grant execute on function public.scheduling_agent_team_submit_manager_approval(text) to authenticated;
grant execute on function public.scheduling_agent_team_manager_approval_state(text) to authenticated;
