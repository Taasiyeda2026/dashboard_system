-- Stage 2 scheduling contract alignment.
-- Data-free migration: no activity rows are changed and no table schema is changed.
-- Frontend matching and canonical server helpers now share the same effective calendar:
-- cancelled meetings are ignored, shortened-school-day end times are derived server-side,
-- same-school identity uses school_id only, and daily activity count is not a hard gate.

create or replace function public.scheduling_effective_end_time(
  p_date date,
  p_original_end time without time zone
) returns time without time zone
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_original_end is null then null
    else least(
      p_original_end,
      coalesce((
        select min(sc.school_day_end_time)
        from public.school_calendar sc
        where sc.is_active = true
          and sc.enforce_end_time = true
          and sc.school_day_end_time is not null
          and sc.start_date is not null
          and p_date between sc.start_date and coalesce(sc.end_date, sc.start_date)
      ), p_original_end)
    )
  end
$$;
revoke all on function public.scheduling_effective_end_time(date,time without time zone) from public;

-- Proposed rows remain structurally date-driven. Any client-supplied hours are ignored:
-- canonical hours are derived from the activity plus school_calendar on the server.
create or replace function public.scheduling_validate_proposed_meetings(
  p_activity_id text,
  p_meetings jsonb
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target public.activities;
  item jsonb;
  item_date date;
  last_date date;
  canonical jsonb := '[]'::jsonb;
  official_count integer;
  effective_end time without time zone;
begin
  select * into target from public.activities where row_id = p_activity_id;
  if not found then raise exception 'activity_not_found'; end if;
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
  if jsonb_array_length(p_meetings) <> official_count then
    raise exception 'scheduling_proposed_meeting_count_mismatch';
  end if;

  for item in select value from jsonb_array_elements(p_meetings) loop
    if nullif(item->>'date', '') is null then raise exception 'scheduling_proposed_dates_invalid'; end if;
    begin
      item_date := (item->>'date')::date;
    exception when others then
      raise exception 'scheduling_proposed_dates_invalid';
    end;
    if extract(dow from item_date) = 6 then raise exception 'scheduling_saturday_blocked'; end if;
    if exists (
      select 1 from public.school_calendar c
      where c.is_active = true
        and c.blocks_scheduling = true
        and c.start_date is not null
        and item_date between c.start_date and coalesce(c.end_date, c.start_date)
    ) then raise exception 'scheduling_school_calendar_blocked'; end if;
    if last_date is not null and item_date <= last_date then raise exception 'scheduling_proposed_dates_invalid'; end if;

    effective_end := public.scheduling_effective_end_time(item_date, target.end_time);
    if effective_end is null or effective_end <= target.start_time then
      raise exception 'scheduling_activity_hours_missing';
    end if;
    last_date := item_date;
    canonical := canonical || jsonb_build_array(jsonb_build_object(
      'date', item_date,
      'start_time', target.start_time,
      'end_time', effective_end
    ));
  end loop;
  return canonical;
end
$$;
revoke all on function public.scheduling_validate_proposed_meetings(text,jsonb) from public;

create or replace function public.scheduling_effective_meetings(
  p_activity public.activities,
  p_emp_id bigint
) returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(item order by item->>'date'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'date', (value->>'date')::date,
      'start_time', p_activity.start_time,
      'end_time', public.scheduling_effective_end_time((value->>'date')::date, p_activity.end_time)
    ) as item
    from jsonb_array_elements(
      case
        when p_activity.draft_emp_id = p_emp_id::text
          and p_activity.draft_proposed_meetings is not null
          then p_activity.draft_proposed_meetings
        else public.scheduling_activity_official_meetings(p_activity)
      end
    ) proposed(value)
    where nullif(value->>'date', '') is not null
      and not exists (
        select 1
        from public.course_meeting_cancellations cancellation
        where cancellation.activity_id = p_activity.row_id
          and cancellation.meeting_date = (value->>'date')::date
      )
  ) effective
$$;
revoke all on function public.scheduling_effective_meetings(public.activities,bigint) from public;

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

create or replace function public.scheduling_course_conflict_exists(
  p_activity_id text,
  p_emp_id bigint
) returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target public.activities;
begin
  select * into target from public.activities where row_id = p_activity_id;
  if not found or target.start_time is null or target.end_time is null then return false; end if;

  return exists (
    select 1
    from jsonb_array_elements(public.scheduling_effective_meetings(target, p_emp_id)) target_meeting(value)
    join public.activities a on a.row_id <> target.row_id
    cross join lateral jsonb_array_elements(public.scheduling_effective_meetings(a, p_emp_id)) other_meeting(value)
    where a.activity_season = 'school_2027'
      and lower(btrim(coalesce(a.status::text, ''))) not in ('סגור','נמחק','בוטל','closed','deleted','cancelled','canceled','inactive','לא פעיל')
      and (a.emp_id::text = p_emp_id::text or a.emp_id_2::text = p_emp_id::text or a.draft_emp_id = p_emp_id::text)
      and other_meeting.value->>'date' = target_meeting.value->>'date'
      and (other_meeting.value->>'start_time')::time < (target_meeting.value->>'end_time')::time
      and (target_meeting.value->>'start_time')::time < (other_meeting.value->>'end_time')::time
  );
end
$$;
revoke all on function public.scheduling_course_conflict_exists(text,bigint) from public;

