-- Align course-scheduling hard gates end-to-end:
-- * unknown home/transition routes are hard missing-data rejections
-- * home distance <= 40 km enforced from travel cache (exactly 40 valid)
-- * transition checks use raw travel + exactly one 15-minute buffer
-- * existing drafts cannot be overwritten
-- * cancelled meetings leave the calendar
-- * obsolete education/course/authority/school/instructor-list gates stay unused
-- * exception_approved no longer bypasses hard gates
-- * revalidation uses the same current gates
-- * completed meetings use Asia/Jerusalem date + end time

create or replace function public.scheduling_cached_travel_distance_km(p_origin text, p_destination text)
returns numeric
language sql
stable
security definer
set search_path=public
as $$
  select stc.distance_km
  from public.scheduling_travel_cache stc
  where stc.origin_key = public.scheduling_normalize_location(p_origin)
    and stc.destination_key = public.scheduling_normalize_location(p_destination)
    and stc.expires_at > now()
  order by stc.calculated_at desc
  limit 1
$$;
revoke all on function public.scheduling_cached_travel_distance_km(text,text) from public;

create or replace function public.scheduling_assert_home_route(p_emp_id bigint, p_activity_id text)
returns void
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  selected public.contacts_instructors;
  target public.activities;
  school_location text;
  home_km numeric;
begin
  select * into selected from public.contacts_instructors where emp_id = p_emp_id;
  if not found then raise exception 'instructor_not_found'; end if;
  if nullif(btrim(coalesce(selected.address, '')), '') is null then
    raise exception 'scheduling_instructor_profile_incomplete';
  end if;
  select * into target from public.activities where row_id = p_activity_id;
  if not found then raise exception 'activity_not_found'; end if;
  school_location := public.scheduling_school_location(target.school_id, target.school, target.authority_id, target.authority);
  if nullif(btrim(coalesce(school_location, '')), '') is null then
    raise exception 'scheduling_home_route_unverified';
  end if;
  home_km := public.scheduling_cached_travel_distance_km(selected.address, school_location);
  if home_km is null then
    raise exception 'scheduling_home_route_unverified';
  end if;
  if home_km > 40 then
    raise exception 'scheduling_home_distance_exceeded';
  end if;
end
$$;
revoke all on function public.scheduling_assert_home_route(bigint,text) from public;

-- Effective held calendar excludes cancelled meetings.
create or replace function public.scheduling_effective_meetings(p_activity public.activities, p_emp_id bigint)
returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(item order by item->>'date'), '[]'::jsonb)
  from (
    select value as item
    from jsonb_array_elements(
      case
        when p_activity.draft_emp_id = p_emp_id::text and p_activity.draft_proposed_meetings is not null
          then p_activity.draft_proposed_meetings
        else public.scheduling_activity_official_meetings(p_activity)
      end
    ) v(value)
    where nullif(value->>'date', '') is not null
      and not exists (
        select 1
        from public.course_meeting_cancellations c
        where c.activity_id = p_activity.row_id
          and c.meeting_date = (value->>'date')::date
      )
  ) filtered
$$;
revoke all on function public.scheduling_effective_meetings(public.activities,bigint) from public;

