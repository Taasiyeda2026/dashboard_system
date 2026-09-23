-- Nearby school transition policy:
-- * verified route <= 10 km: raw travel time + 10 minutes
-- * verified route > 10 km and <= 20 km: raw travel time + 15 minutes
-- * route > 20 km remains a hard rejection
create or replace function public.scheduling_transition_buffer_minutes(p_distance_km numeric)
returns integer
language sql
immutable
set search_path = public
as $$
  select case
    when p_distance_km is not null and p_distance_km <= 10 then 10
    else 15
  end
$$;

revoke all on function public.scheduling_transition_buffer_minutes(numeric) from public;

CREATE OR REPLACE FUNCTION public.scheduling_assert_assignment_calendar(p_activity_id text, p_emp_id bigint, p_meetings jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  target public.activities;
  meeting jsonb;
  other record;
  previous_activity record;
  next_activity record;
  target_location text;
  other_location text;
  required_minutes integer;
  required_km numeric;
  gap_minutes integer;
  meeting_date date;
  target_start time without time zone;
  target_end time without time zone;
begin
  select * into target from public.activities where row_id = p_activity_id;
  if not found then raise exception 'activity_not_found'; end if;
  p_meetings := public.scheduling_validate_proposed_meetings(p_activity_id, p_meetings);
  target_location := public.scheduling_school_location(target.school_id, target.school, target.authority_id, target.authority);

  for meeting in select value from jsonb_array_elements(p_meetings) loop
    meeting_date := (meeting->>'date')::date;
    target_start := (meeting->>'start_time')::time;
    target_end := (meeting->>'end_time')::time;
    if exists (
      select 1 from public.course_meeting_cancellations c
      where c.activity_id = p_activity_id and c.meeting_date = meeting_date
    ) then continue; end if;

    previous_activity := null;
    next_activity := null;
    for other in
      select a.*,
        (effective.value->>'start_time')::time as effective_start_time,
        (effective.value->>'end_time')::time as effective_end_time
      from public.activities a
      cross join lateral jsonb_array_elements(public.scheduling_effective_meetings(a, p_emp_id)) effective(value)
      where a.row_id <> p_activity_id
        and a.activity_season = 'school_2027'
        and lower(btrim(coalesce(a.status::text, ''))) not in ('סגור','נמחק','בוטל','closed','deleted','cancelled','canceled','inactive','לא פעיל')
        and (a.emp_id::text = p_emp_id::text or a.emp_id_2::text = p_emp_id::text or a.draft_emp_id = p_emp_id::text)
        and effective.value->>'date' = meeting_date::text
      order by (effective.value->>'start_time')::time
    loop
      if other.effective_start_time < target_end and target_start < other.effective_end_time then
        raise exception 'scheduling_conflict_detected';
      end if;
      if other.effective_end_time <= target_start
        and (previous_activity is null or other.effective_end_time > previous_activity.effective_end_time)
      then previous_activity := other; end if;
      if other.effective_start_time >= target_end
        and (next_activity is null or other.effective_start_time < next_activity.effective_start_time)
      then next_activity := other; end if;
    end loop;

    if previous_activity is not null and not (
      previous_activity.school_id is not null
      and target.school_id is not null
      and previous_activity.school_id = target.school_id
    ) then
      other_location := public.scheduling_school_location(previous_activity.school_id, previous_activity.school, previous_activity.authority_id, previous_activity.authority);
      required_km := public.scheduling_cached_travel_distance_km(other_location, target_location);
      required_minutes := public.scheduling_cached_travel_minutes(other_location, target_location);
      if nullif(btrim(coalesce(other_location, '')), '') is null
        or nullif(btrim(coalesce(target_location, '')), '') is null
        or required_minutes is null
        or required_km is null
      then raise exception 'scheduling_transition_unverified'; end if;
      if required_km > 20 then raise exception 'scheduling_transition_distance_exceeded'; end if;
      gap_minutes := floor(extract(epoch from (target_start - previous_activity.effective_end_time)) / 60);
      if gap_minutes < required_minutes + public.scheduling_transition_buffer_minutes(required_km) then raise exception 'scheduling_transition_insufficient'; end if;
    end if;

    if next_activity is not null and not (
      next_activity.school_id is not null
      and target.school_id is not null
      and next_activity.school_id = target.school_id
    ) then
      other_location := public.scheduling_school_location(next_activity.school_id, next_activity.school, next_activity.authority_id, next_activity.authority);
      required_km := public.scheduling_cached_travel_distance_km(target_location, other_location);
      required_minutes := public.scheduling_cached_travel_minutes(target_location, other_location);
      if nullif(btrim(coalesce(other_location, '')), '') is null
        or nullif(btrim(coalesce(target_location, '')), '') is null
        or required_minutes is null
        or required_km is null
      then raise exception 'scheduling_transition_unverified'; end if;
      if required_km > 20 then raise exception 'scheduling_transition_distance_exceeded'; end if;
      gap_minutes := floor(extract(epoch from (next_activity.effective_start_time - target_end)) / 60);
      if gap_minutes < required_minutes + public.scheduling_transition_buffer_minutes(required_km) then raise exception 'scheduling_transition_insufficient'; end if;
    end if;
  end loop;
end
$function$
;

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

    if v_weekday = 6 then raise exception 'scheduling_saturday_blocked'; end if;
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
      if required_km > 20 then raise exception 'scheduling_transition_distance_exceeded'; end if;
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
      if required_km > 20 then raise exception 'scheduling_transition_distance_exceeded'; end if;
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
$function$
;

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

    if v_weekday = 6 then raise exception 'scheduling_saturday_blocked'; end if;
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
      if required_km > 20 then raise exception 'scheduling_transition_distance_exceeded'; end if;
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
      if required_km > 20 then raise exception 'scheduling_transition_distance_exceeded'; end if;
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
$function$
;

comment on function public.scheduling_transition_buffer_minutes(numeric) is
'Distance-aware safety buffer for school-to-school transitions: 10 minutes up to 10 km, otherwise 15 minutes; callers retain the 20 km hard cap.';