create or replace function public.scheduling_assert_assignment_calendar(
  p_activity_id text,
  p_emp_id bigint,
  p_meetings jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.activities;
  meeting jsonb;
  other record;
  previous_activity record;
  next_activity record;
  target_location text;
  other_location text;
  required_minutes integer;
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
      required_minutes := public.scheduling_cached_travel_minutes(other_location, target_location);
      if nullif(btrim(coalesce(other_location, '')), '') is null
        or nullif(btrim(coalesce(target_location, '')), '') is null
        or required_minutes is null
      then raise exception 'scheduling_transition_unverified'; end if;
      gap_minutes := floor(extract(epoch from (target_start - previous_activity.effective_end_time)) / 60);
      if gap_minutes < required_minutes + 15 then raise exception 'scheduling_transition_insufficient'; end if;
    end if;

    if next_activity is not null and not (
      next_activity.school_id is not null
      and target.school_id is not null
      and next_activity.school_id = target.school_id
    ) then
      other_location := public.scheduling_school_location(next_activity.school_id, next_activity.school, next_activity.authority_id, next_activity.authority);
      required_minutes := public.scheduling_cached_travel_minutes(target_location, other_location);
      if nullif(btrim(coalesce(other_location, '')), '') is null
        or nullif(btrim(coalesce(target_location, '')), '') is null
        or required_minutes is null
      then raise exception 'scheduling_transition_unverified'; end if;
      gap_minutes := floor(extract(epoch from (next_activity.effective_start_time - target_end)) / 60);
      if gap_minutes < required_minutes + 15 then raise exception 'scheduling_transition_insufficient'; end if;
    end if;
  end loop;
end
$$;
revoke all on function public.scheduling_assert_assignment_calendar(text,bigint,jsonb) from public;

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

    if nullif(btrim(coalesce(profile.gender, '')), '') is null then
      if not ('scheduling_instructor_profile_incomplete' = any(violations)) then
        violations := array_append(violations, 'scheduling_instructor_profile_incomplete');
      end if;
    elsif coalesce(target.required_instructor_gender, 'any') in ('male','female')
      and profile.gender <> target.required_instructor_gender
    then violations := array_append(violations, 'scheduling_gender_mismatch'); end if;
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

-- Keep the legacy validator name aligned with the canonical Stage 2 contract. It is
-- retained for compatibility with old revalidation helpers, but no longer maintains a
-- separate set of recommendation rules.
create or replace function public.validate_course_instructor_assignment(
  p_activity_id text,
  p_emp_id bigint
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  violations text[];
begin
  violations := public.scheduling_course_instructor_violations(p_activity_id, p_emp_id, true);
  if coalesce(array_length(violations, 1), 0) > 0 then
    raise exception '%', violations[1];
  end if;
end
$$;
revoke all on function public.validate_course_instructor_assignment(text,bigint) from public;

-- Holiday blocking remains unchanged. For school_2027 courses only, a shortened-day
-- end is an effective per-meeting scheduling cap rather than a rejection of the course's
-- nominal global end_time. Other activity types keep the existing hard rejection.
create or replace function public.enforce_school_calendar_on_activity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  activity_date date;
  conflict_title text;
  shortened_title text;
  shortened_end_time time without time zone;
  scheduling_course boolean;
begin
  if coalesce(new.activity_season, '') like 'summer_%' then return new; end if;
  scheduling_course := coalesce(new.activity_season, '') = 'school_2027'
    and lower(btrim(coalesce(new.activity_type::text, ''))) in ('קורס','course','program');

  foreach activity_date in array array[
    new.start_date,
    new.date_1,new.date_2,new.date_3,new.date_4,new.date_5,new.date_6,new.date_7,new.date_8,new.date_9,new.date_10,
    new.date_11,new.date_12,new.date_13,new.date_14,new.date_15,new.date_16,new.date_17,new.date_18,new.date_19,new.date_20,
    new.date_21,new.date_22,new.date_23,new.date_24,new.date_25,new.date_26,new.date_27,new.date_28,new.date_29,new.date_30,
    new.date_31,new.date_32,new.date_33,new.date_34,new.date_35
  ] loop
    continue when activity_date is null;

    select sc.title into conflict_title
    from public.school_calendar sc
    where sc.is_active = true
      and sc.blocks_scheduling = true
      and sc.start_date is not null
      and activity_date between sc.start_date and coalesce(sc.end_date, sc.start_date)
    order by sc.start_date, sc.id
    limit 1;
    if conflict_title is not null then
      raise exception using
        errcode = '23514',
        message = 'activity_date_on_school_holiday',
        detail = activity_date::text || '|' || conflict_title;
    end if;
    conflict_title := null;

    if new.end_time is not null and not scheduling_course then
      select sc.title, sc.school_day_end_time into shortened_title, shortened_end_time
      from public.school_calendar sc
      where sc.is_active = true
        and sc.enforce_end_time = true
        and sc.school_day_end_time is not null
        and sc.start_date is not null
        and activity_date between sc.start_date and coalesce(sc.end_date, sc.start_date)
        and new.end_time > sc.school_day_end_time
      order by sc.start_date, sc.id
      limit 1;
      if shortened_title is not null then
        raise exception using
          errcode = '23514',
          message = 'activity_after_shortened_school_day',
          detail = activity_date::text || '|' || shortened_title || '|' || shortened_end_time::text;
      end if;
      shortened_title := null;
      shortened_end_time := null;
    end if;
  end loop;
  return new;
end
$$;
