-- Focused school_2027 scheduling contract synchronization.
-- This migration is intentionally data-free: no activity changes and no backfill.
-- Reapplying it is safe because it only replaces existing function definitions.
-- Travel transitions continue to be enforced centrally by
-- scheduling_assert_assignment_calendar as raw cached travel + one 15-minute buffer.

create or replace function public.scheduling_effective_meetings(
  p_activity public.activities,
  p_emp_id bigint
) returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(item order by item->>'date'), '[]'::jsonb)
  from (
    select value as item
    from jsonb_array_elements(
      case
        -- Proposed dates belong only to the instructor holding this exact draft.
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

revoke all on function public.scheduling_effective_meetings(public.activities, bigint) from public;

-- Operational replacement remains available regardless of how many meetings have
-- already occurred. Completed-meeting count is retained for audit only;
-- course status is never changed here and closure remains a separate manual action.
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
  if (p_decision_type in ('overridden','exception_approved') or p_new_emp_id is distinct from p_top_emp_id)
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


-- The legacy shared overlap helper remains part of the draft-save call graph, so it
-- is replaced as well. It no longer expands date_1...date_35 independently: both
-- sides use the same effective calendar as every other scheduling path.
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
      and nullif(target_meeting.value->>'date', '') is not null
      and other_meeting.value->>'date' = target_meeting.value->>'date'
      and a.start_time is not null and a.end_time is not null
      and a.start_time < target.end_time
      and target.start_time < a.end_time
  );
end
$$;
revoke all on function public.scheduling_course_conflict_exists(text, bigint) from public;

-- Canonical calendar assertion used by ordinary drafts, proposed-date drafts,
-- confirmations, replacements, and direct-write guards. Candidate cancellations are
-- skipped and all existing rows use scheduling_effective_meetings.
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

-- Canonical eligibility validation. Both the candidate calendar and every existing
-- calendar row are sourced through scheduling_effective_meetings, so owned drafts
-- participate and cancelled meetings do not. Every transition compares the available
-- gap with cached raw travel plus exactly one 15-minute buffer.
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

  select array_agg((effective.value->>'date')::date order by (effective.value->>'date')::date)
  into target_dates
  from jsonb_array_elements(public.scheduling_effective_meetings(target, p_emp_id)) effective(value)
  where nullif(effective.value->>'date', '') is not null;
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

-- Revalidation uses the same effective calendar and transition rule as initial
-- matching, draft save, confirmation, replacement, and direct-write guards.
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

  select array_agg((effective.value->>'date')::date order by (effective.value->>'date')::date)
  into target_dates
  from jsonb_array_elements(public.scheduling_effective_meetings(target, selected_emp_id)) effective(value)
  where nullif(effective.value->>'date', '') is not null;
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
