-- Allow Saturday scheduling only for Arab-sector schools.
-- Saturday still requires explicit instructor availability; all other sectors remain blocked.

CREATE OR REPLACE FUNCTION public.confirm_scheduling_planning_draft(p_period_key text, p_district text, p_activity_id text, p_expected_revision bigint DEFAULT NULL::bigint)
 RETURNS activities
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  scope_period text := nullif(btrim(coalesce(p_period_key, '')), '');
  scope_district text := btrim(coalesce(p_district, ''));
  v_activity_id text := nullif(btrim(coalesce(p_activity_id, '')), '');
  workspace public.scheduling_planning_workspaces;
  planning_row public.scheduling_planning_rows;
  target public.activities;
  selected_instructor public.contacts_instructors;
  option jsonb;
  meetings jsonb;
  canonical jsonb := '[]'::jsonb;
  item jsonb;
  meeting_date date;
  meeting_start time without time zone;
  meeting_end time without time zone;
  first_start time without time zone;
  first_end time without time zone;
  first_date date;
  last_date date;
  previous_date date;
  expected_count integer := 0;
  official_count integer := 0;
  idx integer := 1;
  v_emp_id bigint;
  v_score integer;
  violations text[];
  result public.activities;
  caller_role text := public.app_current_role();
begin
  if caller_role is null
    or caller_role not in ('admin','operation_manager')
    or not exists (
      select 1 from public.users u
      where u.auth_user_id = auth.uid() and u.is_active is true
    )
  then
    raise exception 'scheduling_permission_denied' using errcode = '42501';
  end if;

  if scope_period is null or v_activity_id is null then
    raise exception 'planning_scope_invalid';
  end if;

  select * into workspace
  from public.scheduling_planning_workspaces
  where period_key = scope_period and district = scope_district
  for update;
  if not found then raise exception 'planning_workspace_missing'; end if;

  if p_expected_revision is not null and workspace.revision <> p_expected_revision then
    raise exception 'planning_revision_conflict';
  end if;

  select * into planning_row
  from public.scheduling_planning_rows
  where workspace_id = workspace.id and activity_id = v_activity_id
  for update;
  if not found or planning_row.locked_option is null then
    raise exception 'planning_draft_missing';
  end if;

  option := planning_row.locked_option;
  if coalesce(option->>'instructorEmpId', '') !~ '^[0-9]+$' then
    raise exception 'planning_draft_invalid';
  end if;
  v_emp_id := (option->>'instructorEmpId')::bigint;
  meetings := option->'meetings';

  if jsonb_typeof(meetings) <> 'array'
    or jsonb_array_length(meetings) = 0
    or jsonb_array_length(meetings) > 35
  then
    raise exception 'planning_draft_invalid';
  end if;

  perform public.scheduling_lock_instructor_for_write(v_emp_id);

  select * into selected_instructor
  from public.contacts_instructors
  where emp_id = v_emp_id;
  if not found then raise exception 'instructor_not_found'; end if;
  if lower(coalesce(selected_instructor.active::text, 'yes')) in ('no','false','0','לא פעיל') then
    raise exception 'instructor_inactive';
  end if;

  select * into target
  from public.activities
  where row_id = v_activity_id
  for update;
  if not found then raise exception 'activity_not_found'; end if;

  if target.activity_season <> 'school_2027' then
    raise exception 'scheduling_activity_not_school_2027';
  end if;
  if lower(btrim(coalesce(target.status::text, ''))) not in ('פתוח','open') then
    raise exception 'scheduling_activity_not_open';
  end if;
  if target.instructor_assignment_locked
    or target.emp_id is not null
    or nullif(btrim(coalesce(target.instructor_name, '')), '') is not null
  then
    raise exception 'scheduling_assignment_locked';
  end if;
  if nullif(btrim(coalesce(target.draft_emp_id, '')), '') is not null then
    raise exception 'scheduling_draft_exists';
  end if;

  if planning_row.activity_updated_at is not null
    and target.updated_at is distinct from planning_row.activity_updated_at
  then
    raise exception 'planning_activity_changed';
  end if;

  if coalesce(target.sessions, '') ~ '^\\d+$' then
    expected_count := target.sessions::integer;
  end if;
  select count(*) into official_count
  from generate_series(1, 35) n
  where nullif(to_jsonb(target)->>('date_' || n), '') is not null;
  if expected_count <= 0 then expected_count := official_count; end if;
  if expected_count > 0 and jsonb_array_length(meetings) <> expected_count then
    raise exception 'scheduling_proposed_meeting_count_mismatch';
  end if;

  for item in select value from jsonb_array_elements(meetings) loop
    if nullif(item->>'date', '') is null
      or nullif(item->>'start_time', '') is null
      or nullif(item->>'end_time', '') is null
    then
      raise exception 'planning_draft_invalid';
    end if;
    begin
      meeting_date := (item->>'date')::date;
      meeting_start := (item->>'start_time')::time;
      meeting_end := (item->>'end_time')::time;
    exception when others then
      raise exception 'planning_draft_invalid';
    end;

    if meeting_start >= meeting_end then raise exception 'planning_draft_invalid'; end if;
    if extract(dow from meeting_date) = 6 and coalesce(public.school_calendar_sector_for_school_id(target.school_id), '') <> 'arab' then raise exception 'scheduling_saturday_blocked'; end if;
    if previous_date is not null and meeting_date <= previous_date then
      raise exception 'planning_draft_invalid';
    end if;

    first_start := coalesce(first_start, meeting_start);
    first_end := coalesce(first_end, meeting_end);
    if meeting_start <> first_start or meeting_end <> first_end then
      raise exception 'planning_draft_variable_hours_unsupported';
    end if;

    first_date := coalesce(first_date, meeting_date);
    last_date := meeting_date;
    previous_date := meeting_date;
    canonical := canonical || jsonb_build_array(jsonb_build_object(
      'date', meeting_date,
      'meeting_no', idx,
      'start_time', meeting_start,
      'end_time', meeting_end
    ));
    idx := idx + 1;
  end loop;

  -- Write the complete schedule in one statement so activity-date/calendar
  -- triggers never observe a partially replaced meeting series. Any later
  -- validation failure rolls the transaction back.
  update public.activities
  set start_time = first_start,
      end_time = first_end,
      start_date = first_date,
      end_date = last_date,
      date_1 = nullif(canonical->0->>'date', '')::date,
      date_2 = nullif(canonical->1->>'date', '')::date,
      date_3 = nullif(canonical->2->>'date', '')::date,
      date_4 = nullif(canonical->3->>'date', '')::date,
      date_5 = nullif(canonical->4->>'date', '')::date,
      date_6 = nullif(canonical->5->>'date', '')::date,
      date_7 = nullif(canonical->6->>'date', '')::date,
      date_8 = nullif(canonical->7->>'date', '')::date,
      date_9 = nullif(canonical->8->>'date', '')::date,
      date_10 = nullif(canonical->9->>'date', '')::date,
      date_11 = nullif(canonical->10->>'date', '')::date,
      date_12 = nullif(canonical->11->>'date', '')::date,
      date_13 = nullif(canonical->12->>'date', '')::date,
      date_14 = nullif(canonical->13->>'date', '')::date,
      date_15 = nullif(canonical->14->>'date', '')::date,
      date_16 = nullif(canonical->15->>'date', '')::date,
      date_17 = nullif(canonical->16->>'date', '')::date,
      date_18 = nullif(canonical->17->>'date', '')::date,
      date_19 = nullif(canonical->18->>'date', '')::date,
      date_20 = nullif(canonical->19->>'date', '')::date,
      date_21 = nullif(canonical->20->>'date', '')::date,
      date_22 = nullif(canonical->21->>'date', '')::date,
      date_23 = nullif(canonical->22->>'date', '')::date,
      date_24 = nullif(canonical->23->>'date', '')::date,
      date_25 = nullif(canonical->24->>'date', '')::date,
      date_26 = nullif(canonical->25->>'date', '')::date,
      date_27 = nullif(canonical->26->>'date', '')::date,
      date_28 = nullif(canonical->27->>'date', '')::date,
      date_29 = nullif(canonical->28->>'date', '')::date,
      date_30 = nullif(canonical->29->>'date', '')::date,
      date_31 = nullif(canonical->30->>'date', '')::date,
      date_32 = nullif(canonical->31->>'date', '')::date,
      date_33 = nullif(canonical->32->>'date', '')::date,
      date_34 = nullif(canonical->33->>'date', '')::date,
      date_35 = nullif(canonical->34->>'date', '')::date
  where row_id = v_activity_id;

  violations := public.scheduling_course_instructor_violations(v_activity_id, v_emp_id, true);
  if coalesce(array_length(violations, 1), 0) > 0 then
    raise exception '%', violations[1];
  end if;
  perform public.scheduling_assert_assignment_calendar(v_activity_id, v_emp_id, canonical);

  v_score := case
    when coalesce(option->>'score', '') ~ '^-?\\d+(?:\\.\\d+)?$'
      then round((option->>'score')::numeric)::integer
    else null
  end;

  result := public.assign_activity_instructor(
    v_activity_id,
    v_emp_id,
    selected_instructor.full_name,
    v_emp_id,
    v_score,
    v_score,
    'approved',
    'אישור טיוטת תכנון'
  );

  perform public.set_scheduling_planning_lock(
    scope_period,
    scope_district,
    v_activity_id,
    null,
    workspace.revision
  );

  return result;
