-- Hard course exclusion via existing instructor_scheduling_profiles fields.
-- Works for current-year courses from the catalog or activity list.
-- Approved/live assignments remain unchanged. Only NEW proposals/assignments fail.
-- Both manual paths, v37 server validation and the UI planner enforce the same rule.

-- Reject unregistered codes even from direct API writes (not only from UI).
create or replace function public.scheduling_validate_instructor_blocked_course_ids()
returns trigger language plpgsql security definer set search_path to ''
as $function$
begin
  if new.course_restriction_mode = 'block_selected' then
    if exists (
      select 1 from unnest(coalesce(new.course_ids, '{}'::text[])) code(value)
      where nullif(btrim(code.value), '') is null
         or not (
           exists (
             select 1 from public.catalog_program_details cp
             where cp.activity_no = btrim(code.value)
               and cp.is_active_for_catalog is true
               and lower(coalesce(cp.item_type,'')) in ('קורס','קורסים','course','program','תוכנית','תכנית')
           )
           or exists (
             select 1 from public.activities act
             where act.activity_no = btrim(code.value)
               and act.activity_season = 'school_2027'
               and lower(coalesce(act.activity_type,'')) in ('קורס','קורסים','course','program','תוכנית','תכנית')
               and lower(coalesce(act.status,'')) not in ('בוטל','cancelled','canceled','נמחק','deleted','inactive','לא פעיל')
           )
         )
    ) then raise exception 'scheduling_blocked_course_unknown' using errcode='23514';
    end if;
  end if;
  return new;
