-- Restore professional instructor matching gates for course scheduling.
-- Reviewed for production application.

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
  education_level text;
  course_key text;
  normalized_authorities text[];
  normalized_schools text[];
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
  if not found or nullif(btrim(coalesce(profile.course_restriction_mode, '')), '') is null then
    if not ('scheduling_instructor_profile_incomplete' = any(violations)) then
      violations := array_append(violations, 'scheduling_instructor_profile_incomplete');
    end if;
  else
    if nullif(btrim(coalesce(target.instruction_language, '')), '') is not null then
      if coalesce(cardinality(profile.instruction_languages), 0) = 0 then
        violations := array_append(violations, 'scheduling_instructor_profile_incomplete');
      elsif not (target.instruction_language = any(profile.instruction_languages)) then
        violations := array_append(violations, 'scheduling_language_mismatch');
      end if;
    end if;

    if coalesce(target.required_instructor_gender, 'any') <> 'any' then
      if nullif(btrim(coalesce(profile.gender, '')), '') is null then
        violations := array_append(violations, 'scheduling_instructor_profile_incomplete');
      elsif profile.gender <> target.required_instructor_gender then
        violations := array_append(violations, 'scheduling_gender_mismatch');
      end if;
    end if;

    education_level := nullif(btrim(coalesce(target.education_level, '')), '');
    if education_level is not null then
      if coalesce(cardinality(profile.education_levels), 0) = 0 then
        violations := array_append(violations, 'scheduling_instructor_profile_incomplete');
      elsif not (education_level = any(profile.education_levels)) then
        violations := array_append(violations, 'scheduling_education_level_mismatch');
      end if;
    end if;

    course_key := coalesce(nullif(btrim(target.catalog_slug), ''), nullif(btrim(target.activity_no), ''), nullif(btrim(target.proposal_item_id::text), ''), nullif(btrim(target.row_id), ''), nullif(btrim(target.activity_name), ''), '');
    if profile.course_restriction_mode = 'allow_only' then
      if course_key = '' or coalesce(cardinality(profile.course_ids), 0) = 0 then
        violations := array_append(violations, 'scheduling_instructor_profile_incomplete');
      elsif not (course_key = any(coalesce(profile.course_ids, '{}'::text[]))) then
        violations := array_append(violations, 'scheduling_course_not_allowed');
      end if;
    end if;
    if profile.course_restriction_mode = 'block_selected' and course_key <> '' and course_key = any(coalesce(profile.course_ids, '{}'::text[])) then
      violations := array_append(violations, 'scheduling_course_blocked');
    end if;

    select array_agg(lower(btrim(x))) into normalized_authorities from unnest(coalesce(profile.blocked_authorities, '{}'::text[])) x where nullif(btrim(x), '') is not null;
    if lower(btrim(coalesce(target.authority_id::text, ''))) = any(coalesce(normalized_authorities, '{}'::text[])) or lower(btrim(coalesce(target.authority, ''))) = any(coalesce(normalized_authorities, '{}'::text[])) then
      violations := array_append(violations, 'scheduling_authority_blocked');
    end if;
    select array_agg(lower(btrim(x))) into normalized_schools from unnest(coalesce(profile.blocked_schools, '{}'::text[])) x where nullif(btrim(x), '') is not null;
    if lower(btrim(coalesce(target.school_id::text, ''))) = any(coalesce(normalized_schools, '{}'::text[])) or lower(btrim(coalesce(target.school, ''))) = any(coalesce(normalized_schools, '{}'::text[])) then
      violations := array_append(violations, 'scheduling_school_blocked');
    end if;
  end if;

  if p_emp_id::text = any(coalesce(target.blocked_instructor_ids, '{}'::text[])) then
    violations := array_append(violations, 'scheduling_instructor_blocked');
  end if;
  if coalesce(cardinality(target.allowed_instructor_ids), 0) > 0 and not (p_emp_id::text = any(target.allowed_instructor_ids)) then
    violations := array_append(violations, 'scheduling_instructor_not_allowed');
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
  violations text[] := '{}';
begin
  if caller_role is null or caller_role not in ('admin','operation_manager') then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
  if not exists (select 1 from public.users u where u.auth_user_id = auth.uid() and u.is_active is true) then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;

  select * into selected_instructor from public.contacts_instructors where emp_id = p_emp_id;
  if not found then raise exception 'instructor_not_found'; end if;
  if btrim(coalesce(selected_instructor.full_name, '')) <> btrim(coalesce(p_instructor_name, '')) then raise exception 'instructor_name_mismatch'; end if;

  -- Serialize concurrent writes for this instructor before checking or writing anything;
  -- see scheduling_lock_instructor_for_write().
  perform public.scheduling_lock_instructor_for_write(p_emp_id);

  select * into result from public.activities where row_id = p_activity_id for update;
  if not found then raise exception 'activity_not_found'; end if;
  if coalesce(result.activity_season, '') <> 'school_2027' then raise exception 'scheduling_activity_not_school_2027'; end if;
  if lower(btrim(coalesce(result.status::text, ''))) not in ('פתוח','open') then raise exception 'scheduling_activity_not_open'; end if;
  if result.instructor_assignment_locked or nullif(result.emp_id::text, '') is not null then raise exception 'scheduling_assignment_locked'; end if;
  -- A draft holds a real calendar slot (spec section 21), so it is blocked by a genuine
  -- overlap exactly like a confirmed assignment: against another draft of the same
  -- instructor, or against an already-confirmed assignment of that instructor. Re-checked
  -- here, under the instructor lock, so a concurrent writer cannot slip in between the
  -- check and this write.
  violations := public.scheduling_course_instructor_violations(p_activity_id, p_emp_id, true);
  if coalesce(cardinality(violations), 0) > 0 then raise exception 'scheduling_requirements_not_met: %', array_to_string(violations, ','); end if;

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