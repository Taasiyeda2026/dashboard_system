-- Final execution hardening for the approved 2027 course-scheduling workflow.
-- Revalidates all mandatory constraints at assignment time and records rejected suggestions.

alter table public.activities
  add column if not exists instructor_assignment_locked boolean not null default false,
  add column if not exists instructor_assignment_status text;

alter table public.activities drop constraint if exists activities_instructor_assignment_status_check;
alter table public.activities add constraint activities_instructor_assignment_status_check
  check (instructor_assignment_status is null or instructor_assignment_status in ('שובץ','נדרש טיפול'));

alter table public.instructor_assignment_audit
  add column if not exists previous_status text,
  add column if not exists new_status text;

alter table public.instructor_assignment_audit
  drop constraint if exists instructor_assignment_audit_decision_type_check;
alter table public.instructor_assignment_audit
  add constraint instructor_assignment_audit_decision_type_check
  check (decision_type in ('draft','approved','overridden','exception_approved','rejected'));

drop policy if exists instructor_assignment_audit_read on public.instructor_assignment_audit;
drop policy if exists instructor_assignment_audit_authorized_read on public.instructor_assignment_audit;
create policy instructor_assignment_audit_authorized_read
  on public.instructor_assignment_audit for select to authenticated
  using (public.app_current_role() = any (array['admin'::text, 'operation_manager'::text]));

drop policy if exists scheduling_travel_cache_read on public.scheduling_travel_cache;
drop policy if exists scheduling_travel_cache_authorized_read on public.scheduling_travel_cache;
create policy scheduling_travel_cache_authorized_read
  on public.scheduling_travel_cache for select to authenticated
  using (public.app_current_role() = any (array['admin'::text, 'operation_manager'::text]));

create or replace function public.scheduling_normalize_location(p_value text)
returns text
language sql
immutable
set search_path=public
as $$
  select lower(regexp_replace(btrim(coalesce(p_value, '')), E'\\s+', ' ', 'g'))
$$;

create or replace function public.scheduling_school_location(
  p_school_id bigint,
  p_school text,
  p_authority_id bigint,
  p_authority text
) returns text
language sql
stable
security definer
set search_path=public
as $$
  select coalesce(
    nullif((
      select btrim(cs.address)
      from public.contacts_schools cs
      where nullif(btrim(cs.address), '') is not null
        and p_school_id is not null
        and cs.school_id = p_school_id
      order by cs.id desc
      limit 1
    ), ''),
    nullif((
      select btrim(cs.address)
      from public.contacts_schools cs
      where nullif(btrim(cs.address), '') is not null
        and lower(btrim(coalesce(cs.school, ''))) = lower(btrim(coalesce(p_school, '')))
        and (
          (p_authority_id is not null and cs.authority_id = p_authority_id)
          or lower(btrim(coalesce(cs.authority, ''))) = lower(btrim(coalesce(p_authority, '')))
        )
      order by cs.id desc
      limit 1
    ), ''),
    nullif(btrim(p_school), '')
  )
$$;

create or replace function public.scheduling_cached_travel_minutes(p_origin text, p_destination text)
returns integer
language sql
stable
security definer
set search_path=public
as $$
  select stc.duration_minutes
  from public.scheduling_travel_cache stc
  where stc.origin_key = public.scheduling_normalize_location(p_origin)
    and stc.destination_key = public.scheduling_normalize_location(p_destination)
    and stc.expires_at > now()
  order by stc.calculated_at desc
  limit 1
$$;

create or replace function public.scheduling_education_level(p_education_level text, p_grade text)
returns text
language plpgsql
immutable
set search_path=public
as $$
declare
  value text := lower(btrim(coalesce(p_education_level, '')));
  grade_value text := lower(btrim(coalesce(p_grade, '')));
begin
  if value <> '' then return value; end if;
  if grade_value ~ '^(א|ב|ג|ד|ה|ו|1|2|3|4|5|6)$' then return 'elementary'; end if;
  if grade_value ~ '^(ז|ח|ט|7|8|9)$' then return 'middle_school'; end if;
  if grade_value ~ '^(י|יא|יב|10|11|12)$' then return 'high_school'; end if;
  return '';