end
$function$;
drop trigger if exists instructor_course_ids_catalog_validation on public.instructor_scheduling_profiles;
create trigger instructor_course_ids_catalog_validation
before insert or update of course_restriction_mode,course_ids
on public.instructor_scheduling_profiles
for each row execute function public.scheduling_validate_instructor_blocked_course_ids();
revoke all on function public.scheduling_validate_instructor_blocked_course_ids() from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.scheduling_course_instructor_violations(p_activity_id text, p_emp_id bigint, p_expect_unassigned boolean DEFAULT true, p_skip_meeting_dates date[] DEFAULT NULL::date[])
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

  target_location := public.scheduling_school_location(target.school_id, target.school, target.authority_id, target.authority);
  if nullif(btrim(coalesce(selected_instructor.address, '')), '') is not null then
    if nullif(btrim(coalesce(target_location, '')), '') is null then raise exception 'scheduling_home_route_unverified'; end if;
    home_km := public.scheduling_cached_travel_distance_km(selected_instructor.address, target_location);
    if home_km is null then raise exception 'scheduling_home_route_unverified'; end if;
    if home_km > 40 then raise exception 'scheduling_home_distance_exceeded'; end if;
  end if;

  for meeting in select value from jsonb_array_elements(effective_rows) loop
    meeting_date := (meeting->>'date')::date;
    if p_skip_meeting_dates is not null and meeting_date = any(p_skip_meeting_dates) then
      continue;
    end if;
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
      if public.scheduling_transition_distance_cap_applies(gap_minutes) and required_km > 20 then raise exception 'scheduling_transition_distance_exceeded'; end if;
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
      if public.scheduling_transition_distance_cap_applies(gap_minutes) and required_km > 20 then raise exception 'scheduling_transition_distance_exceeded'; end if;
      if gap_minutes < required_minutes + public.scheduling_transition_buffer_minutes(required_km) then raise exception 'scheduling_transition_insufficient'; end if;
    end if;

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
      if public.scheduling_transition_distance_cap_applies(gap_minutes) and required_km > 20 then
        if not ('scheduling_transition_distance_exceeded' = any(violations)) then
          violations := array_append(violations, 'scheduling_transition_distance_exceeded');
        end if;
      end if;
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
      if public.scheduling_transition_distance_cap_applies(gap_minutes) and required_km > 20 then
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
CREATE OR REPLACE FUNCTION public.scheduling_v37_workspace_validation(p_workspace_id uuid, p_prior_rows jsonb DEFAULT '[]'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  workspace public.scheduling_planning_workspaces;
  prior_payload jsonb := coalesce(p_prior_rows, '[]'::jsonb);
  bad_official text;
begin
  if auth.uid() is null or not public.app_has_permission('view_operations_scheduling') then
    raise exception 'scheduling_permission_denied' using errcode = '42501';
  end if;

  select * into workspace
  from public.scheduling_planning_workspaces
  where id = p_workspace_id;
  if not found then
    raise exception 'planning_workspace_not_found';
  end if;
  if workspace.engine_version is distinct from 'planning-v37-20261010-constraint-block-planner' then
    raise exception 'planning_engine_version_conflict';
  end if;

  create temporary table if not exists tmp_scheduling_v37_plan_rows (
    activity_id text primary key,
    row_data jsonb not null,
    locked_option jsonb
  ) on commit drop;
  truncate tmp_scheduling_v37_plan_rows;

  insert into tmp_scheduling_v37_plan_rows(activity_id, row_data, locked_option)
  select r.activity_id, r.row_data, r.locked_option
  from public.scheduling_planning_rows r
  where r.workspace_id = p_workspace_id;

  -- A full workspace cannot silently drop approved or open activities in scope.
  if exists (
    select 1
    from public.activities a
    cross join lateral (
      select coalesce(
        min(nullif(to_jsonb(a)->>('date_' || n), ''))::date,
        a.start_date
      ) as first_date
      from generate_series(1, 35) n
    ) dates
    where a.activity_season = 'school_2027'
      and lower(coalesce(a.status, '')) not in (
        'סגור','closed','בוטל','cancelled','canceled','נמחק','deleted','inactive','לא פעיל'
      )
      and lower(coalesce(a.activity_type, '')) in (
        'course','program','קורס','קורסים','תוכנית','תכנית',
        'workshop','סדנה','סדנא','סדנאות','tour','סיור','סיורים'
      )
      and (workspace.district = '' or btrim(coalesce(a.district, '')) = workspace.district)
      and case workspace.period_key
        when 'year' then dates.first_date is null or dates.first_date between date '2026-09-01' and date '2027-06-30'
        when 'first' then dates.first_date is null or dates.first_date between date '2026-09-01' and date '2027-01-29'
        when 'second' then dates.first_date between date '2027-01-31' and date '2027-06-30'
        else false
      end
      and not exists (
        select 1 from tmp_scheduling_v37_plan_rows pr where pr.activity_id = a.row_id
      )
  ) then
    raise exception 'planning_server_activity_missing';
  end if;

  -- Row integrity: protected identity/dates come from activities + explicit locks.
  if exists (
    select 1
    from tmp_scheduling_v37_plan_rows item
    left join public.activities source on source.row_id = item.activity_id
    where source.row_id is null
       or item.row_data->>'courseId' is distinct from item.activity_id
  ) then
    raise exception 'planning_activity_changed';
  end if;

  if exists (
    select 1
    from tmp_scheduling_v37_plan_rows item
    where jsonb_typeof(item.row_data->'meetings') is distinct from 'array'
  ) then
    raise exception 'planning_server_invalid_meetings';
  end if;

  with expected as (
    select
      item.activity_id,
      coalesce(
        jsonb_agg(
          jsonb_build_array(d.value::date, source.start_time, source.end_time)
          order by d.num
        ),
        '[]'::jsonb
      ) as expected
    from tmp_scheduling_v37_plan_rows item
    join public.activities source on source.row_id = item.activity_id
    cross join lateral (
      select g.num, to_jsonb(source)->>('date_' || g.num) as value
      from generate_series(1, 35) g(num)
    ) d
    where d.value is not null
      and not exists (
        select 1
        from public.course_meeting_cancellations c
        where c.activity_id = source.row_id
          and c.meeting_date = d.value::date
      )
    group by item.activity_id
  ), actual as (
    select
      item.activity_id,
      coalesce(
        jsonb_agg(
          jsonb_build_array(
            (m.value->>'date')::date,
            nullif(m.value->>'start_time','')::time,
            nullif(m.value->>'end_time','')::time
          )
          order by m.ordinality
        ),
        '[]'::jsonb
      ) as actual
    from tmp_scheduling_v37_plan_rows item
    cross join lateral jsonb_array_elements(item.row_data->'meetings') with ordinality m(value, ordinality)
    group by item.activity_id
  )
  select e.activity_id into bad_official
  from expected e
  left join actual a on a.activity_id = e.activity_id
  where jsonb_array_length(e.expected) > 0
    and coalesce(a.actual, '[]'::jsonb) is distinct from e.expected
  order by e.activity_id
  limit 1;
  if bad_official is not null then
    raise exception 'planning_server_official_dates_changed: %', bad_official;
  end if;

  if exists (
    select 1
    from tmp_scheduling_v37_plan_rows item
    join public.activities source on source.row_id = item.activity_id
    where (source.emp_id is not null or source.emp_id_2 is not null or source.instructor_assignment_locked is true)
      and nullif(item.row_data->>'instructorEmpId', '')
        is distinct from coalesce(source.emp_id::text, source.emp_id_2)
  ) then
    raise exception 'planning_server_protected_instructor_changed';
  end if;

  if exists (
    select 1
    from tmp_scheduling_v37_plan_rows item
    join public.activities source on source.row_id = item.activity_id
    where coalesce(item.row_data->'additionalInstructorEmpIds', '[]'::jsonb)
      is distinct from (
        case
          when source.emp_id is not null and source.emp_id_2 is not null
            then jsonb_build_array(source.emp_id_2::text)
          else '[]'::jsonb
        end
      )
  ) then
    raise exception 'planning_server_coteacher_changed';
  end if;

  if exists (
    select 1
    from tmp_scheduling_v37_plan_rows item
    join public.activities source on source.row_id = item.activity_id
    cross join lateral jsonb_array_elements(item.row_data->'meetings') m
    -- History is unique on (activity_id, meeting_date): preserve the
    -- substitution rule while eliminating one lateral lookup per meeting.
    left join public.course_meeting_instructor_history h
      on h.activity_id = source.row_id
     and h.meeting_date = (m->>'date')::date
    where
      (h.emp_id is not null
        and coalesce(nullif(m->>'substituteEmpId', ''), nullif(m->>'emp_id', '')) is not null
        and coalesce(nullif(m->>'substituteEmpId', ''), nullif(m->>'emp_id', '')) is distinct from h.emp_id)
      or
      (h.emp_id is null
        and coalesce(
          nullif(m->>'substituteEmpId', ''),
          nullif(m->>'emp_id', ''),
          nullif(item.row_data->>'instructorEmpId', '')
        ) is distinct from nullif(item.row_data->>'instructorEmpId', ''))
  ) then
    raise exception 'planning_server_meeting_instructor_changed';
  end if;

  if exists (
    select 1
    from tmp_scheduling_v37_plan_rows item
    join public.activities source on source.row_id = item.activity_id
    where source.emp_id is null
      and source.emp_id_2 is null
      and source.instructor_assignment_locked is not true
      and nullif(item.row_data->>'instructorEmpId', '') is not null
      and exists (
        select 1
        from jsonb_array_elements(item.row_data->'meetings') with ordinality m(value, num)
        join jsonb_array_elements(item.row_data->'meetings') with ordinality n(value, num)
          on m.num < n.num
        where m.value->>'date' = n.value->>'date'
          and (m.value->>'start_time')::time < (n.value->>'end_time')::time
          and (m.value->>'end_time')::time > (n.value->>'start_time')::time
      )
  ) then
    raise exception 'planning_server_self_overlap';
  end if;

  if exists (
    select 1
    from tmp_scheduling_v37_plan_rows item
    join public.activities source on source.row_id = item.activity_id
    where source.emp_id is null
      and source.emp_id_2 is null
      and source.instructor_assignment_locked is not true
      and nullif(item.row_data->>'instructorEmpId', '') is not null
      and not exists (
        select 1
        from generate_series(1, 35) g(num)
        where nullif(to_jsonb(source)->>('date_' || g.num), '') is not null
      )
      and (
        exists (
          select 1
          from jsonb_array_elements(item.row_data->'meetings') m
          where (m->>'date')::date not between date '2026-09-01' and date '2027-06-30'
        )
        or exists (
          select 1
          from jsonb_array_elements(item.row_data->'meetings') m
          where (source.start_time is not null and (m->>'start_time')::time is distinct from source.start_time)
             or (source.end_time is not null and (m->>'end_time')::time is distinct from source.end_time)
        )
        or (source.start_date is not null
            and (item.row_data->'meetings'->0->>'date')::date is distinct from source.start_date)
      )
  ) then
    raise exception 'planning_server_scope_changed';
  end if;

  if exists (
    select 1
    from tmp_scheduling_v37_plan_rows item
    where item.locked_option is not null
      and (
        item.row_data->>'instructorEmpId' is distinct from item.locked_option->>'instructorEmpId'
        or item.row_data->'meetings' is distinct from item.locked_option->'meetings'
      )
  ) then
    raise exception 'planning_server_lock_changed';
  end if;

  create temporary table if not exists tmp_scheduling_v37_meetings (
    course_id text not null,
    activity_no text,
    instructor bigint,
    meeting_date date,
    start_time time,
    end_time time,
    school_id bigint,
    sector text,
    authority text,
    instruction_language text,
    required_instructor_gender text,
    school_address text,
    school_key text,
    protected_source boolean not null,
    full_day boolean not null
  ) on commit drop;
  truncate tmp_scheduling_v37_meetings;

  -- Materialize planned + instructor-scoped external blockers once.
  with planned as (
    select
      pr.activity_id as course_id,
      pr.row_data as r,
      pr.locked_option,
      a.row_id,
      a.school_id,
      a.school,
      a.authority_id,
      a.authority,
      a.instruction_language,
      a.required_instructor_gender,
      a.emp_id,
      a.emp_id_2,
      a.instructor_assignment_locked,
      a.activity_type,
      a.activity_no,
      a.activity_name,
      a.start_time,
      a.end_time,
      a.draft_emp_id,
      a.draft_proposed_meetings,
      -- Evaluate locked-row parity once per activity, not per expanded meeting.
      (pr.locked_option is not null and exists (
        select 1 from jsonb_array_elements(prior_payload) old
        where old->>'courseId' = pr.activity_id
          and old->'lockedOption' = pr.locked_option
          and old->'row'->>'instructorEmpId' = pr.row_data->>'instructorEmpId'
          and old->'row'->'meetings' = pr.row_data->'meetings'
      )) as same_prior_locked,
      true as is_planned
    from tmp_scheduling_v37_plan_rows pr
    join public.activities a on a.row_id = pr.activity_id
  ), plan_instructors as (
    select distinct nullif(btrim(x), '') as emp_txt
    from planned p
    cross join lateral (
      select p.r->>'instructorEmpId'
      union all
      select jsonb_array_elements_text(coalesce(p.r->'additionalInstructorEmpIds', '[]'::jsonb))
      union all
      select m->>'substituteEmpId' from jsonb_array_elements(coalesce(p.r->'meetings', '[]'::jsonb)) m
      union all
      select m->>'emp_id' from jsonb_array_elements(coalesce(p.r->'meetings', '[]'::jsonb)) m
    ) s(x)
    where nullif(btrim(x), '') is not null
  ), blockers as (
    select
      a.row_id as course_id,
      jsonb_build_object(
        'instructorEmpId', coalesce(a.emp_id::text, a.emp_id_2::text, a.draft_emp_id),
        'meetings', case
          when a.emp_id is null and a.emp_id_2 is null and a.draft_proposed_meetings is not null
            then a.draft_proposed_meetings
          else public.scheduling_activity_official_meetings(a)
        end
      ) as r,
      null::jsonb as locked_option,
      a.row_id,
      a.school_id,
      a.school,
      a.authority_id,
      a.authority,
      a.instruction_language,
      a.required_instructor_gender,
      a.emp_id,
      a.emp_id_2,
      a.instructor_assignment_locked,
      a.activity_type,
      a.activity_no,
      a.activity_name,
      a.start_time,
      a.end_time,
      a.draft_emp_id,
      a.draft_proposed_meetings,
      false as same_prior_locked,
      false as is_planned
    from public.activities a
    where lower(coalesce(a.status, '')) not in (
        'בוטל','cancelled','canceled','נמחק','deleted','inactive','לא פעיל'
      )
      and (
        a.emp_id::text in (select emp_txt from plan_instructors)
        or coalesce(a.emp_id_2, '') in (select emp_txt from plan_instructors)
        or coalesce(nullif(a.draft_emp_id, ''), '') in (select emp_txt from plan_instructors)
      )
      and not exists (select 1 from planned p where p.row_id = a.row_id)
  ), all_rows as (
    select * from planned
    union all
    select * from blockers
  ), school_meta as (
    select distinct
      a.school_id,
      a.school,
      a.authority_id,
      a.authority,
      public.school_calendar_sector_for_school_id(a.school_id) as sector,
      public.scheduling_school_location(a.school_id, a.school, a.authority_id, a.authority) as school_address
    from all_rows a
    where a.school_id is not null
  )
  insert into tmp_scheduling_v37_meetings (
    course_id, activity_no, instructor, meeting_date, start_time, end_time, school_id, sector, authority,
    instruction_language, required_instructor_gender, school_address, school_key,
    protected_source, full_day
  )
  select
    a.course_id,
    a.activity_no,
    nullif(btrim(teacher.emp_id), '')::bigint,
    (m.value->>'date')::date,
    coalesce(nullif(m.value->>'start_time', '')::time, a.start_time),
    coalesce(nullif(m.value->>'end_time', '')::time, a.end_time),
    a.school_id,
    sm.sector,
    a.authority,
    a.instruction_language,
    a.required_instructor_gender,
    sm.school_address,
    public.scheduling_normalize_location(sm.school_address),
    (
      a.emp_id is not null
      or a.emp_id_2 is not null
      or a.instructor_assignment_locked is true
      or (
        a.locked_option is not null
        and a.same_prior_locked
      )
      or not a.is_planned
    ) as protected_source,
    (
      lower(coalesce(a.activity_type, '')) in ('tour','סיור','סיורים')
      or coalesce(a.activity_no, '') = '13990'
      or coalesce(a.activity_name, '') like '%התנסות בתעשייה%'
    ) as full_day
  from all_rows a
  left join school_meta sm on sm.school_id = a.school_id
  cross join lateral jsonb_array_elements(coalesce(a.r->'meetings', '[]'::jsonb)) m(value)
  cross join lateral (
    select coalesce(
      nullif(m.value->>'substituteEmpId', ''),
      nullif(m.value->>'emp_id', ''),
      nullif(a.r->>'instructorEmpId', '')
    ) as emp_id
    union
    select a.emp_id_2::text
    where a.emp_id is not null and a.emp_id_2 is not null
  ) teacher
  where nullif(a.r->>'instructorEmpId', '') is not null
    and not exists (
      select 1
      from public.course_meeting_cancellations c
      where c.activity_id = a.row_id
        and c.meeting_date = (m.value->>'date')::date
    );

  create index if not exists tmp_scheduling_v37_meetings_instr_date_idx
    on tmp_scheduling_v37_meetings (instructor, meeting_date, start_time, course_id);

  if exists (
    select 1
    from tmp_scheduling_v37_meetings m
    left join public.contacts_instructors i on i.emp_id = m.instructor
    left join public.instructor_scheduling_profiles p on p.emp_id = m.instructor
    left join public.instructor_availability_exceptions e
      on e.emp_id = m.instructor and e.exception_date = m.meeting_date
    left join public.instructor_availability_rules r
      on r.emp_id = m.instructor and r.weekday = extract(dow from m.meeting_date)
    left join public.scheduling_travel_cache travel
      on travel.origin_key = public.scheduling_normalize_location(i.address)
     and travel.destination_key = m.school_key
    where not m.protected_source and (
      i.emp_id is null
      or lower(coalesce(i.active::text, '')) not in ('yes','true','כן')
      or p.gender is null or p.gender not in ('male','female')
      or coalesce(cardinality(p.instruction_languages), 0) = 0
      or m.instruction_language is null
      or not (m.instruction_language = any (p.instruction_languages))
      -- New, unprotected proposals cannot use a personally blocked program.
      or (p.course_restriction_mode = 'block_selected'
          and nullif(btrim(coalesce(m.activity_no, '')), '') = any(coalesce(p.course_ids, '{}'::text[])))
      or (m.required_instructor_gender in ('male','female')
          and m.required_instructor_gender is distinct from p.gender)
      or exists (
        select 1
        from unnest(p.blocked_authorities) b(name)
        where public.scheduling_normalize_location(b.name)
          = public.scheduling_normalize_location(m.authority)
      )
      or nullif(btrim(i.address), '') is null
      or m.school_id is null
      or nullif(m.sector, '') is null
      or nullif(btrim(m.school_address), '') is null
      or m.start_time is null or m.end_time is null or m.end_time <= m.start_time
      or not coalesce(case when e.emp_id is not null then e.available else r.available end, false)
      or (case when e.emp_id is not null then e.start_time else r.start_time end) is null
      or (case when e.emp_id is not null then e.end_time else r.end_time end) is null
      or m.start_time < case when e.emp_id is not null then e.start_time else r.start_time end
      or m.end_time > case when e.emp_id is not null then e.end_time else r.end_time end
      or (extract(dow from m.meeting_date) = 5 and p.friday_allowed is distinct from true)
      or (extract(dow from m.meeting_date) = 6 and m.sector not in ('arab','druze'))
      or (
        public.scheduling_normalize_location(i.address) is distinct from m.school_key
        and (
          travel.distance_km is null or travel.duration_minutes is null
          or travel.distance_km > 40 or travel.distance_km < 0 or travel.duration_minutes < 0
        )
      )
    )
  ) then
    raise exception 'planning_server_candidate_constraint_failed';
  end if;

  if exists (
    select 1
    from tmp_scheduling_v37_meetings m
    join public.school_calendar c
      on c.is_active is true
     and m.meeting_date between c.start_date and coalesce(c.end_date, c.start_date)
     and c.calendar_sector in ('general', m.sector)
    where not m.protected_source
      and (c.blocks_scheduling is true
           or (c.enforce_end_time is true and m.end_time > c.school_day_end_time))
  ) then
    raise exception 'planning_server_calendar_constraint_failed';
  end if;

  if exists (
    select 1
    from tmp_scheduling_v37_meetings a
    join tmp_scheduling_v37_meetings b
      on a.instructor = b.instructor
     and a.meeting_date = b.meeting_date
     and a.course_id <> b.course_id
    where not (a.protected_source and b.protected_source)
      and (a.full_day or b.full_day or (a.start_time < b.end_time and a.end_time > b.start_time))
  ) then
    raise exception 'planning_server_overlap';
  end if;

  if exists (
    with adjacent as (
      select
        m.*,
        lag(course_id) over w as previous_course,
        lag(end_time) over w as previous_end,
        lag(school_id) over w as previous_school,
        lag(school_key) over w as previous_key,
        lag(protected_source) over w as previous_protected
      from tmp_scheduling_v37_meetings m
      window w as (partition by instructor, meeting_date order by start_time, course_id)
    )
    select 1
    from adjacent m
    left join public.scheduling_travel_cache t
      on t.origin_key = m.previous_key
     and t.destination_key = m.school_key
    where m.previous_course is not null
      and m.previous_course <> m.course_id
      and m.previous_school is distinct from m.school_id
      and not (m.protected_source and m.previous_protected)
      and (
        case
          when m.previous_key = m.school_key
            then extract(epoch from (m.start_time - m.previous_end)) / 60 < 5
          else
            t.distance_km is null or t.duration_minutes is null
            or t.distance_km > 20 or t.distance_km < 0 or t.duration_minutes < 0
            or extract(epoch from (m.start_time - m.previous_end)) / 60
              < t.duration_minutes + case when t.distance_km <= 5 then 5 else 15 end
        end
      )
  ) then
    raise exception 'planning_server_transition_constraint_failed';
  end if;
end;
$function$
;