create or replace function public.scheduling_course_meetings_completed(p_activity_id text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with target as (
    select a.* from public.activities a where a.row_id = p_activity_id
  ),
  distinct_dates as (
    select distinct nullif(to_jsonb(t)->>('date_' || n), '')::date as meeting_date
    from target t, generate_series(1, 35) n
  ),
  cancelled as (
    select meeting_date from public.course_meeting_cancellations where activity_id = p_activity_id
  ),
  approved as (
    select distinct activity_date as meeting_date
    from public.activity_completion_approval_uploads
    where status = 'approved'
      and activity_date is not null
      and (
        activity_row_id = p_activity_id
        or (',' || activity_row_id || ',') like ('%,' || p_activity_id || ',%')
      )
  ),
  clock as (
    select timezone('Asia/Jerusalem', now()) as now_il
  )
  select count(*)::integer
  from distinct_dates d
  cross join target t
  cross join clock c
  where d.meeting_date is not null
    and d.meeting_date not in (select meeting_date from cancelled)
    and (
      d.meeting_date in (select meeting_date from approved)
      or c.now_il::date > d.meeting_date
      or (
        c.now_il::date = d.meeting_date
        and t.end_time is not null
        and c.now_il::time >= t.end_time
      )
    )
$$;
revoke all on function public.scheduling_course_meetings_completed(text) from public;
grant execute on function public.scheduling_course_meetings_completed(text) to authenticated;

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
  home_km numeric;
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
  from (
    select nullif(to_jsonb(target)->>('date_' || n), '')::date as d
    from generate_series(1, 35) n
  ) dates
  where d is not null
    and not exists (
      select 1 from public.course_meeting_cancellations c
      where c.activity_id = target.row_id and c.meeting_date = d
    );
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

    -- Gender is mandatory even when the activity requirement is "any".
    if nullif(btrim(coalesce(profile.gender, '')), '') is null then
      if not ('scheduling_instructor_profile_incomplete' = any(violations)) then
        violations := array_append(violations, 'scheduling_instructor_profile_incomplete');
      end if;
    elsif coalesce(target.required_instructor_gender, 'any') in ('male', 'female')
      and profile.gender <> target.required_instructor_gender then
      violations := array_append(violations, 'scheduling_gender_mismatch');
    end if;
  end if;

  target_location := public.scheduling_school_location(target.school_id, target.school, target.authority_id, target.authority);
  target_duration := floor(extract(epoch from (target.end_time - target.start_time)) / 60);

  if nullif(btrim(coalesce(selected_instructor.address, '')), '') is not null then
    if nullif(btrim(coalesce(target_location, '')), '') is null then
      raise exception 'scheduling_home_route_unverified';
    end if;
    home_km := public.scheduling_cached_travel_distance_km(selected_instructor.address, target_location);
    if home_km is null then
      raise exception 'scheduling_home_route_unverified';
    elsif home_km > 40 then
      raise exception 'scheduling_home_distance_exceeded';
    end if;
  end if;

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
      select 1
      from public.activities a
      cross join lateral jsonb_array_elements(public.scheduling_effective_meetings(a, p_emp_id)) effective(value)
      where a.row_id <> target.row_id
        and a.activity_season = 'school_2027'
        and lower(btrim(coalesce(a.status::text, ''))) not in ('סגור','נמחק','בוטל','closed','deleted','cancelled','canceled','inactive','לא פעיל')
        and (a.emp_id::text = p_emp_id::text or a.emp_id_2::text = p_emp_id::text or a.draft_emp_id = p_emp_id::text)
        and effective.value->>'date' = meeting.meeting_date::text
        and a.start_time < target.end_time and target.start_time < a.end_time
    ) then raise exception 'scheduling_conflict_detected'; end if;

    previous_activity := null;
    select a.* into previous_activity
    from public.activities a
    cross join lateral jsonb_array_elements(public.scheduling_effective_meetings(a, p_emp_id)) effective(value)
    where a.row_id <> target.row_id
      and a.activity_season = 'school_2027'
      and lower(btrim(coalesce(a.status::text, ''))) not in ('סגור','נמחק','בוטל','closed','deleted','cancelled','canceled','inactive','לא פעיל')
      and (a.emp_id::text = p_emp_id::text or a.emp_id_2::text = p_emp_id::text or a.draft_emp_id = p_emp_id::text)
      and effective.value->>'date' = meeting.meeting_date::text
      and a.end_time <= target.start_time
    order by a.end_time desc
    limit 1;

    if found and not (
      (previous_activity.school_id is not null and target.school_id is not null and previous_activity.school_id = target.school_id)
      or lower(btrim(coalesce(previous_activity.school, ''))) = lower(btrim(coalesce(target.school, '')))
    ) then
      previous_location := public.scheduling_school_location(previous_activity.school_id, previous_activity.school, previous_activity.authority_id, previous_activity.authority);
      if nullif(btrim(coalesce(previous_location, '')), '') is null or nullif(btrim(coalesce(target_location, '')), '') is null then
        raise exception 'scheduling_transition_unverified';
      end if;
      required_minutes := public.scheduling_cached_travel_minutes(previous_location, target_location);
      if required_minutes is null then
        raise exception 'scheduling_transition_unverified';
      end if;
      gap_minutes := floor(extract(epoch from (target.start_time - previous_activity.end_time)) / 60);
      if gap_minutes < required_minutes + 15 then raise exception 'scheduling_transition_insufficient'; end if;
    end if;

    next_activity := null;
    select a.* into next_activity
    from public.activities a
    cross join lateral jsonb_array_elements(public.scheduling_effective_meetings(a, p_emp_id)) effective(value)
    where a.row_id <> target.row_id
      and a.activity_season = 'school_2027'
      and lower(btrim(coalesce(a.status::text, ''))) not in ('סגור','נמחק','בוטל','closed','deleted','cancelled','canceled','inactive','לא פעיל')
      and (a.emp_id::text = p_emp_id::text or a.emp_id_2::text = p_emp_id::text or a.draft_emp_id = p_emp_id::text)
      and effective.value->>'date' = meeting.meeting_date::text
      and a.start_time >= target.end_time
    order by a.start_time
    limit 1;

    if found and not (
      (next_activity.school_id is not null and target.school_id is not null and next_activity.school_id = target.school_id)
      or lower(btrim(coalesce(next_activity.school, ''))) = lower(btrim(coalesce(target.school, '')))
    ) then
      next_location := public.scheduling_school_location(next_activity.school_id, next_activity.school, next_activity.authority_id, next_activity.authority);
      if nullif(btrim(coalesce(next_location, '')), '') is null or nullif(btrim(coalesce(target_location, '')), '') is null then
        raise exception 'scheduling_transition_unverified';
      end if;
      required_minutes := public.scheduling_cached_travel_minutes(target_location, next_location);
      if required_minutes is null then
        raise exception 'scheduling_transition_unverified';
      end if;
      gap_minutes := floor(extract(epoch from (next_activity.start_time - target.end_time)) / 60);
      if gap_minutes < required_minutes + 15 then raise exception 'scheduling_transition_insufficient'; end if;
    end if;

    previous_end := null;
    chain_count := 0;
    for session_row in
      select sessions.start_time, sessions.end_time from (
        select target.start_time, target.end_time
        union all
        select a.start_time, a.end_time
        from public.activities a
        cross join lateral jsonb_array_elements(public.scheduling_effective_meetings(a, p_emp_id)) effective(value)
        where a.row_id <> target.row_id
          and a.activity_season = 'school_2027'
          and lower(btrim(coalesce(a.status::text, ''))) not in ('סגור','נמחק','בוטל','closed','deleted','cancelled','canceled','inactive','לא פעיל')
          and (a.emp_id::text = p_emp_id::text or a.emp_id_2::text = p_emp_id::text or a.draft_emp_id = p_emp_id::text)
          and effective.value->>'date' = meeting.meeting_date::text
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
        if not ('scheduling_daily_sequence_exceeded' = any(violations)) then
          violations := array_append(violations, 'scheduling_daily_sequence_exceeded');
        end if;
      end if;
    end loop;
  end loop;

  return violations;
end
$$;
revoke all on function public.scheduling_course_instructor_violations(text, bigint, boolean) from public;
grant execute on function public.scheduling_course_instructor_violations(text, bigint, boolean) to authenticated;

-- Calendar assert: keep +15 buffer, exclude cancelled via effective meetings (already),
-- and hard-reject unverified transitions.
create or replace function public.scheduling_assert_assignment_calendar(p_activity_id text, p_emp_id bigint, p_meetings jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare
  target public.activities; meeting jsonb; other record; previous_activity public.activities; next_activity public.activities;
  target_location text; other_location text; required_minutes integer; gap_minutes integer;
  previous_end time; chain_count integer; target_duration integer;
begin
  select * into target from public.activities where row_id=p_activity_id;
  if not found then raise exception 'activity_not_found'; end if;
  p_meetings := public.scheduling_validate_proposed_meetings(p_activity_id,p_meetings);
  target_location := public.scheduling_school_location(target.school_id,target.school,target.authority_id,target.authority);
  target_duration := floor(extract(epoch from (target.end_time-target.start_time))/60);

  for meeting in select value from jsonb_array_elements(p_meetings) loop
    if exists (
      select 1 from public.course_meeting_cancellations c
      where c.activity_id = p_activity_id and c.meeting_date = (meeting->>'date')::date
    ) then
      continue;
    end if;
    previous_activity := null; next_activity := null; previous_end := null; chain_count := 0;
    for other in
      select a.*
      from public.activities a
      cross join lateral jsonb_array_elements(public.scheduling_effective_meetings(a,p_emp_id)) effective(value)
      where a.row_id<>p_activity_id and a.activity_season='school_2027'
        and lower(btrim(coalesce(a.status::text,''))) not in ('סגור','נמחק','בוטל','closed','deleted','cancelled','canceled','inactive','לא פעיל')
        and (a.emp_id::text=p_emp_id::text or a.emp_id_2::text=p_emp_id::text or a.draft_emp_id=p_emp_id::text)
        and effective.value->>'date'=meeting->>'date' and a.start_time is not null and a.end_time is not null
      order by a.start_time
    loop
      if other.start_time < target.end_time and target.start_time < other.end_time then raise exception 'scheduling_conflict_detected'; end if;
      if other.end_time <= target.start_time and (previous_activity is null or other.end_time > previous_activity.end_time) then previous_activity := other; end if;
      if other.start_time >= target.end_time and (next_activity is null or other.start_time < next_activity.start_time) then next_activity := other; end if;
      if previous_end is null or floor(extract(epoch from (other.start_time-previous_end))/60)>30 then chain_count:=1; else chain_count:=chain_count+1; end if;
      previous_end := greatest(coalesce(previous_end,other.end_time),other.end_time);
    end loop;

    if previous_activity is not null and not ((previous_activity.school_id is not null and target.school_id is not null and previous_activity.school_id=target.school_id) or lower(btrim(coalesce(previous_activity.school,'')))=lower(btrim(coalesce(target.school,'')))) then
      other_location := public.scheduling_school_location(previous_activity.school_id,previous_activity.school,previous_activity.authority_id,previous_activity.authority);
      required_minutes := public.scheduling_cached_travel_minutes(other_location,target_location);
      if nullif(btrim(coalesce(other_location,'')),'') is null or nullif(btrim(coalesce(target_location,'')),'') is null or required_minutes is null then raise exception 'scheduling_transition_unverified'; end if;
      gap_minutes := floor(extract(epoch from (target.start_time-previous_activity.end_time))/60);
      if gap_minutes < required_minutes + 15 then raise exception 'scheduling_transition_insufficient'; end if;
    end if;
    if next_activity is not null and not ((next_activity.school_id is not null and target.school_id is not null and next_activity.school_id=target.school_id) or lower(btrim(coalesce(next_activity.school,'')))=lower(btrim(coalesce(target.school,'')))) then
      other_location := public.scheduling_school_location(next_activity.school_id,next_activity.school,next_activity.authority_id,next_activity.authority);
      required_minutes := public.scheduling_cached_travel_minutes(target_location,other_location);
      if nullif(btrim(coalesce(other_location,'')),'') is null or nullif(btrim(coalesce(target_location,'')),'') is null or required_minutes is null then raise exception 'scheduling_transition_unverified'; end if;
      gap_minutes := floor(extract(epoch from (next_activity.start_time-target.end_time))/60);
      if gap_minutes < required_minutes + 15 then raise exception 'scheduling_transition_insufficient'; end if;
    end if;

    previous_end := null; chain_count := 0;
    for other in
      select s.start_time,s.end_time from (
        select target.start_time,target.end_time
        union all
        select a.start_time,a.end_time from public.activities a
        cross join lateral jsonb_array_elements(public.scheduling_effective_meetings(a,p_emp_id)) effective(value)
        where a.row_id<>p_activity_id and a.activity_season='school_2027'
          and lower(btrim(coalesce(a.status::text,''))) not in ('סגור','נמחק','בוטל','closed','deleted','cancelled','canceled','inactive','לא פעיל')
          and (a.emp_id::text=p_emp_id::text or a.emp_id_2::text=p_emp_id::text or a.draft_emp_id=p_emp_id::text)
          and effective.value->>'date'=meeting->>'date'
      )s where s.start_time is not null and s.end_time is not null order by s.start_time
    loop
      if previous_end is null or floor(extract(epoch from (other.start_time-previous_end))/60)>30 then chain_count:=1; else chain_count:=chain_count+1; end if;
      previous_end:=greatest(coalesce(previous_end,other.end_time),other.end_time);
      if (target_duration>=80 and chain_count>3) or (target_duration<80 and chain_count>5) then raise exception 'scheduling_daily_sequence_exceeded'; end if;
    end loop;
  end loop;
end $$;
revoke all on function public.scheduling_assert_assignment_calendar(text,bigint,jsonb) from public;

-- Guard writes also enforce the home-route hard gate.
create or replace function public.scheduling_guard_activity_calendar_write()
returns trigger language plpgsql security definer set search_path=public as $$
declare holder bigint; holders bigint[]:='{}'; meetings jsonb;
begin
  if new.activity_season is distinct from 'school_2027'
    or lower(btrim(coalesce(new.activity_type::text,''))) not in ('קורס','course','program')
    or lower(btrim(coalesce(new.status::text,''))) not in ('פתוח','open') then return new; end if;
  if (old.draft_emp_id is distinct from new.draft_emp_id or old.draft_proposed_meetings is distinct from new.draft_proposed_meetings)
    and nullif(new.draft_emp_id,'') is not null then holders:=array_append(holders,new.draft_emp_id::bigint); end if;
  if old.emp_id is distinct from new.emp_id and new.emp_id is not null and not (new.emp_id::bigint=any(holders)) then holders:=array_append(holders,new.emp_id::bigint); end if;
  if old.emp_id_2 is distinct from new.emp_id_2 and new.emp_id_2 is not null and not (new.emp_id_2::bigint=any(holders)) then holders:=array_append(holders,new.emp_id_2::bigint); end if;
  foreach holder in array holders loop
    meetings:=case when new.draft_emp_id=holder::text and new.draft_proposed_meetings is not null then new.draft_proposed_meetings else public.scheduling_activity_official_meetings(new) end;
    perform public.scheduling_lock_instructor_for_write(holder);
    perform public.scheduling_assert_home_route(holder, new.row_id);
    perform public.scheduling_assert_assignment_calendar(new.row_id,holder,meetings);
  end loop;
  return new;
end $$;

create or replace function public.assign_activity_instructor(
  p_activity_id text,
  p_emp_id bigint,
  p_instructor_name text,
  p_top_emp_id bigint,
  p_selected_score integer,
  p_top_score integer,
  p_decision_type text,
  p_reason text default null
) returns public.activities
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.activities;
  selected_instructor public.contacts_instructors;
  caller_role text := public.app_current_role();
  prior_status text;
  violations text[];
  final_status text;
begin
  if caller_role is null or caller_role not in ('admin','operation_manager') then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
  if not exists (select 1 from public.users u where u.auth_user_id = auth.uid() and u.is_active is true) then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
  if p_decision_type not in ('approved','overridden','exception_approved') then raise exception 'invalid_decision_type'; end if;
  if (p_decision_type in ('overridden','exception_approved') or p_emp_id is distinct from p_top_emp_id)
    and nullif(btrim(p_reason), '') is null
  then raise exception 'scheduling_reason_required'; end if;

  perform public.scheduling_lock_instructor_for_write(p_emp_id);

  violations := public.scheduling_course_instructor_violations(p_activity_id, p_emp_id, true);
  -- Hard gates cannot be bypassed through exception_approved.
  if coalesce(array_length(violations, 1), 0) > 0 then
    raise exception '%', violations[1];
  end if;

  select * into selected_instructor from public.contacts_instructors where emp_id = p_emp_id;
  if btrim(coalesce(selected_instructor.full_name, '')) <> btrim(coalesce(p_instructor_name, '')) then raise exception 'instructor_name_mismatch'; end if;

  select * into result from public.activities where row_id = p_activity_id for update;
  prior_status := result.instructor_assignment_status;
  final_status := 'שובץ';

  update public.activities
  set emp_id = p_emp_id,
      instructor_name = selected_instructor.full_name,
      instructor_assignment_locked = true,
      instructor_assignment_status = final_status,
      draft_emp_id = null,
      draft_instructor_name = null,
      draft_created_at = null,
      draft_created_by = null
  where row_id = p_activity_id
  returning * into result;

  insert into public.instructor_assignment_audit(
    activity_id, selected_emp_id, selected_instructor_name, top_recommended_emp_id,
    selected_score, top_score, decision_type, reason, previous_status, new_status,
    bypassed_constraints, meetings_completed_at_decision
  ) values (
    p_activity_id, p_emp_id::text, selected_instructor.full_name, p_top_emp_id::text,
    p_selected_score, p_top_score, p_decision_type, nullif(btrim(p_reason), ''), prior_status, final_status,
    '{}', 0
  );
  return result;
end
$$;
revoke all on function public.assign_activity_instructor(text,bigint,text,bigint,integer,integer,text,text) from public;
grant execute on function public.assign_activity_instructor(text,bigint,text,bigint,integer,integer,text,text) to authenticated;

create or replace function public.save_course_assignment_draft(
  p_activity_id text,
  p_emp_id bigint,
  p_instructor_name text,
  p_top_emp_id bigint default null,
  p_selected_score integer default null,
  p_top_score integer default null
) returns public.activities
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.activities;
  selected_instructor public.contacts_instructors;
  caller_role text := public.app_current_role();
  violations text[];
begin
  if caller_role is null or caller_role not in ('admin','operation_manager') then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
  if not exists (select 1 from public.users u where u.auth_user_id = auth.uid() and u.is_active is true) then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;

  select * into selected_instructor from public.contacts_instructors where emp_id = p_emp_id;
  if not found then raise exception 'instructor_not_found'; end if;
  if btrim(coalesce(selected_instructor.full_name, '')) <> btrim(coalesce(p_instructor_name, '')) then raise exception 'instructor_name_mismatch'; end if;

  perform public.scheduling_lock_instructor_for_write(p_emp_id);

  select * into result from public.activities where row_id = p_activity_id for update;
  if not found then raise exception 'activity_not_found'; end if;
  if coalesce(result.activity_season, '') <> 'school_2027' then raise exception 'scheduling_activity_not_school_2027'; end if;
  if lower(btrim(coalesce(result.status::text, ''))) not in ('פתוח','open') then raise exception 'scheduling_activity_not_open'; end if;
  if result.instructor_assignment_locked or nullif(result.emp_id::text, '') is not null then raise exception 'scheduling_assignment_locked'; end if;
  if nullif(btrim(coalesce(result.draft_emp_id, '')), '') is not null then
    raise exception 'הקורס כבר נשמר כטיוטה';
  end if;

  violations := public.scheduling_course_instructor_violations(p_activity_id, p_emp_id, true);
  if coalesce(array_length(violations, 1), 0) > 0 then
    raise exception '%', violations[1];
  end if;
  if public.scheduling_course_conflict_exists(p_activity_id, p_emp_id) then raise exception 'scheduling_conflict_detected'; end if;

  update public.activities
  set draft_emp_id = p_emp_id::text,
      draft_instructor_name = selected_instructor.full_name,
      draft_created_at = now(),
      draft_created_by = auth.uid()
  where row_id = p_activity_id
  returning * into result;

  insert into public.instructor_assignment_audit(
    activity_id, selected_emp_id, selected_instructor_name, top_recommended_emp_id,
    selected_score, top_score, decision_type, previous_status, new_status
  ) values (
    p_activity_id, p_emp_id::text, selected_instructor.full_name, p_top_emp_id::text,
    p_selected_score, p_top_score, 'draft', result.instructor_assignment_status, result.instructor_assignment_status
  );
  return result;
end
$$;
revoke all on function public.save_course_assignment_draft(text,bigint,text,bigint,integer,integer) from public;
grant execute on function public.save_course_assignment_draft(text,bigint,text,bigint,integer,integer) to authenticated;

create or replace function public.save_course_assignment_draft_with_dates(
  p_activity_id text,p_emp_id bigint,p_instructor_name text,p_proposed_meetings jsonb,
  p_top_emp_id bigint default null,p_selected_score integer default null,p_top_score integer default null
) returns public.activities language plpgsql security definer set search_path=public as $$
declare result public.activities; selected_instructor public.contacts_instructors; canonical jsonb; caller_role text:=public.app_current_role();
begin
  if caller_role is null or caller_role not in ('admin','operation_manager') or not exists(select 1 from public.users u where u.auth_user_id=auth.uid() and u.is_active) then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
  select * into selected_instructor from public.contacts_instructors where emp_id=p_emp_id;
  if not found then raise exception 'instructor_not_found'; end if;
  if btrim(coalesce(selected_instructor.full_name,''))<>btrim(coalesce(p_instructor_name,'')) then raise exception 'instructor_name_mismatch'; end if;
  perform public.scheduling_lock_instructor_for_write(p_emp_id);
  select * into result from public.activities where row_id=p_activity_id for update;
  if not found then raise exception 'activity_not_found'; end if;
  if result.activity_season<>'school_2027' then raise exception 'scheduling_activity_not_school_2027'; end if;
  if lower(btrim(coalesce(result.activity_type::text,''))) not in ('קורס','course','program') then raise exception 'scheduling_activity_not_course'; end if;
  if lower(btrim(coalesce(result.status::text,''))) not in ('פתוח','open') then raise exception 'scheduling_activity_not_open'; end if;
  if result.instructor_assignment_locked or nullif(result.emp_id::text,'') is not null then raise exception 'scheduling_assignment_locked'; end if;
  if nullif(btrim(coalesce(result.draft_emp_id, '')), '') is not null then
    raise exception 'הקורס כבר נשמר כטיוטה';
  end if;
  canonical:=public.scheduling_validate_proposed_meetings(p_activity_id,p_proposed_meetings);
  perform public.scheduling_assert_proposed_eligibility(p_activity_id,p_emp_id,canonical);
  perform public.scheduling_assert_home_route(p_emp_id, p_activity_id);
  perform public.scheduling_assert_assignment_calendar(p_activity_id,p_emp_id,canonical);
  update public.activities set draft_emp_id=p_emp_id::text,draft_instructor_name=selected_instructor.full_name,
    draft_created_at=now(),draft_created_by=auth.uid(),draft_proposed_meetings=canonical
  where row_id=p_activity_id returning * into result;
  insert into public.instructor_assignment_audit(activity_id,selected_emp_id,selected_instructor_name,top_recommended_emp_id,selected_score,top_score,decision_type,previous_status,new_status)
  values(p_activity_id,p_emp_id::text,selected_instructor.full_name,p_top_emp_id::text,p_selected_score,p_top_score,'draft',result.instructor_assignment_status,result.instructor_assignment_status);
  return result;
end $$;
revoke all on function public.save_course_assignment_draft_with_dates(text,bigint,text,jsonb,bigint,integer,integer) from public;
grant execute on function public.save_course_assignment_draft_with_dates(text,bigint,text,jsonb,bigint,integer,integer) to authenticated;

create or replace function public.reassign_locked_course_instructor(
  p_activity_id text,
  p_new_emp_id bigint,
  p_new_instructor_name text,
  p_top_emp_id bigint,
  p_selected_score integer,
  p_top_score integer,
  p_decision_type text,
  p_reason text default null
) returns public.activities
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.activities;
  selected_instructor public.contacts_instructors;
  caller_role text := public.app_current_role();
  prior_status text;
  prior_emp_id text;
  prior_instructor_name text;
  violations text[];
  final_status text;
  meetings_done integer;
begin
  if caller_role is null or caller_role not in ('admin','operation_manager') then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
  if not exists (select 1 from public.users u where u.auth_user_id = auth.uid() and u.is_active is true) then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
  if p_decision_type not in ('approved','overridden','exception_approved') then raise exception 'invalid_decision_type'; end if;

  select * into result from public.activities where row_id = p_activity_id for update;
  if not found then raise exception 'activity_not_found'; end if;
  if nullif(result.emp_id::text, '') is null then raise exception 'scheduling_no_existing_assignment'; end if;

  meetings_done := public.scheduling_course_meetings_completed(p_activity_id);
  if meetings_done >= 2 then raise exception 'scheduling_course_locked_for_reassignment'; end if;
  if (meetings_done >= 1 or p_decision_type in ('overridden','exception_approved') or p_new_emp_id is distinct from p_top_emp_id)
    and nullif(btrim(p_reason), '') is null
  then raise exception 'scheduling_reason_required'; end if;

  perform public.scheduling_lock_instructor_for_write(p_new_emp_id);

  violations := public.scheduling_course_instructor_violations(p_activity_id, p_new_emp_id, false);
  if coalesce(array_length(violations, 1), 0) > 0 then
    raise exception '%', violations[1];
  end if;

  select * into selected_instructor from public.contacts_instructors where emp_id = p_new_emp_id;
  if btrim(coalesce(selected_instructor.full_name, '')) <> btrim(coalesce(p_new_instructor_name, '')) then raise exception 'instructor_name_mismatch'; end if;

  prior_status := result.instructor_assignment_status;
  prior_emp_id := result.emp_id::text;
  prior_instructor_name := result.instructor_name;
  final_status := 'שובץ';

  update public.activities
  set emp_id = p_new_emp_id,
      instructor_name = selected_instructor.full_name,
      instructor_assignment_locked = true,
      instructor_assignment_status = final_status
  where row_id = p_activity_id
  returning * into result;

  insert into public.instructor_assignment_audit(
    activity_id, selected_emp_id, selected_instructor_name, top_recommended_emp_id,
    selected_score, top_score, decision_type, reason, previous_status, new_status,
    bypassed_constraints, meetings_completed_at_decision, previous_emp_id, previous_instructor_name
  ) values (
    p_activity_id, p_new_emp_id::text, selected_instructor.full_name, p_top_emp_id::text,
    p_selected_score, p_top_score, p_decision_type, nullif(btrim(p_reason), ''), prior_status, final_status,
    '{}', meetings_done, prior_emp_id, prior_instructor_name
  );
  return result;
end
$$;
revoke all on function public.reassign_locked_course_instructor(text,bigint,text,bigint,integer,integer,text,text) from public;
grant execute on function public.reassign_locked_course_instructor(text,bigint,text,bigint,integer,integer,text,text) to authenticated;

create or replace function public.scheduling_assignment_sensitive_changed(
  p_old public.activities,
  p_new public.activities
) returns boolean
language plpgsql
immutable
as $$
declare
  n integer;
begin
  if p_old.activity_season is distinct from p_new.activity_season
    or p_old.activity_type is distinct from p_new.activity_type
    or p_old.status is distinct from p_new.status
    or p_old.start_time is distinct from p_new.start_time
    or p_old.end_time is distinct from p_new.end_time
    or p_old.start_date is distinct from p_new.start_date
    or p_old.end_date is distinct from p_new.end_date
    or p_old.school_id is distinct from p_new.school_id
    or p_old.school is distinct from p_new.school
    or p_old.authority_id is distinct from p_new.authority_id
    or p_old.authority is distinct from p_new.authority
    or p_old.instruction_language is distinct from p_new.instruction_language
    or p_old.required_instructor_gender is distinct from p_new.required_instructor_gender
  then
    return true;
  end if;

  for n in 1..35 loop
    if to_jsonb(p_old)->>('date_' || n) is distinct from to_jsonb(p_new)->>('date_' || n) then
      return true;
    end if;
  end loop;
  return false;
end
$$;

create or replace function public.scheduling_locked_course_validation_reason(
  p_activity_id text
) returns text
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  target public.activities;
  selected_instructor public.contacts_instructors;
  profile public.instructor_scheduling_profiles;
  meeting record;
  availability record;
  previous_activity public.activities;
  next_activity public.activities;
  target_location text;
  previous_location text;
  next_location text;
  required_minutes integer;
  gap_minutes integer;
  home_km numeric;
  v_weekday integer;
  target_dates date[];
  selected_emp_id bigint;
begin
  select * into target from public.activities where row_id = p_activity_id;
  if not found then return 'activity_not_found'; end if;

  if coalesce(target.activity_season, '') <> 'school_2027'
    or lower(btrim(coalesce(target.activity_type::text, ''))) not in ('קורס','course','program')
    or lower(btrim(coalesce(target.status::text, ''))) not in ('פתוח','open')
  then
    return null;
  end if;

  if target.instructor_assignment_locked is not true then return null; end if;
  if target.emp_id is null then
    if nullif(btrim(coalesce(target.emp_id_2::text, '')), '') is not null then
      return 'scheduling_secondary_assignment_requires_review';
    end if;
    return 'scheduling_assignment_missing';
  end if;
  selected_emp_id := target.emp_id;

  select * into selected_instructor from public.contacts_instructors where emp_id = selected_emp_id;
  if not found then return 'instructor_not_found'; end if;
  if lower(coalesce(selected_instructor.active::text, 'yes')) in ('no','false','0','לא פעיל') then return 'instructor_inactive'; end if;
  if nullif(btrim(coalesce(selected_instructor.address, '')), '') is null then return 'scheduling_instructor_profile_incomplete'; end if;

  select * into profile from public.instructor_scheduling_profiles where emp_id = selected_emp_id;
  if not found then return 'scheduling_instructor_profile_incomplete'; end if;
  if coalesce(cardinality(profile.instruction_languages), 0) = 0 then return 'scheduling_instructor_profile_incomplete'; end if;
  if nullif(btrim(coalesce(profile.gender, '')), '') is null then return 'scheduling_instructor_profile_incomplete'; end if;

  if nullif(btrim(coalesce(target.instruction_language, '')), '') is not null
    and not (target.instruction_language = any(profile.instruction_languages))
  then return 'scheduling_language_mismatch'; end if;

  if coalesce(target.required_instructor_gender, 'any') in ('male','female')
    and profile.gender is distinct from target.required_instructor_gender
  then return 'scheduling_gender_mismatch'; end if;

  select array_agg(d order by d) into target_dates
  from (
    select nullif(to_jsonb(target)->>('date_' || n), '')::date as d
    from generate_series(1,35) n
  ) dates
  where d is not null
    and not exists (
      select 1 from public.course_meeting_cancellations c
      where c.activity_id = target.row_id and c.meeting_date = d
    );
  if coalesce(cardinality(target_dates), 0) = 0 then return 'scheduling_activity_dates_missing'; end if;
  if target.start_time is null or target.end_time is null or target.start_time >= target.end_time then return 'scheduling_activity_hours_missing'; end if;

  target_location := public.scheduling_school_location(target.school_id, target.school, target.authority_id, target.authority);
  if nullif(btrim(coalesce(target_location, '')), '') is null then return 'scheduling_home_route_unverified'; end if;
  home_km := public.scheduling_cached_travel_distance_km(selected_instructor.address, target_location);
  if home_km is null then return 'scheduling_home_route_unverified'; end if;
  if home_km > 40 then return 'scheduling_home_distance_exceeded'; end if;

  for meeting in select unnest(target_dates) as meeting_date loop
    v_weekday := extract(dow from meeting.meeting_date)::integer;
    if v_weekday = 6 then return 'scheduling_saturday_blocked'; end if;
    if v_weekday = 5 and coalesce(profile.friday_allowed, false) is not true then return 'scheduling_friday_not_allowed'; end if;

    select x.available, x.start_time, x.end_time into availability
    from (
      select e.available, e.start_time, e.end_time, 1 as priority
      from public.instructor_availability_exceptions e
      where e.emp_id = selected_emp_id and e.exception_date = meeting.meeting_date
      union all
      select r.available, r.start_time, r.end_time, 2 as priority
      from public.instructor_availability_rules r
      where r.emp_id = selected_emp_id and r.weekday = v_weekday
    ) x
    order by x.priority
    limit 1;
    if not found then return 'scheduling_availability_missing'; end if;
    if availability.available is not true
      or availability.start_time is null
      or availability.end_time is null
      or target.start_time < availability.start_time
      or target.end_time > availability.end_time
    then return 'scheduling_instructor_unavailable'; end if;

    if exists (
      select 1
      from public.activities a
      cross join lateral jsonb_array_elements(public.scheduling_effective_meetings(a, selected_emp_id)) effective(value)
      where a.row_id <> target.row_id
        and a.activity_season = 'school_2027'
        and lower(btrim(coalesce(a.status::text, ''))) not in ('סגור','נמחק','בוטל','closed','deleted','cancelled','canceled','inactive','לא פעיל')
        and (a.emp_id::text = selected_emp_id::text or a.emp_id_2::text = selected_emp_id::text or a.draft_emp_id = selected_emp_id::text)
        and effective.value->>'date' = meeting.meeting_date::text
        and a.start_time < target.end_time
        and target.start_time < a.end_time
    ) then return 'scheduling_conflict_detected'; end if;

    previous_activity := null;
    select a.* into previous_activity
    from public.activities a
    cross join lateral jsonb_array_elements(public.scheduling_effective_meetings(a, selected_emp_id)) effective(value)
    where a.row_id <> target.row_id
      and a.activity_season = 'school_2027'
      and lower(btrim(coalesce(a.status::text, ''))) not in ('סגור','נמחק','בוטל','closed','deleted','cancelled','canceled','inactive','לא פעיל')
      and (a.emp_id::text = selected_emp_id::text or a.emp_id_2::text = selected_emp_id::text or a.draft_emp_id = selected_emp_id::text)
      and effective.value->>'date' = meeting.meeting_date::text
      and a.end_time <= target.start_time
    order by a.end_time desc
    limit 1;

    if found and not (
      (previous_activity.school_id is not null and target.school_id is not null and previous_activity.school_id = target.school_id)
      or lower(btrim(coalesce(previous_activity.school, ''))) = lower(btrim(coalesce(target.school, '')))
    ) then
      previous_location := public.scheduling_school_location(previous_activity.school_id, previous_activity.school, previous_activity.authority_id, previous_activity.authority);
      if nullif(btrim(coalesce(previous_location, '')), '') is null
        or nullif(btrim(coalesce(target_location, '')), '') is null
      then return 'scheduling_transition_unverified'; end if;
      required_minutes := public.scheduling_cached_travel_minutes(previous_location, target_location);
      if required_minutes is null then return 'scheduling_transition_unverified'; end if;
      gap_minutes := floor(extract(epoch from (target.start_time - previous_activity.end_time)) / 60);
      if gap_minutes < required_minutes + 15 then return 'scheduling_transition_insufficient'; end if;
    end if;

    next_activity := null;
    select a.* into next_activity
    from public.activities a
    cross join lateral jsonb_array_elements(public.scheduling_effective_meetings(a, selected_emp_id)) effective(value)
    where a.row_id <> target.row_id
      and a.activity_season = 'school_2027'
      and lower(btrim(coalesce(a.status::text, ''))) not in ('סגור','נמחק','בוטל','closed','deleted','cancelled','canceled','inactive','לא פעיל')
      and (a.emp_id::text = selected_emp_id::text or a.emp_id_2::text = selected_emp_id::text or a.draft_emp_id = selected_emp_id::text)
      and effective.value->>'date' = meeting.meeting_date::text
      and a.start_time >= target.end_time
    order by a.start_time
    limit 1;

    if found and not (
      (next_activity.school_id is not null and target.school_id is not null and next_activity.school_id = target.school_id)
      or lower(btrim(coalesce(next_activity.school, ''))) = lower(btrim(coalesce(target.school, '')))
    ) then
      next_location := public.scheduling_school_location(next_activity.school_id, next_activity.school, next_activity.authority_id, next_activity.authority);
      if nullif(btrim(coalesce(next_location, '')), '') is null
        or nullif(btrim(coalesce(target_location, '')), '') is null
      then return 'scheduling_transition_unverified'; end if;
      required_minutes := public.scheduling_cached_travel_minutes(target_location, next_location);
      if required_minutes is null then return 'scheduling_transition_unverified'; end if;
      gap_minutes := floor(extract(epoch from (next_activity.start_time - target.end_time)) / 60);
      if gap_minutes < required_minutes + 15 then return 'scheduling_transition_insufficient'; end if;
    end if;
  end loop;

  return null;
exception
  when others then
    return 'scheduling_revalidation_error:' || sqlstate || ':' || sqlerrm;
end
$$;

-- Revalidate locked assignments when instructor profile/address/availability/travel cache change.
create or replace function public.scheduling_revalidate_assignments_for_instructor(p_emp_id bigint, p_reason text)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare activity_row record;
begin
  if p_emp_id is null then return; end if;
  for activity_row in
    select a.row_id
    from public.activities a
    where a.activity_season = 'school_2027'
      and lower(btrim(coalesce(a.activity_type::text, ''))) in ('קורס','course','program')
      and lower(btrim(coalesce(a.status::text, ''))) in ('פתוח','open')
      and a.instructor_assignment_locked is true
      and (a.emp_id = p_emp_id or a.emp_id_2 = p_emp_id)
  loop
    perform public.scheduling_apply_course_assignment_revalidation(activity_row.row_id, p_reason);
  end loop;
end
$$;
revoke all on function public.scheduling_revalidate_assignments_for_instructor(bigint,text) from public;

create or replace function public.scheduling_revalidate_after_instructor_change()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op = 'UPDATE' and (old.active is not distinct from new.active) and (old.address is not distinct from new.address) then
    return new;
  end if;
  perform public.scheduling_revalidate_assignments_for_instructor(new.emp_id, 'instructor_profile_changed');
  return new;
end $$;

drop trigger if exists contacts_instructors_revalidate_assignments on public.contacts_instructors;
create trigger contacts_instructors_revalidate_assignments
after update of active, address on public.contacts_instructors
for each row execute function public.scheduling_revalidate_after_instructor_change();

create or replace function public.scheduling_revalidate_after_scheduling_profile_change()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op = 'UPDATE'
    and old.gender is not distinct from new.gender
    and old.instruction_languages is not distinct from new.instruction_languages
    and old.friday_allowed is not distinct from new.friday_allowed
  then return new; end if;
  perform public.scheduling_revalidate_assignments_for_instructor(new.emp_id, 'instructor_scheduling_profile_changed');
  return new;
end $$;

drop trigger if exists instructor_scheduling_profiles_revalidate_assignments on public.instructor_scheduling_profiles;
create trigger instructor_scheduling_profiles_revalidate_assignments
after insert or update of gender, instruction_languages, friday_allowed on public.instructor_scheduling_profiles
for each row execute function public.scheduling_revalidate_after_scheduling_profile_change();

create or replace function public.scheduling_revalidate_after_availability_change()
returns trigger language plpgsql security definer set search_path=public as $$
declare emp bigint;
begin
  emp := coalesce(new.emp_id, old.emp_id);
  perform public.scheduling_revalidate_assignments_for_instructor(emp, 'instructor_availability_changed');
  return coalesce(new, old);
end $$;

drop trigger if exists instructor_availability_rules_revalidate_assignments on public.instructor_availability_rules;
create trigger instructor_availability_rules_revalidate_assignments
after insert or update or delete on public.instructor_availability_rules
for each row execute function public.scheduling_revalidate_after_availability_change();

drop trigger if exists instructor_availability_exceptions_revalidate_assignments on public.instructor_availability_exceptions;
create trigger instructor_availability_exceptions_revalidate_assignments
after insert or update or delete on public.instructor_availability_exceptions
for each row execute function public.scheduling_revalidate_after_availability_change();

create or replace function public.scheduling_revalidate_after_travel_cache_change()
returns trigger language plpgsql security definer set search_path=public as $$
declare activity_row record;
begin
  if tg_op = 'UPDATE'
    and old.distance_km is not distinct from new.distance_km
    and old.duration_minutes is not distinct from new.duration_minutes
    and old.expires_at is not distinct from new.expires_at
  then return new; end if;

  for activity_row in
    select distinct a.row_id
    from public.activities a
    join public.contacts_instructors i on i.emp_id = a.emp_id
    where a.activity_season = 'school_2027'
      and lower(btrim(coalesce(a.activity_type::text, ''))) in ('קורס','course','program')
      and lower(btrim(coalesce(a.status::text, ''))) in ('פתוח','open')
      and a.instructor_assignment_locked is true
      and (
        public.scheduling_normalize_location(i.address) = coalesce(new.origin_key, old.origin_key)
        or public.scheduling_normalize_location(public.scheduling_school_location(a.school_id, a.school, a.authority_id, a.authority))
           in (coalesce(new.origin_key, old.origin_key), coalesce(new.destination_key, old.destination_key))
      )
  loop
    perform public.scheduling_apply_course_assignment_revalidation(activity_row.row_id, 'travel_cache_changed');
  end loop;
  return coalesce(new, old);
end $$;

drop trigger if exists scheduling_travel_cache_revalidate_assignments on public.scheduling_travel_cache;
create trigger scheduling_travel_cache_revalidate_assignments
after insert or update of distance_km, duration_minutes, expires_at on public.scheduling_travel_cache
for each row execute function public.scheduling_revalidate_after_travel_cache_change();

create or replace function public.scheduling_revalidate_after_cancellation_change()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform public.scheduling_apply_course_assignment_revalidation(
    coalesce(new.activity_id, old.activity_id),
    'meeting_cancellation_changed'
  );
  return coalesce(new, old);
end $$;

drop trigger if exists course_meeting_cancellations_revalidate_assignments on public.course_meeting_cancellations;
create trigger course_meeting_cancellations_revalidate_assignments
after insert or update or delete on public.course_meeting_cancellations
for each row execute function public.scheduling_revalidate_after_cancellation_change();

comment on function public.scheduling_assert_home_route(bigint, text) is
  'Rejects writes when the instructor home→school cached driving route is missing or above 40 km.';
comment on function public.scheduling_course_instructor_violations(text, bigint, boolean) is
  'Current hard scheduling gates for assignment/draft validation. Obsolete education/course/authority/school/instructor-list restrictions are not consulted.';