end
$$;

create or replace function public.validate_course_instructor_assignment(
  p_activity_id text,
  p_emp_id bigint
) returns void
language plpgsql
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
  session_row record;
  target_location text;
  previous_location text;
  next_location text;
  required_minutes integer;
  gap_minutes integer;
  education_level text;
  course_key text;
  weekday integer;
  previous_end time;
  chain_count integer;
  target_duration integer;
  target_dates date[];
begin
  select * into target
  from public.activities
  where row_id = p_activity_id
  for update;
  if not found then raise exception 'activity_not_found'; end if;

  if coalesce(target.activity_season, '') <> 'school_2027' then raise exception 'scheduling_activity_not_school_2027'; end if;
  if lower(btrim(coalesce(target.activity_type::text, ''))) not in ('קורס','course','program') then raise exception 'scheduling_activity_not_course'; end if;
  if lower(btrim(coalesce(target.status::text, ''))) not in ('פתוח','open') then raise exception 'scheduling_activity_not_open'; end if;
  if target.instructor_assignment_locked
    or nullif(target.emp_id::text, '') is not null
    or nullif(target.emp_id_2::text, '') is not null
    or nullif(btrim(coalesce(target.instructor_name, '')), '') is not null
    or nullif(btrim(coalesce(target.instructor_name_2, '')), '') is not null
  then raise exception 'scheduling_assignment_locked'; end if;

  select * into selected_instructor
  from public.contacts_instructors
  where emp_id = p_emp_id;
  if not found then raise exception 'instructor_not_found'; end if;
  if lower(coalesce(selected_instructor.active::text, 'yes')) in ('no','false','0','לא פעיל') then raise exception 'instructor_inactive'; end if;
  if nullif(btrim(coalesce(selected_instructor.address, '')), '') is null then raise exception 'scheduling_instructor_profile_incomplete'; end if;

  select * into profile
  from public.instructor_scheduling_profiles
  where emp_id = p_emp_id;
  if not found then raise exception 'scheduling_instructor_profile_incomplete'; end if;

  if nullif(btrim(coalesce(target.instruction_language, '')), '') is not null then
    if coalesce(cardinality(profile.instruction_languages), 0) = 0 then raise exception 'scheduling_instructor_profile_incomplete'; end if;
    if not (target.instruction_language = any(profile.instruction_languages)) then raise exception 'scheduling_language_mismatch'; end if;
  end if;

  if coalesce(target.required_instructor_gender, 'any') <> 'any' then
    if nullif(btrim(coalesce(profile.gender, '')), '') is null then raise exception 'scheduling_instructor_profile_incomplete'; end if;
    if profile.gender <> target.required_instructor_gender then raise exception 'scheduling_gender_mismatch'; end if;
  end if;

  education_level := public.scheduling_education_level(target.education_level, target.grade);
  if education_level <> '' then
    if coalesce(cardinality(profile.education_levels), 0) = 0 then raise exception 'scheduling_instructor_profile_incomplete'; end if;
    if not (education_level = any(profile.education_levels)) then raise exception 'scheduling_education_level_mismatch'; end if;
  end if;

  if nullif(btrim(coalesce(profile.course_restriction_mode, '')), '') is null then raise exception 'scheduling_instructor_profile_incomplete'; end if;
  course_key := coalesce(nullif(btrim(target.activity_no), ''), nullif(btrim(target.activity_name), ''), '');
  if profile.course_restriction_mode = 'allow_only' and not (course_key = any(coalesce(profile.course_ids, '{}'::text[]))) then raise exception 'scheduling_course_not_allowed'; end if;
  if profile.course_restriction_mode = 'block_selected' and course_key = any(coalesce(profile.course_ids, '{}'::text[])) then raise exception 'scheduling_course_blocked'; end if;

  if p_emp_id::text = any(coalesce(target.blocked_instructor_ids, '{}'::text[])) then raise exception 'scheduling_instructor_blocked'; end if;
  if coalesce(cardinality(target.allowed_instructor_ids), 0) > 0 and not (p_emp_id::text = any(target.allowed_instructor_ids)) then raise exception 'scheduling_instructor_not_allowed'; end if;

  if coalesce(profile.blocked_authorities, '{}'::text[]) && array_remove(array[target.authority_id::text, target.authority]::text[], null) then raise exception 'scheduling_authority_blocked'; end if;
  if coalesce(profile.blocked_schools, '{}'::text[]) && array_remove(array[target.school_id::text, target.school]::text[], null) then raise exception 'scheduling_school_blocked'; end if;

  select array_agg(d order by d) into target_dates
  from (
    select nullif(to_jsonb(target)->>('date_' || n), '')::date as d
    from generate_series(1, 35) n
  ) dates
  where d is not null;
  if coalesce(cardinality(target_dates), 0) = 0 then raise exception 'scheduling_activity_dates_missing'; end if;
  if target.start_time is null or target.end_time is null or target.start_time >= target.end_time then raise exception 'scheduling_activity_hours_missing'; end if;

  target_location := public.scheduling_school_location(target.school_id, target.school, target.authority_id, target.authority);
  target_duration := floor(extract(epoch from (target.end_time - target.start_time)) / 60);

  for meeting in select unnest(target_dates) as meeting_date loop
    weekday := extract(dow from meeting.meeting_date)::integer;
    if weekday = 6 then raise exception 'scheduling_saturday_blocked'; end if;
    if weekday = 5 and coalesce(profile.friday_allowed, false) is not true then raise exception 'scheduling_friday_not_allowed'; end if;

    select x.available, x.start_time, x.end_time into availability
    from (
      select e.available, e.start_time, e.end_time, 1 as priority
      from public.instructor_availability_exceptions e
      where e.emp_id = p_emp_id and e.exception_date = meeting.meeting_date
      union all
      select r.available, r.start_time, r.end_time, 2 as priority
      from public.instructor_availability_rules r
      where r.emp_id = p_emp_id and r.weekday = weekday
    ) x
    order by x.priority
    limit 1;
    if not found then raise exception 'scheduling_availability_missing'; end if;
    if availability.available is not true
      or availability.start_time is null
      or availability.end_time is null
      or target.start_time < availability.start_time
      or target.end_time > availability.end_time
    then raise exception 'scheduling_instructor_unavailable'; end if;

    if exists (
      select 1
      from public.activities a
      where a.row_id <> target.row_id
        and a.activity_season = 'school_2027'
        and lower(btrim(coalesce(a.status::text, ''))) not in ('סגור','נמחק','בוטל','closed','deleted','cancelled','canceled','inactive','לא פעיל')
        and (a.emp_id::text = p_emp_id::text or a.emp_id_2::text = p_emp_id::text)
        and meeting.meeting_date = any(array(
          select nullif(to_jsonb(a)->>('date_' || n), '')::date from generate_series(1,35) n
        ))
        and a.start_time < target.end_time
        and target.start_time < a.end_time
    ) then raise exception 'scheduling_conflict_detected'; end if;

    previous_activity := null;
    select a.* into previous_activity
    from public.activities a
    where a.row_id <> target.row_id
      and a.activity_season = 'school_2027'
      and lower(btrim(coalesce(a.status::text, ''))) not in ('סגור','נמחק','בוטל','closed','deleted','cancelled','canceled','inactive','לא פעיל')
      and (a.emp_id::text = p_emp_id::text or a.emp_id_2::text = p_emp_id::text)
      and meeting.meeting_date = any(array(
        select nullif(to_jsonb(a)->>('date_' || n), '')::date from generate_series(1,35) n
      ))
      and a.end_time <= target.start_time
    order by a.end_time desc
    limit 1;

    if found and not (
      (previous_activity.school_id is not null and target.school_id is not null and previous_activity.school_id = target.school_id)
      or lower(btrim(coalesce(previous_activity.school, ''))) = lower(btrim(coalesce(target.school, '')))
    ) then
      previous_location := public.scheduling_school_location(previous_activity.school_id, previous_activity.school, previous_activity.authority_id, previous_activity.authority);
      if nullif(btrim(coalesce(previous_location, '')), '') is null or nullif(btrim(coalesce(target_location, '')), '') is null then raise exception 'scheduling_transition_unverified'; end if;
      required_minutes := public.scheduling_cached_travel_minutes(previous_location, target_location);
      if required_minutes is null then raise exception 'scheduling_transition_unverified'; end if;
      gap_minutes := floor(extract(epoch from (target.start_time - previous_activity.end_time)) / 60);
      if gap_minutes < required_minutes then raise exception 'scheduling_transition_insufficient'; end if;
    end if;

    next_activity := null;
    select a.* into next_activity
    from public.activities a
    where a.row_id <> target.row_id
      and a.activity_season = 'school_2027'
      and lower(btrim(coalesce(a.status::text, ''))) not in ('סגור','נמחק','בוטל','closed','deleted','cancelled','canceled','inactive','לא פעיל')
      and (a.emp_id::text = p_emp_id::text or a.emp_id_2::text = p_emp_id::text)
      and meeting.meeting_date = any(array(
        select nullif(to_jsonb(a)->>('date_' || n), '')::date from generate_series(1,35) n
      ))
      and a.start_time >= target.end_time
    order by a.start_time
    limit 1;

    if found and not (
      (next_activity.school_id is not null and target.school_id is not null and next_activity.school_id = target.school_id)
      or lower(btrim(coalesce(next_activity.school, ''))) = lower(btrim(coalesce(target.school, '')))
    ) then
      next_location := public.scheduling_school_location(next_activity.school_id, next_activity.school, next_activity.authority_id, next_activity.authority);
      if nullif(btrim(coalesce(next_location, '')), '') is null or nullif(btrim(coalesce(target_location, '')), '') is null then raise exception 'scheduling_transition_unverified'; end if;
      required_minutes := public.scheduling_cached_travel_minutes(target_location, next_location);
      if required_minutes is null then raise exception 'scheduling_transition_unverified'; end if;
      gap_minutes := floor(extract(epoch from (next_activity.start_time - target.end_time)) / 60);
      if gap_minutes < required_minutes then raise exception 'scheduling_transition_insufficient'; end if;
    end if;

    previous_end := null;
    chain_count := 0;
    for session_row in
      select sessions.start_time, sessions.end_time
      from (
        select target.start_time, target.end_time
        union all
        select a.start_time, a.end_time
        from public.activities a
        where a.row_id <> target.row_id
          and a.activity_season = 'school_2027'
          and lower(btrim(coalesce(a.status::text, ''))) not in ('סגור','נמחק','בוטל','closed','deleted','cancelled','canceled','inactive','לא פעיל')
          and (a.emp_id::text = p_emp_id::text or a.emp_id_2::text = p_emp_id::text)
          and meeting.meeting_date = any(array(
            select nullif(to_jsonb(a)->>('date_' || n), '')::date from generate_series(1,35) n
          ))
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
        raise exception 'scheduling_daily_sequence_exceeded';
      end if;
    end loop;
  end loop;
end
$$;

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
set search_path=public
as $$
declare
  result public.activities;
  selected_instructor public.contacts_instructors;
  caller_role text := public.app_current_role();
  prior_status text;
begin
  if caller_role is null or caller_role not in ('admin','operation_manager') then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
  if not exists (select 1 from public.users u where u.auth_user_id = auth.uid() and u.is_active is true) then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
  if p_decision_type not in ('approved','overridden','exception_approved') then raise exception 'invalid_decision_type'; end if;
  if (p_decision_type in ('overridden','exception_approved') or p_emp_id is distinct from p_top_emp_id)
    and nullif(btrim(p_reason), '') is null
  then raise exception 'scheduling_reason_required'; end if;

  perform public.validate_course_instructor_assignment(p_activity_id, p_emp_id);

  select * into selected_instructor from public.contacts_instructors where emp_id = p_emp_id;
  if btrim(coalesce(selected_instructor.full_name, '')) <> btrim(coalesce(p_instructor_name, '')) then raise exception 'instructor_name_mismatch'; end if;

  select * into result from public.activities where row_id = p_activity_id for update;
  prior_status := result.instructor_assignment_status;
  update public.activities
  set emp_id = p_emp_id,
      instructor_name = selected_instructor.full_name,
      instructor_assignment_locked = true,
      instructor_assignment_status = 'שובץ'
  where row_id = p_activity_id
  returning * into result;

  insert into public.instructor_assignment_audit(
    activity_id, selected_emp_id, selected_instructor_name, top_recommended_emp_id,
    selected_score, top_score, decision_type, reason, previous_status, new_status
  ) values (
    p_activity_id, p_emp_id::text, selected_instructor.full_name, p_top_emp_id::text,
    p_selected_score, p_top_score, p_decision_type, nullif(btrim(p_reason), ''), prior_status, 'שובץ'
  );
  return result;
end
$$;

create or replace function public.reject_activity_instructor_suggestion(
  p_activity_id text,
  p_top_emp_id bigint,
  p_top_score integer,
  p_reason text
) returns public.activities
language plpgsql
security definer
set search_path=public
as $$
declare
  result public.activities;
  recommended_instructor public.contacts_instructors;
  caller_role text := public.app_current_role();
  prior_status text;
begin
  if caller_role is null or caller_role not in ('admin','operation_manager') then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
  if not exists (select 1 from public.users u where u.auth_user_id = auth.uid() and u.is_active is true) then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'scheduling_reason_required'; end if;

  select * into recommended_instructor from public.contacts_instructors where emp_id = p_top_emp_id;
  if not found then raise exception 'instructor_not_found'; end if;

  select * into result from public.activities where row_id = p_activity_id for update;
  if not found then raise exception 'activity_not_found'; end if;
  if result.activity_season <> 'school_2027' then raise exception 'scheduling_activity_not_school_2027'; end if;
  if lower(btrim(coalesce(result.activity_type::text, ''))) not in ('קורס','course','program') then raise exception 'scheduling_activity_not_course'; end if;
  if lower(btrim(coalesce(result.status::text, ''))) not in ('פתוח','open') then raise exception 'scheduling_activity_not_open'; end if;
  if result.instructor_assignment_locked
    or nullif(result.emp_id::text, '') is not null
    or nullif(result.emp_id_2::text, '') is not null
    or nullif(btrim(coalesce(result.instructor_name, '')), '') is not null
    or nullif(btrim(coalesce(result.instructor_name_2, '')), '') is not null
  then raise exception 'scheduling_assignment_locked'; end if;

  prior_status := result.instructor_assignment_status;
  update public.activities
  set instructor_assignment_status = 'נדרש טיפול'
  where row_id = p_activity_id
  returning * into result;

  insert into public.instructor_assignment_audit(
    activity_id, selected_emp_id, selected_instructor_name, top_recommended_emp_id,
    selected_score, top_score, decision_type, reason, previous_status, new_status
  ) values (
    p_activity_id, p_top_emp_id::text, recommended_instructor.full_name, p_top_emp_id::text,
    p_top_score, p_top_score, 'rejected', btrim(p_reason), prior_status, 'נדרש טיפול'
  );
  return result;
end
$$;

revoke all on function public.scheduling_school_location(bigint,text,bigint,text) from public;
revoke all on function public.scheduling_cached_travel_minutes(text,text) from public;
revoke all on function public.validate_course_instructor_assignment(text,bigint) from public;
revoke all on function public.assign_activity_instructor(text,bigint,text,bigint,integer,integer,text,text) from public;
revoke all on function public.reject_activity_instructor_suggestion(text,bigint,integer,text) from public;

grant execute on function public.assign_activity_instructor(text,bigint,text,bigint,integer,integer,text,text) to authenticated;
grant execute on function public.reject_activity_instructor_suggestion(text,bigint,integer,text) to authenticated;