end
$function$;

CREATE OR REPLACE FUNCTION public.scheduling_assert_proposed_eligibility(p_activity_id text, p_emp_id bigint, p_meetings jsonb)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  target public.activities;
  selected public.contacts_instructors;
  profile public.instructor_scheduling_profiles;
  meeting jsonb;
  availability record;
  v_weekday integer;
  meeting_date date;
  meeting_start time without time zone;
  meeting_end time without time zone;
begin
  select * into target from public.activities where row_id = p_activity_id;
  if not found then raise exception 'activity_not_found'; end if;
  p_meetings := public.scheduling_validate_proposed_meetings(p_activity_id, p_meetings);

  select * into selected from public.contacts_instructors where emp_id = p_emp_id;
  if not found then raise exception 'instructor_not_found'; end if;
  if lower(coalesce(selected.active::text, 'yes')) in ('no','false','0','לא פעיל') then raise exception 'instructor_inactive'; end if;
  if nullif(btrim(coalesce(selected.address, '')), '') is null then raise exception 'scheduling_instructor_profile_incomplete'; end if;

  select * into profile from public.instructor_scheduling_profiles where emp_id = p_emp_id;
  if not found then raise exception 'scheduling_instructor_profile_incomplete'; end if;
  if nullif(btrim(coalesce(profile.gender, '')), '') is null then raise exception 'scheduling_instructor_profile_incomplete'; end if;
  if nullif(btrim(coalesce(target.instruction_language, '')), '') is not null
    and not (target.instruction_language = any(coalesce(profile.instruction_languages, '{}'::text[])))
  then raise exception 'scheduling_language_mismatch'; end if;
  if coalesce(target.required_instructor_gender, 'any') in ('male','female')
    and profile.gender is distinct from target.required_instructor_gender
  then raise exception 'scheduling_gender_mismatch'; end if;

  for meeting in select value from jsonb_array_elements(p_meetings) loop
    meeting_date := (meeting->>'date')::date;
    meeting_start := (meeting->>'start_time')::time;
    meeting_end := (meeting->>'end_time')::time;
    v_weekday := extract(dow from meeting_date)::integer;
    if v_weekday = 6 and coalesce(public.school_calendar_sector_for_school_id(target.school_id), '') <> 'arab' then raise exception 'scheduling_saturday_blocked'; end if;
    if v_weekday = 5 and coalesce(profile.friday_allowed, false) is not true then raise exception 'scheduling_friday_not_allowed'; end if;

    select x.available, x.start_time, x.end_time into availability
    from (
      select e.available, e.start_time, e.end_time, 1 priority
      from public.instructor_availability_exceptions e
      where e.emp_id = p_emp_id and e.exception_date = meeting_date
      union all
      select r.available, r.start_time, r.end_time, 2 priority
      from public.instructor_availability_rules r
      where r.emp_id = p_emp_id and r.weekday = v_weekday
    ) x
    order by x.priority
    limit 1;
    if not found
      or availability.available is not true
      or availability.start_time is null
      or availability.end_time is null
      or meeting_start < availability.start_time
      or meeting_end > availability.end_time
    then raise exception 'scheduling_instructor_unavailable'; end if;
  end loop;
