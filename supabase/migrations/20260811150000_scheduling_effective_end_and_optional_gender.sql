-- Focused scheduling validation corrections. Data-free: no production rows are changed.
-- An enforced shortened-day end is already applied by scheduling_effective_meetings;
-- calendar revalidation must not separately reject the nominal activity end time.
-- Instructor gender is required only when the activity declares an explicit requirement.

create or replace function public.scheduling_assert_proposed_eligibility(
  p_activity_id text,
  p_emp_id bigint,
  p_meetings jsonb
) returns void
language plpgsql
stable
security definer
set search_path = public
as $$
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
  if coalesce(target.required_instructor_gender, 'any') in ('male','female')
    and nullif(btrim(coalesce(profile.gender, '')), '') is null
  then raise exception 'scheduling_instructor_profile_incomplete'; end if;
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
    if v_weekday = 6 then raise exception 'scheduling_saturday_blocked'; end if;
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
$$;
revoke all on function public.scheduling_assert_proposed_eligibility(text,bigint,jsonb) from public;

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
  meeting jsonb;
  availability record;
  previous_activity record;
  next_activity record;
  target_location text;
  previous_location text;
  next_location text;
  required_minutes integer;
  gap_minutes integer;
  home_km numeric;
  v_weekday integer;
  meeting_date date;
  target_start time without time zone;
  target_end time without time zone;
  effective_rows jsonb;
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
    then violations := array_append(violations, 'scheduling_language_mismatch'); end if;

    if coalesce(target.required_instructor_gender, 'any') in ('male','female') then
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
    v_weekday := extract(dow from meeting_date)::integer;
    if v_weekday = 6 then raise exception 'scheduling_saturday_blocked'; end if;
    if v_weekday = 5 and coalesce(profile.friday_allowed, false) is not true
      and not ('scheduling_friday_not_allowed' = any(violations))
    then violations := array_append(violations, 'scheduling_friday_not_allowed'); end if;

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
      if nullif(btrim(coalesce(previous_location, '')), '') is null or nullif(btrim(coalesce(target_location, '')), '') is null then
        raise exception 'scheduling_transition_unverified';
      end if;
      required_minutes := public.scheduling_cached_travel_minutes(previous_location, target_location);
      if required_minutes is null then raise exception 'scheduling_transition_unverified'; end if;
      gap_minutes := floor(extract(epoch from (target_start - previous_activity.effective_end_time)) / 60);
      if gap_minutes < required_minutes + 15 then raise exception 'scheduling_transition_insufficient'; end if;
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
      if nullif(btrim(coalesce(next_location, '')), '') is null or nullif(btrim(coalesce(target_location, '')), '') is null then
        raise exception 'scheduling_transition_unverified';
      end if;
      required_minutes := public.scheduling_cached_travel_minutes(target_location, next_location);
      if required_minutes is null then raise exception 'scheduling_transition_unverified'; end if;
      gap_minutes := floor(extract(epoch from (next_activity.effective_start_time - target_end)) / 60);
      if gap_minutes < required_minutes + 15 then raise exception 'scheduling_transition_insufficient'; end if;
    end if;
  end loop;
  return violations;
end
$$;
revoke all on function public.scheduling_course_instructor_violations(text,bigint,boolean) from public;
grant execute on function public.scheduling_course_instructor_violations(text,bigint,boolean) to authenticated;

-- Holiday blocking remains unchanged. For school_2027 courses only, a shortened-day
-- end is an effective per-meeting scheduling cap rather than a rejection of the course's
-- nominal global end_time. Other activity types keep the existing hard rejection.
create or replace function public.scheduling_school_calendar_validation_reason(
  p_activity_id text
) returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target public.activities;
  meeting_date date;
begin
  select * into target
  from public.activities
  where row_id = p_activity_id;

  if not found then
    return 'activity_not_found';
  end if;

  for meeting_date in
    select distinct nullif(to_jsonb(target)->>('date_' || n), '')::date
    from generate_series(1, 35) n
    where nullif(to_jsonb(target)->>('date_' || n), '') is not null
      and not exists (
        select 1
        from public.course_meeting_cancellations c
        where c.activity_id = target.row_id
          and c.meeting_date = nullif(to_jsonb(target)->>('date_' || n), '')::date
      )
  loop
    if exists (
      select 1
      from public.school_calendar sc
      where sc.is_active is true
        and sc.blocks_scheduling is true
        and sc.start_date is not null
        and meeting_date between sc.start_date and coalesce(sc.end_date, sc.start_date)
    ) then
      return 'activity_date_on_school_holiday';
    end if;

  end loop;

  return null;
end
$$;

revoke all on function public.scheduling_school_calendar_validation_reason(text) from public;
