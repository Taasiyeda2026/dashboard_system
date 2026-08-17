-- Finalize an explicit manual instructor choice without re-applying soft recommendation gates.
--
-- A manual override is trusted only when it is backed by the current persisted draft and
-- the matching audit row written by save_course_assignment_manual_draft().  The client
-- cannot enable this path with a flag.
--
-- Normal recommendation/draft confirmation keeps the full
-- scheduling_course_instructor_violations() validation unchanged.
-- Manual confirmation keeps hard feasibility gates: activity state, active instructor,
-- valid meetings, Saturday/explicit Friday availability, explicit unavailability,
-- real overlap, and known-insufficient travel transitions.  Soft/unknown fit signals such
-- as home distance > 40 km, missing route data, profile completeness, language/gender fit,
-- missing availability rows, and unverified transition routes remain warnings only.

create or replace function public.scheduling_manual_assignment_hard_violations(
  p_activity_id text,
  p_emp_id bigint
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
  if coalesce(target.activity_season, '') <> 'school_2027' then raise exception 'scheduling_activity_not_school_2027'; end if;
  if lower(btrim(coalesce(target.activity_type::text, ''))) not in ('קורס','course','program') then raise exception 'scheduling_activity_not_course'; end if;
  if lower(btrim(coalesce(target.status::text, ''))) not in ('פתוח','open') then raise exception 'scheduling_activity_not_open'; end if;
  if target.instructor_assignment_locked
    or nullif(target.emp_id::text, '') is not null
    or nullif(btrim(coalesce(target.instructor_name, '')), '') is not null
  then raise exception 'scheduling_assignment_locked'; end if;

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

  select * into profile
  from public.instructor_scheduling_profiles
  where emp_id = p_emp_id;

  target_location := public.scheduling_school_location(
    target.school_id,
    target.school,
    target.authority_id,
    target.authority
  );

  for meeting in select value from jsonb_array_elements(effective_rows) loop
    meeting_date := (meeting->>'date')::date;
    target_start := (meeting->>'start_time')::time;
    target_end := (meeting->>'end_time')::time;
    v_weekday := extract(dow from meeting_date)::integer;

    if v_weekday = 6 then
      raise exception 'scheduling_saturday_blocked';
    end if;

    -- Friday is a hard blocker only when the instructor has an explicit profile saying no.
    -- A missing profile is unknown fit data and remains a manual-selection warning.
    if v_weekday = 5 and found and profile.friday_allowed is false then
      if not ('scheduling_friday_not_allowed' = any(violations)) then
        violations := array_append(violations, 'scheduling_friday_not_allowed');
      end if;
    end if;

    availability := null;
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

    -- Missing availability data is soft.  An explicit unavailable/out-of-window rule is hard.
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
        and lower(btrim(coalesce(a.status::text, ''))) not in ('סגור','נמחק','בוטל','closed','deleted','cancelled','canceled','inactive','לא פעיל')
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
      previous_location := public.scheduling_school_location(
        previous_activity.school_id,
        previous_activity.school,
        previous_activity.authority_id,
        previous_activity.authority
      );
      -- Unknown route data is soft.  Only a known impossible transition blocks.
      if nullif(btrim(coalesce(previous_location, '')), '') is not null
        and nullif(btrim(coalesce(target_location, '')), '') is not null
      then
        required_minutes := public.scheduling_cached_travel_minutes(previous_location, target_location);
        if required_minutes is not null then
          gap_minutes := floor(extract(epoch from (target_start - previous_activity.effective_end_time)) / 60);
          if gap_minutes < required_minutes + 15 then
            raise exception 'scheduling_transition_insufficient';
          end if;
        end if;
      end if;
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
      next_location := public.scheduling_school_location(
        next_activity.school_id,
        next_activity.school,
        next_activity.authority_id,
        next_activity.authority
      );
      if nullif(btrim(coalesce(next_location, '')), '') is not null
        and nullif(btrim(coalesce(target_location, '')), '') is not null
      then
        required_minutes := public.scheduling_cached_travel_minutes(target_location, next_location);
        if required_minutes is not null then
          gap_minutes := floor(extract(epoch from (next_activity.effective_start_time - target_end)) / 60);
          if gap_minutes < required_minutes + 15 then
            raise exception 'scheduling_transition_insufficient';
          end if;
        end if;
      end if;
    end if;
  end loop;

  return violations;
end
$$;

revoke all on function public.scheduling_manual_assignment_hard_violations(text,bigint) from public;

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
  final_status text;
  violations text[];
  manual_reason text;
  final_reason text;
  is_verified_manual_draft boolean := false;
begin
  if caller_role is null or caller_role not in ('admin','operation_manager') then
    raise exception 'scheduling_permission_denied' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.users u
    where u.auth_user_id = auth.uid() and u.is_active is true
  ) then
    raise exception 'scheduling_permission_denied' using errcode='42501';
  end if;
  if p_decision_type not in ('approved','overridden','exception_approved') then
    raise exception 'invalid_decision_type';
  end if;

  perform public.scheduling_lock_instructor_for_write(p_emp_id);

  select * into selected_instructor
  from public.contacts_instructors
  where emp_id = p_emp_id;
  if not found then raise exception 'instructor_not_found'; end if;
  if lower(coalesce(selected_instructor.active::text, 'yes')) in ('no','false','0','לא פעיל') then
    raise exception 'instructor_inactive';
  end if;
  if btrim(coalesce(selected_instructor.full_name, '')) <> btrim(coalesce(p_instructor_name, '')) then
    raise exception 'instructor_name_mismatch';
  end if;

  select * into result
  from public.activities
  where row_id = p_activity_id
  for update;
  if not found then raise exception 'activity_not_found'; end if;

  prior_status := result.instructor_assignment_status;
  final_status := 'שובץ';

  -- A manual bypass is valid only for the exact current persisted draft and the audit row
  -- created in the same transaction by save_course_assignment_manual_draft().
  if result.draft_emp_id = p_emp_id::text
    and result.draft_created_at is not null
    and result.draft_created_by is not null
    and btrim(coalesce(result.draft_instructor_name, '')) = btrim(coalesce(selected_instructor.full_name, ''))
  then
    select ia.reason
    into manual_reason
    from public.instructor_assignment_audit ia
    where ia.activity_id = p_activity_id
      and ia.selected_emp_id = p_emp_id::text
      and ia.decision_type = 'draft'
      and ia.selected_by = result.draft_created_by
      and ia.created_at = result.draft_created_at
      and ia.reason like 'בחירה ידנית%'
    order by ia.id desc
    limit 1;

    is_verified_manual_draft := found;
  end if;

  if is_verified_manual_draft then
    violations := public.scheduling_manual_assignment_hard_violations(p_activity_id, p_emp_id);
  else
    -- Normal/recommended flow is unchanged and still applies every recommendation gate.
    violations := public.scheduling_course_instructor_violations(p_activity_id, p_emp_id, true);
  end if;

  if coalesce(array_length(violations, 1), 0) > 0 then
    raise exception '%', violations[1];
  end if;

  if is_verified_manual_draft then
    if nullif(btrim(coalesce(p_reason, '')), '') is null then
      final_reason := manual_reason;
    elsif position(manual_reason in p_reason) > 0 then
      final_reason := p_reason;
    else
      final_reason := btrim(p_reason) || ' | ' || manual_reason;
    end if;
  else
    final_reason := nullif(btrim(coalesce(p_reason, '')), '');
  end if;

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
    activity_id,
    selected_emp_id,
    selected_instructor_name,
    top_recommended_emp_id,
    selected_score,
    top_score,
    decision_type,
    reason,
    previous_status,
    new_status,
    bypassed_constraints,
    meetings_completed_at_decision
  ) values (
    p_activity_id,
    p_emp_id::text,
    selected_instructor.full_name,
    p_top_emp_id::text,
    p_selected_score,
    p_top_score,
    p_decision_type,
    final_reason,
    prior_status,
    final_status,
    case when is_verified_manual_draft then array['manual_selection_soft_warnings']::text[] else '{}'::text[] end,
    0
  );

  return result;
end
$$;

revoke all on function public.assign_activity_instructor(text,bigint,text,bigint,integer,integer,text,text) from public;
grant execute on function public.assign_activity_instructor(text,bigint,text,bigint,integer,integer,text,text) to authenticated;