end
$function$;

CREATE OR REPLACE FUNCTION public.scheduling_course_instructor_violations(p_activity_id text, p_emp_id bigint, p_expect_unassigned boolean DEFAULT true)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  target public.activities;
  selected_instructor public.contacts_instructors;
  profile public.instructor_scheduling_profiles;
  meeting jsonb;
  availability record;
  previous_activity record;
  next_activity record;
  session_row record;
  target_location text;
  previous_location text;
  next_location text;
  required_minutes integer;
  required_km numeric;
  gap_minutes integer;
  home_km numeric;
  v_weekday integer;
  meeting_date date;
  target_start time without time zone;
  target_end time without time zone;
  target_duration integer;
  previous_end time without time zone;
  chain_count integer;
  effective_rows jsonb;
  violations text[] := '{}';
begin
  select * into target from public.activities where row_id = p_activity_id for update;
  if not found then raise exception 'activity_not_found'; end if;
  if coalesce(target.activity_season, '') <> 'school_2027' then raise exception 'scheduling_activity_not_school_2027'; end if;
  if lower(btrim(coalesce(target.activity_type::text, ''))) not in ('course', 'program', 'קורס', 'קורסים', 'תוכנית', 'תכנית', 'workshop', 'סדנה', 'סדנא', 'סדנאות', 'tour', 'סיור', 'סיורים') then raise exception 'scheduling_activity_not_course'; end if;
  if lower(btrim(coalesce(target.status::text, ''))) not in ('פתוח','open') then raise exception 'scheduling_activity_not_open'; end if;
  if p_expect_unassigned and (
    target.instructor_assignment_locked
    or nullif(target.emp_id::text, '') is not null
    or nullif(btrim(coalesce(target.instructor_name, '')), '') is not null
  ) then raise exception 'scheduling_assignment_locked'; end if;

  select * into selected_instructor from public.contacts_instructors where emp_id = p_emp_id;
  if not found then raise exception 'instructor_not_found'; end if;
  if lower(coalesce(selected_instructor.active::text, 'yes')) in ('no','false','0','לא פעיל') then raise exception 'instructor_inactive'; end if;

  effective_rows := public.scheduling_effective_meetings(target, p_emp_id);
  if jsonb_array_length(effective_rows) = 0 then raise exception 'scheduling_activity_dates_missing'; end if;
  if target.start_time is null or target.end_time is null or target.start_time >= target.end_time then raise exception 'scheduling_activity_hours_missing'; end if;

  if nullif(btrim(coalesce(selected_instructor.address, '')), '') is null then
    violations := array_append(violations, 'scheduling_instructor_profile_incomplete');
  end if;

  select * into profile from public.instructor_scheduling_profiles where emp_id = p_emp_id;
  if not found then
    violations := array_append(violations, 'scheduling_instructor_profile_incomplete');
  else
    if coalesce(cardinality(profile.instruction_languages), 0) = 0 then
      if not ('scheduling_instructor_profile_incomplete' = any(violations)) then
        violations := array_append(violations, 'scheduling_instructor_profile_incomplete');
      end if;
    elsif nullif(btrim(coalesce(target.instruction_language, '')), '') is not null
      and not (target.instruction_language = any(profile.instruction_languages))
    then
      violations := array_append(violations, 'scheduling_language_mismatch');
    end if;

    if nullif(btrim(coalesce(profile.gender, '')), '') is null then
      if not ('scheduling_instructor_profile_incomplete' = any(violations)) then
        violations := array_append(violations, 'scheduling_instructor_profile_incomplete');
      end if;
    elsif coalesce(target.required_instructor_gender, 'any') in ('male','female')
      and profile.gender <> target.required_instructor_gender
    then
      violations := array_append(violations, 'scheduling_gender_mismatch');
    end if;
  end if;

  target_location := public.scheduling_school_location(target.school_id, target.school, target.authority_id, target.authority);
  if nullif(btrim(coalesce(selected_instructor.address, '')), '') is not null then
    if nullif(btrim(coalesce(target_location, '')), '') is null then raise exception 'scheduling_home_route_unverified'; end if;
    home_km := public.scheduling_cached_travel_distance_km(selected_instructor.address, target_location);
    if home_km is null then raise exception 'scheduling_home_route_unverified'; end if;
    if home_km > 40 then raise exception 'scheduling_home_distance_exceeded'; end if;
  end if;

  for meeting in select value from jsonb_array_elements(effective_rows) loop
    meeting_date := (meeting->>'date')::date;
    target_start := (meeting->>'start_time')::time;
    target_end := (meeting->>'end_time')::time;
    target_duration := floor(extract(epoch from (target_end - target_start)) / 60);
    v_weekday := extract(dow from meeting_date)::integer;

    if v_weekday = 6 and coalesce(public.school_calendar_sector_for_school_id(target.school_id), '') <> 'arab' then raise exception 'scheduling_saturday_blocked'; end if;
    if v_weekday = 5 and coalesce(profile.friday_allowed, false) is not true
      and not ('scheduling_friday_not_allowed' = any(violations))
    then
      violations := array_append(violations, 'scheduling_friday_not_allowed');
    end if;

    select x.available, x.start_time, x.end_time into availability
    from (
      select e.available, e.start_time, e.end_time, 1 priority
      from public.instructor_availability_exceptions e
      where e.emp_id = p_emp_id and e.exception_date = meeting_date
      union all
      select r.available, r.start_time, r.end_time, 2 priority
      from public.instructor_availability_rules r
      where r.emp_id = p_emp_id and r.weekday = v_weekday
    ) x
    order by x.priority
    limit 1;

    if not found then
      if not ('scheduling_availability_missing' = any(violations)) then
        violations := array_append(violations, 'scheduling_availability_missing');
      end if;
    elsif availability.available is not true
      or availability.start_time is null
      or availability.end_time is null
      or target_start < availability.start_time
      or target_end > availability.end_time
    then
      if not ('scheduling_instructor_unavailable' = any(violations)) then
        violations := array_append(violations, 'scheduling_instructor_unavailable');
      end if;
    end if;

    if exists (
      select 1
      from public.activities a
      cross join lateral jsonb_array_elements(public.scheduling_effective_meetings(a, p_emp_id)) effective(value)
      where a.row_id <> target.row_id
        and a.activity_season = 'school_2027'
        and lower(btrim(coalesce(a.status::text, ''))) not in ('סגור','נמחק','בוטל','closed','deleted','cancelled','canceled','inactive','לא פעיל')
        and (a.emp_id::text = p_emp_id::text or a.emp_id_2::text = p_emp_id::text or a.draft_emp_id = p_emp_id::text)
        and effective.value->>'date' = meeting_date::text
        and (effective.value->>'start_time')::time < target_end
        and target_start < (effective.value->>'end_time')::time
    ) then raise exception 'scheduling_conflict_detected'; end if;

    previous_activity := null;
    select a.*,
      (effective.value->>'start_time')::time as effective_start_time,
      (effective.value->>'end_time')::time as effective_end_time
    into previous_activity
    from public.activities a
    cross join lateral jsonb_array_elements(public.scheduling_effective_meetings(a, p_emp_id)) effective(value)
    where a.row_id <> target.row_id
      and a.activity_season = 'school_2027'
      and lower(btrim(coalesce(a.status::text, ''))) not in ('סגור','נמחק','בוטל','closed','deleted','cancelled','canceled','inactive','לא פעיל')
      and (a.emp_id::text = p_emp_id::text or a.emp_id_2::text = p_emp_id::text or a.draft_emp_id = p_emp_id::text)
      and effective.value->>'date' = meeting_date::text
      and (effective.value->>'end_time')::time <= target_start
    order by (effective.value->>'end_time')::time desc
    limit 1;

    if found and not (
      previous_activity.school_id is not null
      and target.school_id is not null
      and previous_activity.school_id = target.school_id
    ) then
      previous_location := public.scheduling_school_location(previous_activity.school_id, previous_activity.school, previous_activity.authority_id, previous_activity.authority);
      if nullif(btrim(coalesce(previous_location, '')), '') is null or nullif(btrim(coalesce(target_location, '')), '') is null then raise exception 'scheduling_transition_unverified'; end if;
      required_km := public.scheduling_cached_travel_distance_km(previous_location, target_location);
      required_minutes := public.scheduling_cached_travel_minutes(previous_location, target_location);
      if required_km is null or required_minutes is null then raise exception 'scheduling_transition_unverified'; end if;
      gap_minutes := floor(extract(epoch from (target_start - previous_activity.effective_end_time)) / 60);
      if gap_minutes < required_minutes + public.scheduling_transition_buffer_minutes(required_km) then raise exception 'scheduling_transition_insufficient'; end if;
    end if;

    next_activity := null;
    select a.*,
      (effective.value->>'start_time')::time as effective_start_time,
      (effective.value->>'end_time')::time as effective_end_time
    into next_activity
    from public.activities a
    cross join lateral jsonb_array_elements(public.scheduling_effective_meetings(a, p_emp_id)) effective(value)
    where a.row_id <> target.row_id
      and a.activity_season = 'school_2027'
      and lower(btrim(coalesce(a.status::text, ''))) not in ('סגור','נמחק','בוטל','closed','deleted','cancelled','canceled','inactive','לא פעיל')
      and (a.emp_id::text = p_emp_id::text or a.emp_id_2::text = p_emp_id::text or a.draft_emp_id = p_emp_id::text)
      and effective.value->>'date' = meeting_date::text
      and (effective.value->>'start_time')::time >= target_end
    order by (effective.value->>'start_time')::time
    limit 1;

    if found and not (
      next_activity.school_id is not null
      and target.school_id is not null
      and next_activity.school_id = target.school_id
    ) then
      next_location := public.scheduling_school_location(next_activity.school_id, next_activity.school, next_activity.authority_id, next_activity.authority);
      if nullif(btrim(coalesce(next_location, '')), '') is null or nullif(btrim(coalesce(target_location, '')), '') is null then raise exception 'scheduling_transition_unverified'; end if;
      required_km := public.scheduling_cached_travel_distance_km(target_location, next_location);
      required_minutes := public.scheduling_cached_travel_minutes(target_location, next_location);
      if required_km is null or required_minutes is null then raise exception 'scheduling_transition_unverified'; end if;
      gap_minutes := floor(extract(epoch from (next_activity.effective_start_time - target_end)) / 60);
      if gap_minutes < required_minutes + public.scheduling_transition_buffer_minutes(required_km) then raise exception 'scheduling_transition_insufficient'; end if;
    end if;

    previous_end := null;
    chain_count := 0;
    for session_row in
      select sessions.start_time, sessions.end_time
      from (
        select target_start as start_time, target_end as end_time
        union all
        select (effective.value->>'start_time')::time, (effective.value->>'end_time')::time
        from public.activities a
        cross join lateral jsonb_array_elements(public.scheduling_effective_meetings(a, p_emp_id)) effective(value)
        where a.row_id <> target.row_id
          and a.activity_season = 'school_2027'
          and lower(btrim(coalesce(a.status::text, ''))) not in ('סגור','נמחק','בוטל','closed','deleted','cancelled','canceled','inactive','לא פעיל')
          and (a.emp_id::text = p_emp_id::text or a.emp_id_2::text = p_emp_id::text or a.draft_emp_id = p_emp_id::text)
          and effective.value->>'date' = meeting_date::text
      ) sessions
      where sessions.start_time is not null and sessions.end_time is not null
      order by sessions.start_time
    loop
      if previous_end is null or floor(extract(epoch from (session_row.start_time - previous_end)) / 60) > 30 then chain_count := 1;
      else chain_count := chain_count + 1;
      end if;
      previous_end := greatest(coalesce(previous_end, session_row.end_time), session_row.end_time);
      if (target_duration >= 80 and chain_count > 3) or (target_duration < 80 and chain_count > 5) then
        if not ('scheduling_daily_sequence_exceeded' = any(violations)) then violations := array_append(violations, 'scheduling_daily_sequence_exceeded'); end if;
      end if;
    end loop;
  end loop;

  return violations;
