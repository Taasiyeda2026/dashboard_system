-- Keep all assignment safety rules unchanged; cache only duplicate reads.
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
  effective_rows jsonb;
  other_meetings jsonb := '[]'::jsonb;
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

    -- A personal program block is non-overridable for new assignments.
    if profile.course_restriction_mode = 'block_selected'
       and nullif(btrim(coalesce(target.activity_no, '')), '') = any(coalesce(profile.course_ids, '{}'::text[]))
    then
      violations := array_append(violations, 'scheduling_course_blocked');
    end if;

    if public.scheduling_authority_name_is_blocked(profile.blocked_authorities, target.authority) then
      if not ('scheduling_authority_blocked' = any(violations)) then
        violations := array_append(violations, 'scheduling_authority_blocked');
      end if;
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


  -- Cache the exact existing active same-instructor timetable one time only.
  -- Overlaps and adjacent travel still check every meeting and safety constraint.
  select coalesce(jsonb_agg(to_jsonb(other)), '[]'::jsonb) into other_meetings
  from (
    select a.row_id, a.school_id, a.school, a.authority_id, a.authority,
      (effective.value->>'date')::date as scheduled_date,
      (effective.value->>'start_time')::time as effective_start_time,
      (effective.value->>'end_time')::time as effective_end_time
    from public.activities a
    cross join lateral jsonb_array_elements(public.scheduling_effective_meetings(a, p_emp_id)) effective(value)
    where a.row_id <> target.row_id
      and a.activity_season = 'school_2027'
      and lower(btrim(coalesce(a.status::text, ''))) not in (
        'סגור','נמחק','בוטל','closed','deleted','cancelled','canceled','inactive','לא פעיל'
      )
      and (a.emp_id::text = p_emp_id::text or a.emp_id_2::text = p_emp_id::text or a.draft_emp_id = p_emp_id::text)
  ) other;

  for meeting in select value from jsonb_array_elements(effective_rows) loop
    meeting_date := (meeting->>'date')::date;
    target_start := (meeting->>'start_time')::time;
    target_end := (meeting->>'end_time')::time;
    v_weekday := extract(dow from meeting_date)::integer;

    if v_weekday = 5 and profile.friday_allowed is not true then raise exception 'scheduling_friday_not_allowed'; end if; if v_weekday = 6 and coalesce(public.school_calendar_sector_for_school_id(target.school_id), '') not in ('arab','druze') then raise exception 'scheduling_saturday_blocked'; end if;

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

    -- Weekly availability is an explicit hard constraint in every assignment path.
    -- An unselected day has no availability row and must not be bypassed manually.
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
      select 1 from jsonb_to_recordset(other_meetings) as candidate (row_id text, school_id bigint, school text, authority_id bigint, authority text, scheduled_date date, effective_start_time time, effective_end_time time)
      where candidate.scheduled_date = meeting_date
        and candidate.effective_start_time < target_end
        and target_start < candidate.effective_end_time
    ) then
      raise exception 'scheduling_conflict_detected';
    end if;

    previous_activity := null;
    select candidate.* into previous_activity
    from jsonb_to_recordset(other_meetings) as candidate (row_id text, school_id bigint, school text, authority_id bigint, authority text, scheduled_date date, effective_start_time time, effective_end_time time)
    where candidate.scheduled_date = meeting_date
      and candidate.effective_end_time <= target_start
    order by candidate.effective_end_time desc
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
      if public.scheduling_transition_distance_cap_applies(gap_minutes) and required_km > 45 then
        if not ('scheduling_transition_distance_forbidden' = any(violations)) then
          violations := array_append(violations, 'scheduling_transition_distance_forbidden');
        end if;
      end if;
      if public.scheduling_transition_distance_cap_applies(gap_minutes) and required_km > 30 then
        if not ('scheduling_transition_distance_exceeded' = any(violations)) then
          violations := array_append(violations, 'scheduling_transition_distance_exceeded');
        end if;
      end if;
      if gap_minutes < required_minutes + public.scheduling_transition_buffer_minutes(required_km) then raise exception 'scheduling_transition_insufficient'; end if;
    end if;

    next_activity := null;
    select candidate.* into next_activity
    from jsonb_to_recordset(other_meetings) as candidate (row_id text, school_id bigint, school text, authority_id bigint, authority text, scheduled_date date, effective_start_time time, effective_end_time time)
    where candidate.scheduled_date = meeting_date
      and candidate.effective_start_time >= target_end
    order by candidate.effective_start_time
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
      if public.scheduling_transition_distance_cap_applies(gap_minutes) and required_km > 45 then
        if not ('scheduling_transition_distance_forbidden' = any(violations)) then
          violations := array_append(violations, 'scheduling_transition_distance_forbidden');
        end if;
      end if;
      if public.scheduling_transition_distance_cap_applies(gap_minutes) and required_km > 30 then
        if not ('scheduling_transition_distance_exceeded' = any(violations)) then
          violations := array_append(violations, 'scheduling_transition_distance_exceeded');
        end if;
      end if;
      if gap_minutes < required_minutes + public.scheduling_transition_buffer_minutes(required_km) then raise exception 'scheduling_transition_insufficient'; end if;
    end if;

  end loop;

  return violations;
end
$function$
;
