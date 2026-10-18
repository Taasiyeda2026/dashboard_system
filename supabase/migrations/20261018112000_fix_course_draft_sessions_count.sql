-- Reconcile draft scheduling meeting counts with activities.sessions (2026-10-18).
-- Source: verified live 2027 scheduling functions in project szinlhjuwyiyszdpsdop.
-- This migration contains NO data backfill, schedule updates, new assignments or manager approvals.
-- Existing permission and conflict validators remain in force.
-- The count test is logically independent from first-half period warnings.

CREATE OR REPLACE FUNCTION public.scheduling_validate_proposed_meetings(p_activity_id text, p_meetings jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  target public.activities;
  item jsonb;
  item_date date;
  last_date date;
  canonical jsonb := '[]'::jsonb;
  official_count integer;
  required_count integer;
  sessions_text text;
  effective_end time without time zone;
  activity_sector text;
begin
  select * into target from public.activities where row_id = p_activity_id;
  if not found then raise exception 'activity_not_found'; end if;

  activity_sector := public.school_calendar_sector_for_school_id(target.school_id);
  if nullif(activity_sector, '') is null then raise exception 'scheduling_school_sector_missing'; end if;

  if target.start_time is null or target.end_time is null or target.start_time >= target.end_time then
    raise exception 'scheduling_activity_hours_missing';
  end if;
  if jsonb_typeof(p_meetings) is distinct from 'array'
  then raise exception 'scheduling_proposed_dates_invalid'; end if;
  if jsonb_array_length(p_meetings) not between 1 and 35
  then raise exception 'scheduling_proposed_dates_invalid'; end if;

  -- sessions is the authoritative course length, including wholly undated courses.
  -- Reject malformed counts before casting; never interpret missing sessions as zero.
  sessions_text := btrim(coalesce(target.sessions, ''));
  if sessions_text !~ '^[0-9]{1,2}

  for item in select value from jsonb_array_elements(p_meetings) loop
    if nullif(item->>'date', '') is null then raise exception 'scheduling_proposed_dates_invalid'; end if;
    begin
      item_date := (item->>'date')::date;
    exception when others then
      raise exception 'scheduling_proposed_dates_invalid';
    end;

    if extract(dow from item_date) = 6 and coalesce(activity_sector, '') not in ('arab','druze') then raise exception 'scheduling_saturday_blocked'; end if;
    if not public.school_calendar_activity_exception_exists(target.row_id, item_date)
      and exists (
        select 1 from public.school_calendar c
        where c.is_active = true
          and c.blocks_scheduling = true
          and c.start_date is not null
          and public.school_calendar_event_applies(c.calendar_sector, activity_sector)
          and item_date between c.start_date and coalesce(c.end_date, c.start_date)
      )
    then raise exception 'scheduling_school_calendar_blocked'; end if;
    if last_date is not null and item_date <= last_date then raise exception 'scheduling_proposed_dates_invalid'; end if;

    effective_end := public.scheduling_effective_end_time(p_activity_id, item_date, target.end_time);
    if effective_end is null or effective_end <= target.start_time then raise exception 'scheduling_activity_hours_missing'; end if;
    last_date := item_date;
    canonical := canonical || jsonb_build_array(jsonb_build_object(
      'date', item_date,
      'start_time', target.start_time,
      'end_time', effective_end
    ));
  end loop;
  return canonical;
end
$function$
 then
    raise exception 'scheduling_activity_sessions_invalid';
  end if;
  required_count := sessions_text::integer;
  if required_count not between 1 and 35 then
    raise exception 'scheduling_activity_sessions_invalid';
  end if;
  if jsonb_array_length(p_meetings) <> required_count then
    raise exception 'scheduling_proposed_meeting_count_mismatch';
  end if;

  select count(*) into official_count
  from generate_series(1,35) n
  where nullif(to_jsonb(target)->>('date_' || n), '') is not null;
  -- A blank official calendar is normal before a first confirmed assignment.
  -- A partially populated existing calendar is NOT permission to overwrite it.
  if official_count > 0 and official_count <> required_count then
    raise exception 'scheduling_existing_official_meeting_count_conflict';
  end if;

  for item in select value from jsonb_array_elements(p_meetings) loop
    if nullif(item->>'date', '') is null then raise exception 'scheduling_proposed_dates_invalid'; end if;
    begin
      item_date := (item->>'date')::date;
    exception when others then
      raise exception 'scheduling_proposed_dates_invalid';
    end;

    if extract(dow from item_date) = 6 and coalesce(activity_sector, '') not in ('arab','druze') then raise exception 'scheduling_saturday_blocked'; end if;
    if not public.school_calendar_activity_exception_exists(target.row_id, item_date)
      and exists (
        select 1 from public.school_calendar c
        where c.is_active = true
          and c.blocks_scheduling = true
          and c.start_date is not null
          and public.school_calendar_event_applies(c.calendar_sector, activity_sector)
          and item_date between c.start_date and coalesce(c.end_date, c.start_date)
      )
    then raise exception 'scheduling_school_calendar_blocked'; end if;
    if last_date is not null and item_date <= last_date then raise exception 'scheduling_proposed_dates_invalid'; end if;

    effective_end := public.scheduling_effective_end_time(p_activity_id, item_date, target.end_time);
    if effective_end is null or effective_end <= target.start_time then raise exception 'scheduling_activity_hours_missing'; end if;
    last_date := item_date;
    canonical := canonical || jsonb_build_array(jsonb_build_object(
      'date', item_date,
      'start_time', target.start_time,
      'end_time', effective_end
    ));
  end loop;
  return canonical;
end
$function$;

CREATE OR REPLACE FUNCTION public.assign_activity_instructor_with_dates(p_activity_id text, p_emp_id bigint, p_instructor_name text, p_proposed_meetings jsonb, p_top_emp_id bigint DEFAULT NULL::bigint, p_selected_score integer DEFAULT NULL::integer, p_top_score integer DEFAULT NULL::integer, p_decision_type text DEFAULT 'approved'::text, p_reason text DEFAULT NULL::text)
 RETURNS activities
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare result public.activities; target public.activities; canonical jsonb; caller_role text:=public.app_current_role();
begin
  if not public.app_has_permission('view_operations_scheduling') or not exists(select 1 from public.users u where u.auth_user_id=auth.uid() and u.is_active) then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
  perform public.scheduling_lock_instructor_for_write(p_emp_id);
  select * into target from public.activities where row_id=p_activity_id for update;
  if not found then raise exception 'activity_not_found'; end if;
  if target.activity_season<>'school_2027' then raise exception 'scheduling_activity_not_school_2027'; end if;
  if lower(btrim(coalesce(target.activity_type::text,''))) not in ('course', 'program', 'קורס', 'קורסים', 'תוכנית', 'תכנית', 'workshop', 'סדנה', 'סדנא', 'סדנאות', 'tour', 'סיור', 'סיורים') then raise exception 'scheduling_activity_not_course'; end if;
  if lower(btrim(coalesce(target.status::text,''))) not in ('פתוח','open') then raise exception 'scheduling_activity_not_open'; end if;
  if target.emp_id is not null or target.instructor_assignment_locked is true
    or nullif(btrim(coalesce(target.emp_id_2, '')), '') is not null
  then raise exception 'scheduling_assignment_locked'; end if;
  if nullif(btrim(coalesce(target.draft_emp_id, '')), '') is not null
     and target.draft_emp_id <> p_emp_id::text
  then raise exception 'scheduling_draft_changed'; end if;

  canonical:=public.scheduling_validate_proposed_meetings(p_activity_id,p_proposed_meetings);
  -- An existing saved draft is an immutable, manager-reviewed set of dates.
  if target.draft_proposed_meetings is not null and (
    jsonb_typeof(target.draft_proposed_meetings) <> 'array'
    or jsonb_array_length(target.draft_proposed_meetings) <> jsonb_array_length(canonical)
    or exists(
      select 1 from jsonb_array_elements(target.draft_proposed_meetings) with ordinality m(meeting,n)
      where nullif(m.meeting->>'date', '') is distinct from (canonical->(m.n-1)::integer->>'date')
    )
  ) then raise exception 'scheduling_draft_meetings_changed'; end if;

  -- This approval RPC must not silently move previously official dates.
  if exists (
    select 1 from generate_series(1,35) n
    where nullif(to_jsonb(target)->>('date_'||n),'')
      is distinct from (canonical->(n-1)->>'date')
  ) and (
    target.start_date is not null or target.end_date is not null
    or exists(select 1 from generate_series(1,35) n
      where nullif(to_jsonb(target)->>('date_'||n),'') is not null)
  ) then raise exception 'scheduling_existing_official_meetings_protected'; end if;

  perform public.scheduling_set_activity_meetings(p_activity_id,canonical);
  result:=public.assign_activity_instructor(p_activity_id,p_emp_id,p_instructor_name,p_top_emp_id,p_selected_score,p_top_score,p_decision_type,p_reason);
  update public.activities set draft_proposed_meetings=null where row_id=p_activity_id returning * into result;
  return result;
end $function$;

CREATE OR REPLACE FUNCTION public.scheduling_agent_team_confirm_own_draft(p_activity_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- Finalization is the only point where the reversible draft dates become
  -- official. Never mark an undated course confirmed.
  if jsonb_typeof(a.draft_proposed_meetings) = 'array'
     and jsonb_array_length(a.draft_proposed_meetings) > 0
  then
    confirmed := public.assign_activity_instructor_with_dates(
      p_activity_id,a.draft_emp_id::bigint,a.draft_instructor_name,
      a.draft_proposed_meetings,
      null,null,null,'approved','שיבוץ מתוך סוכן השיבוצים הארגוני'
    );
  elsif exists (
    select 1 from generate_series(1,35) n
    where nullif(to_jsonb(a)->>('date_'||n),'') is not null
  ) then
    confirmed := public.assign_activity_instructor(
      p_activity_id,a.draft_emp_id::bigint,a.draft_instructor_name,
      null,null,null,'approved','שיבוץ מתוך סוכן השיבוצים הארגוני'
    );
  else
    raise exception 'scheduling_activity_dates_missing';
  end if;
  return jsonb_build_object(
    'activityId',confirmed.row_id,
    'instructorId',confirmed.emp_id,
    'instructorName',confirmed.instructor_name,
    'startDate',confirmed.start_date,
    'endDate',confirmed.end_date,
    'state','confirmed'
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.scheduling_agent_team_confirm_schedule_batch(p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '45s'
AS $function$
declare
  item jsonb;
  course public.activities;
  meeting jsonb;
  ids text[] := '{}'::text[];
  entry_id text;
  expected_at timestamptz;
  expected_updated_at timestamptz;
  dates jsonb;
  confirmed jsonb;
  results jsonb := '[]'::jsonb;
  error_msg text;
  approval_details jsonb;
begin
  perform public.scheduling_agent_team_assert_member();
  if jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) not between 1 and 5
  then raise exception 'scheduling_agent_invalid_selection'; end if;

  for item in select value from jsonb_array_elements(p_items) order by value->>'activityId' loop
    entry_id := coalesce(item->>'activityId','');
    begin
      if jsonb_typeof(item) <> 'object'
         or length(entry_id) not between 1 and 200 or entry_id = any(ids)
         or nullif(item->>'draftCreatedAt','') is null
         or nullif(item->>'activityUpdatedAt','') is null
      then raise exception 'scheduling_agent_invalid_selection'; end if;
      ids := array_append(ids,entry_id);
      begin
        expected_at := (item->>'draftCreatedAt')::timestamptz;
        expected_updated_at := (item->>'activityUpdatedAt')::timestamptz;
      exception when others then raise exception 'scheduling_agent_invalid_selection'; end;
      select * into course from public.activities where row_id=entry_id for update;
      if not found or course.activity_season <> 'school_2027' or course.status <> 'פתוח'
         or course.activity_type <> 'course'
      then raise exception 'scheduling_agent_team_course_only'; end if;
      if course.draft_created_by is distinct from auth.uid()
         or course.draft_created_at is distinct from expected_at
         or course.updated_at is distinct from expected_updated_at
         or course.draft_emp_id is null or course.draft_proposed_meetings is null
         or course.emp_id is not null or course.instructor_assignment_locked
      then raise exception 'scheduling_agent_team_draft_changed'; end if;
      if course.start_time is null or course.end_time is null or course.start_time>=course.end_time
      then raise exception 'scheduling_activity_hours_missing'; end if;
      if course.start_date is not null or course.end_date is not null
         or exists(select 1 from generate_series(1,35) n
           where nullif(to_jsonb(course)->>('date_'||n),'') is not null)
      then raise exception 'scheduling_agent_schedule_stale'; end if;
      if public.scheduling_agent_team_draft_policy_applies(entry_id,course.draft_emp_id::bigint) then
        approval_details := public.scheduling_agent_team_draft_approval_details(entry_id,course.draft_emp_id::bigint);
        if jsonb_array_length(approval_details->'blocking_violations')>0 then
          raise exception '%',approval_details->'blocking_violations'->>0;
        end if;
      end if;
      dates := course.draft_proposed_meetings;
      if jsonb_typeof(dates) <> 'array' or jsonb_array_length(dates) not between 1 and 35
         or course.sessions !~ '^[0-9]+$'
         or jsonb_array_length(dates)<>course.sessions::integer
      then raise exception 'scheduling_agent_schedule_count_mismatch'; end if;

      -- Check the staged series BEFORE any official date writes. The nested
      -- confirmation RPC saves all dates and the instructor in the same transaction.
      perform public.scheduling_validate_proposed_meetings(entry_id,dates);
      confirmed := public.scheduling_agent_team_confirm_own_draft(entry_id);
      results := results || jsonb_build_array(confirmed);
    exception when others then
      get stacked diagnostics error_msg=message_text;
      raise exception using message='scheduling_agent_batch_item_failed',
        detail=entry_id||'|'||error_msg;
    end;
  end loop;
  return jsonb_build_object('state','confirmed','allOrNothing',true,'items',results);
end;
$function$;

CREATE OR REPLACE FUNCTION public.scheduling_agent_team_read_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  rows jsonb;
  preflight jsonb;
  can_recommend boolean;
begin
  perform public.scheduling_agent_team_assert_member();
  preflight := public.scheduling_agent_team_planning_status();
  can_recommend := (preflight->>'planningCurrent')::boolean;
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'activityId', a.row_id,
      'school', a.school,
      'grade', a.grade,
      'classGroup', a.class_group,
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
      'draftMeetingCount', case when jsonb_typeof(a.draft_proposed_meetings)='array' then jsonb_array_length(a.draft_proposed_meetings) else 0 end,
      'assignmentLocked', a.instructor_assignment_locked,
      'draftInstructorId', a.draft_emp_id,
      'draftInstructorName', a.draft_instructor_name,
      'needsRecalc', coalesce(r.needs_recalc,false),
      'options', (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'optionIndex', (opt.ordinality-1)::integer,
            'instructorId', opt.value->>'instructorEmpId',
            'instructorName', opt.value->>'instructorName',
            'eligible', opt.value->'eligible',
            'routeVerified', opt.value->'routeVerified',
            'score', opt.value->'score',
            'sameSchoolMeetingCount', opt.value->'sameSchoolMeetingCount',
            'sameAuthorityMeetingCount', opt.value->'sameAuthorityMeetingCount',
            'newWorkDayMeetingCount', opt.value->'newWorkDayMeetingCount',
            'estimatedTravelKm', opt.value->'relevantTravelDistance',
            'estimatedTravelMinutes', opt.value->'relevantTravelMinutes',
            'nonTravelWaitingMinutes', opt.value->'nonTravelWaitingMinutes',
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
          ) order by opt.ordinality), '[]'::jsonb)
        from jsonb_array_elements(
          case when can_recommend and r.needs_recalc is distinct from true
              and jsonb_typeof(r.row_data->'options')='array'
            then r.row_data->'options' else '[]'::jsonb end
        ) with ordinality as opt(value, ordinality)
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

  return jsonb_build_object(
    'mode','team_scheduling_only',
    'sourceRevision',(select revision::text from public.scheduling_planning_source_state where singleton),
    'workspaceRevision',(select revision::text from public.scheduling_planning_workspaces where period_key='year' and district=''),
    'planningCurrent',can_recommend,
    'planningStatus',preflight,
    'rows',rows
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.scheduling_agent_team_read_staged_schedule(p_activity_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    'draftMeetingCount', case when jsonb_typeof(a.draft_proposed_meetings)='array' then jsonb_array_length(a.draft_proposed_meetings) else 0 end,
    'officialMeetingCount', (select count(*) from generate_series(1,35) n where nullif(to_jsonb(a)->>('date_'||n),'') is not null),
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
$function$;