end
$function$;

CREATE OR REPLACE FUNCTION public.scheduling_manual_assignment_hard_violations(p_activity_id text, p_emp_id bigint)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  target public.activities;
  selected_instructor public.contacts_instructors;
  profile public.instructor_scheduling_profiles;
  meeting jsonb;
  availability record;
  previous_activity record;
  next_activity record;
  session_row record;
  target_location text;
  previous_location text;
  next_location text;
  required_minutes integer;
  required_km numeric;
  gap_minutes integer;
  home_km numeric;
  v_weekday integer;
  meeting_date date;
  target_start time without time zone;
  target_end time without time zone;
  target_duration integer;
  previous_end time without time zone;
  chain_count integer;
  effective_rows jsonb;
  violations text[] := '{}';
begin
  select * into target
  from public.activities
  where row_id = p_activity_id;

  if not found then raise exception 'activity_not_found'; end if;
  if coalesce(target.activity_season, '') <> 'school_2027' then
    raise exception 'scheduling_activity_not_school_2027';
  end if;
  if lower(btrim(coalesce(target.activity_type::text, ''))) not in (
    'course', 'program', 'קורס', 'קורסים', 'תוכנית', 'תכנית',
    'workshop', 'סדנה', 'סדנא', 'סדנאות',
    'tour', 'סיור', 'סיורים'
  ) then
    raise exception 'scheduling_activity_not_course';
  end if;
  if lower(btrim(coalesce(target.status::text, ''))) not in ('פתוח','open') then
    raise exception 'scheduling_activity_not_open';
  end if;
  if target.instructor_assignment_locked
    or nullif(target.emp_id::text, '') is not null
    or nullif(btrim(coalesce(target.instructor_name, '')), '') is not null
  then
    raise exception 'scheduling_assignment_locked';
  end if;

  select * into selected_instructor
  from public.contacts_instructors
  where emp_id = p_emp_id;
  if not found then raise exception 'instructor_not_found'; end if;
  if lower(coalesce(selected_instructor.active::text, 'yes')) in ('no','false','0','לא פעיל') then
    raise exception 'instructor_inactive';
  end if;

  effective_rows := public.scheduling_effective_meetings(target, p_emp_id);
  if jsonb_array_length(effective_rows) = 0 then raise exception 'scheduling_activity_dates_missing'; end if;
  if target.start_time is null or target.end_time is null or target.start_time >= target.end_time then
    raise exception 'scheduling_activity_hours_missing';
  end if;

  if nullif(btrim(coalesce(selected_instructor.address, '')), '') is null then
    violations := array_append(violations, 'scheduling_instructor_profile_incomplete');
  end if;

  select * into profile
  from public.instructor_scheduling_profiles
  where emp_id = p_emp_id;

  if not found then
    violations := array_append(violations, 'scheduling_instructor_profile_incomplete');
  else
    if coalesce(cardinality(profile.instruction_languages), 0) = 0 then
      if not ('scheduling_instructor_profile_incomplete' = any(violations)) then
        violations := array_append(violations, 'scheduling_instructor_profile_incomplete');
      end if;
    elsif nullif(btrim(coalesce(target.instruction_language, '')), '') is not null
      and not (target.instruction_language = any(profile.instruction_languages))
    then
      violations := array_append(violations, 'scheduling_language_mismatch');
    end if;

    if nullif(btrim(coalesce(profile.gender, '')), '') is null then
      if not ('scheduling_instructor_profile_incomplete' = any(violations)) then
        violations := array_append(violations, 'scheduling_instructor_profile_incomplete');
      end if;
    elsif coalesce(target.required_instructor_gender, 'any') in ('male','female')
      and profile.gender <> target.required_instructor_gender
    then
      violations := array_append(violations, 'scheduling_gender_mismatch');
    end if;
  end if;

  target_location := public.scheduling_school_location(
    target.school_id, target.school, target.authority_id, target.authority
  );
  if nullif(btrim(coalesce(selected_instructor.address, '')), '') is not null then
    if nullif(btrim(coalesce(target_location, '')), '') is null then
      raise exception 'scheduling_home_route_unverified';
    end if;
    home_km := public.scheduling_cached_travel_distance_km(selected_instructor.address, target_location);
    if home_km is null then raise exception 'scheduling_home_route_unverified'; end if;
    -- Deliberate manual selection may exceed the automatic 40 km gate.
    -- Existing manager-approval policy remains responsible for >= 60 km.
  end if;

  for meeting in select value from jsonb_array_elements(effective_rows) loop
    meeting_date := (meeting->>'date')::date;
    target_start := (meeting->>'start_time')::time;
    target_end := (meeting->>'end_time')::time;
    target_duration := floor(extract(epoch from (target_end - target_start)) / 60);
    v_weekday := extract(dow from meeting_date)::integer;

    if v_weekday = 6 and coalesce(public.school_calendar_sector_for_school_id(target.school_id), '') <> 'arab' then raise exception 'scheduling_saturday_blocked'; end if;
    if v_weekday = 5 and coalesce(profile.friday_allowed, false) is not true
      and not ('scheduling_friday_not_allowed' = any(violations))
    then
      violations := array_append(violations, 'scheduling_friday_not_allowed');
    end if;

    select x.available, x.start_time, x.end_time into availability
    from (
      select e.available, e.start_time, e.end_time, 1 priority
      from public.instructor_availability_exceptions e
      where e.emp_id = p_emp_id and e.exception_date = meeting_date
      union all
      select r.available, r.start_time, r.end_time, 2 priority
      from public.instructor_availability_rules r
      where r.emp_id = p_emp_id and r.weekday = v_weekday
    ) x
    order by x.priority
    limit 1;

    -- Missing availability rows remain a deliberate-manual warning. An
    -- explicit unavailable/out-of-window rule is a non-overridable fact.
    if found and (
      availability.available is not true
      or availability.start_time is null
      or availability.end_time is null
      or target_start < availability.start_time
      or target_end > availability.end_time
    ) then
      if not ('scheduling_instructor_unavailable' = any(violations)) then
        violations := array_append(violations, 'scheduling_instructor_unavailable');
      end if;
    end if;

    if exists (
      select 1
      from public.activities a
      cross join lateral jsonb_array_elements(public.scheduling_effective_meetings(a, p_emp_id)) effective(value)
      where a.row_id <> target.row_id
        and a.activity_season = 'school_2027'
        and lower(btrim(coalesce(a.status::text, ''))) not in (
          'סגור','נמחק','בוטל','closed','deleted','cancelled','canceled','inactive','לא פעיל'
        )
        and (a.emp_id::text = p_emp_id::text or a.emp_id_2::text = p_emp_id::text or a.draft_emp_id = p_emp_id::text)
        and effective.value->>'date' = meeting_date::text
        and (effective.value->>'start_time')::time < target_end
        and target_start < (effective.value->>'end_time')::time
    ) then
      raise exception 'scheduling_conflict_detected';
    end if;

    previous_activity := null;
    select a.*,
      (effective.value->>'start_time')::time as effective_start_time,
      (effective.value->>'end_time')::time as effective_end_time
    into previous_activity
    from public.activities a
    cross join lateral jsonb_array_elements(public.scheduling_effective_meetings(a, p_emp_id)) effective(value)
    where a.row_id <> target.row_id
      and a.activity_season = 'school_2027'
      and lower(btrim(coalesce(a.status::text, ''))) not in (
        'סגור','נמחק','בוטל','closed','deleted','cancelled','canceled','inactive','לא פעיל'
      )
      and (a.emp_id::text = p_emp_id::text or a.emp_id_2::text = p_emp_id::text or a.draft_emp_id = p_emp_id::text)
      and effective.value->>'date' = meeting_date::text
      and (effective.value->>'end_time')::time <= target_start
    order by (effective.value->>'end_time')::time desc
    limit 1;

    if found and not (
      previous_activity.school_id is not null
      and target.school_id is not null
      and previous_activity.school_id = target.school_id
    ) then
      previous_location := public.scheduling_school_location(
        previous_activity.school_id, previous_activity.school,
        previous_activity.authority_id, previous_activity.authority
      );
      if nullif(btrim(coalesce(previous_location, '')), '') is null
        or nullif(btrim(coalesce(target_location, '')), '') is null
      then raise exception 'scheduling_transition_unverified'; end if;
      required_km := public.scheduling_cached_travel_distance_km(previous_location, target_location);
      required_minutes := public.scheduling_cached_travel_minutes(previous_location, target_location);
      if required_km is null or required_minutes is null then
        raise exception 'scheduling_transition_unverified';
      end if;
      gap_minutes := floor(extract(epoch from (target_start - previous_activity.effective_end_time)) / 60);
      if gap_minutes < required_minutes + public.scheduling_transition_buffer_minutes(required_km) then raise exception 'scheduling_transition_insufficient'; end if;
    end if;

    next_activity := null;
    select a.*,
      (effective.value->>'start_time')::time as effective_start_time,
      (effective.value->>'end_time')::time as effective_end_time
    into next_activity
    from public.activities a
    cross join lateral jsonb_array_elements(public.scheduling_effective_meetings(a, p_emp_id)) effective(value)
    where a.row_id <> target.row_id
      and a.activity_season = 'school_2027'
      and lower(btrim(coalesce(a.status::text, ''))) not in (
        'סגור','נמחק','בוטל','closed','deleted','cancelled','canceled','inactive','לא פעיל'
      )
      and (a.emp_id::text = p_emp_id::text or a.emp_id_2::text = p_emp_id::text or a.draft_emp_id = p_emp_id::text)
      and effective.value->>'date' = meeting_date::text
      and (effective.value->>'start_time')::time >= target_end
    order by (effective.value->>'start_time')::time
    limit 1;

    if found and not (
      next_activity.school_id is not null
      and target.school_id is not null
      and next_activity.school_id = target.school_id
    ) then
      next_location := public.scheduling_school_location(
        next_activity.school_id, next_activity.school,
        next_activity.authority_id, next_activity.authority
      );
      if nullif(btrim(coalesce(next_location, '')), '') is null
        or nullif(btrim(coalesce(target_location, '')), '') is null
      then raise exception 'scheduling_transition_unverified'; end if;
      required_km := public.scheduling_cached_travel_distance_km(target_location, next_location);
      required_minutes := public.scheduling_cached_travel_minutes(target_location, next_location);
      if required_km is null or required_minutes is null then
        raise exception 'scheduling_transition_unverified';
      end if;
      gap_minutes := floor(extract(epoch from (next_activity.effective_start_time - target_end)) / 60);
      if gap_minutes < required_minutes + public.scheduling_transition_buffer_minutes(required_km) then raise exception 'scheduling_transition_insufficient'; end if;
    end if;

    previous_end := null;
    chain_count := 0;
    for session_row in
      select sessions.start_time, sessions.end_time
      from (
        select target_start as start_time, target_end as end_time
        union all
        select (effective.value->>'start_time')::time, (effective.value->>'end_time')::time
        from public.activities a
        cross join lateral jsonb_array_elements(public.scheduling_effective_meetings(a, p_emp_id)) effective(value)
        where a.row_id <> target.row_id
          and a.activity_season = 'school_2027'
          and lower(btrim(coalesce(a.status::text, ''))) not in (
            'סגור','נמחק','בוטל','closed','deleted','cancelled','canceled','inactive','לא פעיל'
          )
          and (a.emp_id::text = p_emp_id::text or a.emp_id_2::text = p_emp_id::text or a.draft_emp_id = p_emp_id::text)
          and effective.value->>'date' = meeting_date::text
      ) sessions
      where sessions.start_time is not null and sessions.end_time is not null
      order by sessions.start_time
    loop
      if previous_end is null
        or floor(extract(epoch from (session_row.start_time - previous_end)) / 60) > 30
      then chain_count := 1;
      else chain_count := chain_count + 1;
      end if;
      previous_end := greatest(coalesce(previous_end, session_row.end_time), session_row.end_time);
      if (target_duration >= 80 and chain_count > 3)
        or (target_duration < 80 and chain_count > 5)
      then
        if not ('scheduling_daily_sequence_exceeded' = any(violations)) then
          violations := array_append(violations, 'scheduling_daily_sequence_exceeded');
        end if;
      end if;
    end loop;
  end loop;

  return violations;
end
$function$;

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
  if jsonb_typeof(p_meetings) <> 'array'
    or jsonb_array_length(p_meetings) = 0
    or jsonb_array_length(p_meetings) > 35
  then raise exception 'scheduling_proposed_dates_invalid'; end if;

  select count(*) into official_count
  from generate_series(1,35) n
  where nullif(to_jsonb(target)->>('date_' || n), '') is not null;
  if jsonb_array_length(p_meetings) <> official_count then raise exception 'scheduling_proposed_meeting_count_mismatch'; end if;

  for item in select value from jsonb_array_elements(p_meetings) loop
    if nullif(item->>'date', '') is null then raise exception 'scheduling_proposed_dates_invalid'; end if;
    begin
      item_date := (item->>'date')::date;
    exception when others then
      raise exception 'scheduling_proposed_dates_invalid';
    end;

    if extract(dow from item_date) = 6 and coalesce(activity_sector, '') <> 'arab' then raise exception 'scheduling_saturday_blocked'; end if;
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
