-- Team agent: atomic schedule+draft staging and separately authorized confirmation.
-- Existing course validators, route cache and manager-approval/lock gates remain authoritative.
-- NEVER silently correct an ambiguous date. Never change an already dated activity here.
-- The only public grants below are to authenticated; every RPC calls the named-team gate.

create or replace function public.scheduling_agent_team_stage_schedule_batch(
  p_items jsonb
) returns jsonb language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  item jsonb;
  date_value jsonb;
  course public.activities;
  teacher public.contacts_instructors;
  entry_id text;
  emp bigint;
  start_t time;
  end_t time;
  dates jsonb;
  canonical jsonb;
  next_date date;
  prev_date date;
  first_date date;
  meeting_count integer;
  school_sector text;
  home_km numeric;
  target_location text;
  reason text;
  violations text[];
  existing_dates integer;
  saved public.activities;
  result_items jsonb := '[]'::jsonb;
  seen text[] := '{}'::text[];
  reported text;
begin
  perform public.scheduling_agent_team_assert_member();
  if jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) not between 1 and 5
  then raise exception 'scheduling_agent_invalid_selection'; end if;

  -- Stable row-lock order for a whole-school batch. Any failure rolls back ALL drafts.
  for item in select value from jsonb_array_elements(p_items) order by value->>'activityId' loop
    entry_id := coalesce(item->>'activityId','');
    begin
      if jsonb_typeof(item) <> 'object'
         or length(entry_id) not between 1 and 200
         or entry_id = any(seen)
         or coalesce(item->>'instructorId','') !~ '^[0-9]{1,12}$'
         or coalesce(item->>'startTime','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         or coalesce(item->>'endTime','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         or jsonb_typeof(item->'dates') is distinct from 'array'
      then raise exception 'scheduling_agent_invalid_selection'; end if;
      seen := array_append(seen,entry_id);
      emp := (item->>'instructorId')::bigint;
      if emp <= 0 then raise exception 'scheduling_agent_invalid_selection'; end if;
      start_t := (item->>'startTime')::time;
      end_t := (item->>'endTime')::time;
      if start_t >= end_t then raise exception 'scheduling_agent_schedule_invalid_time'; end if;

      select * into course from public.activities where row_id=entry_id for update;
      if not found or course.activity_season <> 'school_2027'
         or course.activity_type <> 'course' or course.status <> 'פתוח'
      then raise exception 'scheduling_agent_team_course_only'; end if;
      if course.emp_id is not null or course.instructor_assignment_locked
         or nullif(btrim(coalesce(course.draft_emp_id,'')),'') is not null
         or nullif(btrim(coalesce(course.emp_id_2,'')),'') is not null
      then raise exception 'scheduling_assignment_locked'; end if;

      -- Never overwrite previously scheduled, completed or teacher-agreed dates.
      select count(*) into existing_dates
      from generate_series(1,35) n
      where nullif(to_jsonb(course)->>('date_'||n),'') is not null;
      if existing_dates > 0 or course.start_date is not null or course.end_date is not null
         or course.start_time is not null or course.end_time is not null
      then raise exception 'scheduling_agent_schedule_only_new'; end if;

      if course.sessions is null or course.sessions !~ '^[0-9]+$'
         or jsonb_array_length(item->'dates') <> course.sessions::integer
         or jsonb_array_length(item->'dates') not between 1 and 35
      then raise exception 'scheduling_agent_schedule_count_mismatch'; end if;

      select * into teacher from public.contacts_instructors where emp_id=emp;
      if not found then raise exception 'instructor_not_found'; end if;
      if lower(coalesce(teacher.active::text,'yes')) in ('no','false','0','לא פעיל')
      then raise exception 'instructor_inactive'; end if;
      perform public.scheduling_lock_instructor_for_write(emp);

      school_sector := public.school_calendar_sector_for_school_id(course.school_id);
      if nullif(school_sector,'') is null then raise exception 'scheduling_school_sector_missing'; end if;
      canonical := '[]'::jsonb; prev_date := null; first_date := null;
      for date_value in select value from jsonb_array_elements(item->'dates') loop
        if jsonb_typeof(date_value) <> 'string'
           or (date_value #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        then raise exception 'scheduling_agent_schedule_invalid_date'; end if;
        begin
          next_date := (date_value #>> '{}')::date;
        exception when others then
          raise exception 'scheduling_agent_schedule_invalid_date';
        end;
        if to_char(next_date,'YYYY-MM-DD') <> (date_value #>> '{}')
           or next_date < date '2026-09-01' or next_date > date '2027-08-31'
           or (prev_date is not null and next_date <= prev_date)
        then raise exception 'scheduling_agent_schedule_invalid_date'; end if;
        if extract(dow from next_date)=6 and school_sector not in ('arab','druze')
        then raise exception 'scheduling_saturday_blocked'; end if;
        if not public.school_calendar_activity_exception_exists(entry_id,next_date)
           and exists (
             select 1 from public.school_calendar c
             where c.is_active=true and c.blocks_scheduling=true
               and public.school_calendar_event_applies(c.calendar_sector,school_sector)
               and next_date between c.start_date and coalesce(c.end_date,c.start_date)
           )
        then raise exception 'scheduling_school_calendar_blocked'; end if;
        canonical := canonical || jsonb_build_array(jsonb_build_object('date',next_date));
        prev_date := next_date;
        first_date := coalesce(first_date,next_date);
      end loop;

      target_location := public.scheduling_school_location(
        course.school_id,course.school,course.authority_id,course.authority);
      home_km := public.scheduling_cached_travel_distance_km(teacher.address,target_location);
      if home_km is null then raise exception 'scheduling_home_route_unverified'; end if;
      reason := nullif(btrim(coalesce(item->>'reason','')),'');
      if length(coalesce(reason,''))>500 then raise exception 'scheduling_agent_invalid_selection'; end if;
      if home_km>40 then
        reason := concat_ws(' · ',reason,'מרחק הנסיעה לבית הספר מעל מגבלה של 40 ק״מ');
      end if;

      -- Only the hours and a reversible DRAFT of meeting dates are set here.
      -- Official date_1..date_35 remain unchanged until the separately approved confirm RPC.
      update public.activities set
        start_time=start_t, end_time=end_t,
        draft_emp_id=emp::text,
        draft_instructor_name=teacher.full_name,
        draft_proposed_meetings=canonical,
        draft_created_by=auth.uid(),
        draft_created_at=now()
      where row_id=entry_id
      returning * into saved;

      if public.scheduling_course_conflict_exists(entry_id,emp)
      then raise exception 'scheduling_conflict_detected'; end if;
      violations := public.scheduling_manual_assignment_hard_violations(entry_id,emp);
      if 'scheduling_transition_distance_exceeded'=any(violations) then
        reason := concat_ws(' · ',reason,'המרחק בין הפעילויות גדול מ־30 ק״מ');
      end if;
      violations := array_remove(violations,'scheduling_transition_distance_exceeded');
      if coalesce(cardinality(violations),0)>0
      then raise exception '%',violations[1]; end if;

      reason := case
        when nullif(btrim(coalesce(reason,'')),'') is null then 'בחירה ידנית'
        else 'בחירה ידנית: '||reason
      end;
      insert into public.instructor_assignment_audit(
        activity_id,selected_emp_id,selected_instructor_name,
        decision_type,reason,previous_status,new_status
      ) values(
        entry_id,emp::text,teacher.full_name,'draft',reason,
        saved.instructor_assignment_status,saved.instructor_assignment_status
      );

      result_items := result_items || jsonb_build_array(jsonb_build_object(
        'activityId',entry_id,'instructorId',emp,
        'instructorName',teacher.full_name,'startTime',start_t,'endTime',end_t,
        'startDate',first_date,'endDate',prev_date,'meetingCount',jsonb_array_length(canonical),
        'draftCreatedAt',saved.draft_created_at,'activityUpdatedAt',saved.updated_at,'state','draft_saved',
        'approvalNeeded','check_manager_approval_state'));
    exception when others then
      get stacked diagnostics reported=message_text;
      -- Client maps only allowlisted public codes. No internal SQL text is shown.
      raise exception using message='scheduling_agent_batch_item_failed',
        detail=entry_id||'|'||reported;
    end;
  end loop;
  return jsonb_build_object('state','drafts_saved','allOrNothing',true,'items',result_items,
    'nextStep','Check manager approvals, request explicit final confirmation, then call confirm_schedule_batch.');
end;
$$;

-- Promote an already-approved (caller-owned) schedule draft into official dates,
-- then confirm the instructor through existing validated dashboard RPCs.
-- All items run in ONE transaction: if any cannot confirm, no official dates/assignments persist.
create or replace function public.scheduling_agent_team_confirm_schedule_batch(
  p_items jsonb
) returns jsonb language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  item jsonb;
  course public.activities;
  meeting jsonb;
  ids text[] := '{}'::text[];
  entry_id text;
  expected_at timestamptz;
  expected_updated_at timestamptz;
  fields text;
  i integer;
  meeting_date date;
  dates jsonb;
  confirmed jsonb;
  results jsonb := '[]'::jsonb;
  error_msg text;
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
      dates := course.draft_proposed_meetings;
      if jsonb_typeof(dates) <> 'array' or jsonb_array_length(dates) not between 1 and 35
         or course.sessions !~ '^[0-9]+$'
         or jsonb_array_length(dates)<>course.sessions::integer
      then raise exception 'scheduling_agent_schedule_count_mismatch'; end if;

      fields := '';
      i := 0;
      for meeting in select value from jsonb_array_elements(dates) loop
        i := i+1;
        meeting_date := (meeting->>'date')::date;
        fields := fields || format('%I=%L::date,','date_'||i,meeting_date::text);
      end loop;
      for i in (i+1)..35 loop
        fields := fields || format('%I=null,','date_'||i);
      end loop;
      -- Dynamic identifiers are generated exclusively from 1..35; date literals are quoted.
      execute 'update public.activities set '|| fields ||
        'start_date=$1,end_date=$2 where row_id=$3'
      using (dates->0->>'date')::date,
            (dates->(jsonb_array_length(dates)-1)->>'date')::date,
            entry_id;

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
$$;

revoke all on function public.scheduling_agent_team_stage_schedule_batch(jsonb)
  from public, anon;
revoke all on function public.scheduling_agent_team_confirm_schedule_batch(jsonb)
  from public, anon;
grant execute on function public.scheduling_agent_team_stage_schedule_batch(jsonb)
  to authenticated;
grant execute on function public.scheduling_agent_team_confirm_schedule_batch(jsonb)
  to authenticated;

-- Include non-sensitive school/class identity in staff snapshot to avoid wrong group selection.
-- Preserve all previous whitelisted keys and the team's existing JWT restrictions.
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
