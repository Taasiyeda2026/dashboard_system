-- Simplify course-scheduling gates to the organization's operational requirements.
-- Historical profile and activity restriction columns remain intact but are no longer consulted.

create or replace function public.scheduling_course_instructor_violations(
  p_activity_id text,
  p_emp_id bigint,
  p_expect_unassigned boolean default true
) returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.activities;
  selected_instructor public.contacts_instructors;
  profile public.instructor_scheduling_profiles;
  meeting record;
  availability record;
  previous_activity public.activities;
  next_activity public.activities;
  session_row record;
  target_location text;
  previous_location text;
  next_location text;
  required_minutes integer;
  gap_minutes integer;
  v_weekday integer;
  previous_end time;
  chain_count integer;
  target_duration integer;
  target_dates date[];
  violations text[] := '{}';
begin
  select * into target from public.activities where row_id = p_activity_id for update;
  if not found then raise exception 'activity_not_found'; end if;

  if coalesce(target.activity_season, '') <> 'school_2027' then raise exception 'scheduling_activity_not_school_2027'; end if;
  if lower(btrim(coalesce(target.activity_type::text, ''))) not in ('קורס','course','program') then raise exception 'scheduling_activity_not_course'; end if;
  if lower(btrim(coalesce(target.status::text, ''))) not in ('פתוח','open') then raise exception 'scheduling_activity_not_open'; end if;
  if p_expect_unassigned and (
    target.instructor_assignment_locked
    or nullif(target.emp_id::text, '') is not null
    or nullif(btrim(coalesce(target.instructor_name, '')), '') is not null
  ) then raise exception 'scheduling_assignment_locked'; end if;

  select * into selected_instructor from public.contacts_instructors where emp_id = p_emp_id;
  if not found then raise exception 'instructor_not_found'; end if;
  if lower(coalesce(selected_instructor.active::text, 'yes')) in ('no','false','0','לא פעיל') then raise exception 'instructor_inactive'; end if;

  select array_agg(d order by d) into target_dates
  from (select nullif(to_jsonb(target)->>('date_' || n), '')::date as d from generate_series(1, 35) n) dates
  where d is not null;
  if coalesce(cardinality(target_dates), 0) = 0 then raise exception 'scheduling_activity_dates_missing'; end if;
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
      and not (target.instruction_language = any(profile.instruction_languages)) then
      violations := array_append(violations, 'scheduling_language_mismatch');
    end if;

    if coalesce(target.required_instructor_gender, 'any') in ('male', 'female') then
      if nullif(btrim(coalesce(profile.gender, '')), '') is null then
        if not ('scheduling_instructor_profile_incomplete' = any(violations)) then
          violations := array_append(violations, 'scheduling_instructor_profile_incomplete');
        end if;
      elsif profile.gender <> target.required_instructor_gender then
        violations := array_append(violations, 'scheduling_gender_mismatch');
      end if;
    end if;
  end if;

  target_location := public.scheduling_school_location(target.school_id, target.school, target.authority_id, target.authority);
  target_duration := floor(extract(epoch from (target.end_time - target.start_time)) / 60);

  for meeting in select unnest(target_dates) as meeting_date loop
    v_weekday := extract(dow from meeting.meeting_date)::integer;
    if v_weekday = 6 then raise exception 'scheduling_saturday_blocked'; end if;
    if v_weekday = 5 and coalesce(profile.friday_allowed, false) is not true and not ('scheduling_friday_not_allowed' = any(violations)) then
      violations := array_append(violations, 'scheduling_friday_not_allowed');
    end if;

    select x.available, x.start_time, x.end_time into availability
    from (
      select e.available, e.start_time, e.end_time, 1 as priority
      from public.instructor_availability_exceptions e
      where e.emp_id = p_emp_id and e.exception_date = meeting.meeting_date
      union all
      select r.available, r.start_time, r.end_time, 2 as priority
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
      or target.start_time < availability.start_time
      or target.end_time > availability.end_time
    then
      if not ('scheduling_instructor_unavailable' = any(violations)) then
        violations := array_append(violations, 'scheduling_instructor_unavailable');
      end if;
    end if;

    if exists (
      select 1 from public.activities a
      where a.row_id <> target.row_id
        and a.activity_season = 'school_2027'
        and lower(btrim(coalesce(a.status::text, ''))) not in ('סגור','נמחק','בוטל','closed','deleted','cancelled','canceled','inactive','לא פעיל')
        and (a.emp_id::text = p_emp_id::text or a.emp_id_2::text = p_emp_id::text or a.draft_emp_id = p_emp_id::text)
        and meeting.meeting_date = any(array(select nullif(to_jsonb(a)->>('date_' || n), '')::date from generate_series(1,35) n))
        and a.start_time < target.end_time and target.start_time < a.end_time
    ) then raise exception 'scheduling_conflict_detected'; end if;

    previous_activity := null;
    select a.* into previous_activity from public.activities a
    where a.row_id <> target.row_id
      and a.activity_season = 'school_2027'
      and lower(btrim(coalesce(a.status::text, ''))) not in ('סגור','נמחק','בוטל','closed','deleted','cancelled','canceled','inactive','לא פעיל')
      and (a.emp_id::text = p_emp_id::text or a.emp_id_2::text = p_emp_id::text)
      and meeting.meeting_date = any(array(select nullif(to_jsonb(a)->>('date_' || n), '')::date from generate_series(1,35) n))
      and a.end_time <= target.start_time
    order by a.end_time desc limit 1;

    if found and not (
      (previous_activity.school_id is not null and target.school_id is not null and previous_activity.school_id = target.school_id)
      or lower(btrim(coalesce(previous_activity.school, ''))) = lower(btrim(coalesce(target.school, '')))
    ) then
      previous_location := public.scheduling_school_location(previous_activity.school_id, previous_activity.school, previous_activity.authority_id, previous_activity.authority);
      if nullif(btrim(coalesce(previous_location, '')), '') is null or nullif(btrim(coalesce(target_location, '')), '') is null then
        if not ('scheduling_transition_unverified' = any(violations)) then violations := array_append(violations, 'scheduling_transition_unverified'); end if;
      else
        required_minutes := public.scheduling_cached_travel_minutes(previous_location, target_location);
        if required_minutes is null then
          if not ('scheduling_transition_unverified' = any(violations)) then violations := array_append(violations, 'scheduling_transition_unverified'); end if;
        else
          gap_minutes := floor(extract(epoch from (target.start_time - previous_activity.end_time)) / 60);
          if gap_minutes < required_minutes then raise exception 'scheduling_transition_insufficient'; end if;
        end if;
      end if;
    end if;

    next_activity := null;
    select a.* into next_activity from public.activities a
    where a.row_id <> target.row_id
      and a.activity_season = 'school_2027'
      and lower(btrim(coalesce(a.status::text, ''))) not in ('סגור','נמחק','בוטל','closed','deleted','cancelled','canceled','inactive','לא פעיל')
      and (a.emp_id::text = p_emp_id::text or a.emp_id_2::text = p_emp_id::text)
      and meeting.meeting_date = any(array(select nullif(to_jsonb(a)->>('date_' || n), '')::date from generate_series(1,35) n))
      and a.start_time >= target.end_time
    order by a.start_time limit 1;

    if found and not (
      (next_activity.school_id is not null and target.school_id is not null and next_activity.school_id = target.school_id)
      or lower(btrim(coalesce(next_activity.school, ''))) = lower(btrim(coalesce(target.school, '')))
    ) then
      next_location := public.scheduling_school_location(next_activity.school_id, next_activity.school, next_activity.authority_id, next_activity.authority);
      if nullif(btrim(coalesce(next_location, '')), '') is null or nullif(btrim(coalesce(target_location, '')), '') is null then
        if not ('scheduling_transition_unverified' = any(violations)) then violations := array_append(violations, 'scheduling_transition_unverified'); end if;
      else
        required_minutes := public.scheduling_cached_travel_minutes(target_location, next_location);
        if required_minutes is null then
          if not ('scheduling_transition_unverified' = any(violations)) then violations := array_append(violations, 'scheduling_transition_unverified'); end if;
        else
          gap_minutes := floor(extract(epoch from (next_activity.start_time - target.end_time)) / 60);
          if gap_minutes < required_minutes then raise exception 'scheduling_transition_insufficient'; end if;
        end if;
      end if;
    end if;

    previous_end := null;
    chain_count := 0;
    for session_row in
      select sessions.start_time, sessions.end_time from (
        select target.start_time, target.end_time
        union all
        select a.start_time, a.end_time from public.activities a
        where a.row_id <> target.row_id
          and a.activity_season = 'school_2027'
          and lower(btrim(coalesce(a.status::text, ''))) not in ('סגור','נמחק','בוטל','closed','deleted','cancelled','canceled','inactive','לא פעיל')
          and (a.emp_id::text = p_emp_id::text or a.emp_id_2::text = p_emp_id::text)
          and meeting.meeting_date = any(array(select nullif(to_jsonb(a)->>('date_' || n), '')::date from generate_series(1,35) n))
      ) sessions
      where sessions.start_time is not null and sessions.end_time is not null
      order by sessions.start_time
    loop
      if previous_end is null or floor(extract(epoch from (session_row.start_time - previous_end)) / 60) > 30 then
        chain_count := 1;
      else
        chain_count := chain_count + 1;
      end if;
      previous_end := greatest(coalesce(previous_end, session_row.end_time), session_row.end_time);
      if (target_duration >= 80 and chain_count > 3) or (target_duration < 80 and chain_count > 5) then
        if not ('scheduling_daily_sequence_exceeded' = any(violations)) then violations := array_append(violations, 'scheduling_daily_sequence_exceeded'); end if;
      end if;
    end loop;
  end loop;

  return violations;
end
$$;
revoke all on function public.scheduling_course_instructor_violations(text, bigint, boolean) from public;
grant execute on function public.scheduling_course_instructor_violations(text, bigint, boolean) to authenticated;
