-- Revalidate locked 2027 course assignments after scheduling-sensitive edits.
-- The approved instructor remains locked; only the assignment status is updated.

alter table public.instructor_assignment_audit
  drop constraint if exists instructor_assignment_audit_decision_type_check;
alter table public.instructor_assignment_audit
  add constraint instructor_assignment_audit_decision_type_check
  check (decision_type in ('draft','approved','overridden','exception_approved','rejected','revalidated'));

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
      select btrim(coalesce(nullif(s.institution_address, ''), nullif(s.mailing_address, ''), nullif(s.city, '')))
      from public.schools s
      where p_school_id is not null and s.id = p_school_id
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
    nullif(concat_ws(', ', nullif(btrim(p_school), ''), nullif(btrim(p_authority), '')), '')
  )
$$;

create or replace function public.scheduling_assignment_sensitive_changed(
  p_old public.activities,
  p_new public.activities
) returns boolean
language plpgsql
immutable
set search_path=public
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
    or p_old.education_level is distinct from p_new.education_level
    or p_old.grade is distinct from p_new.grade
    or p_old.activity_no is distinct from p_new.activity_no
    or p_old.activity_name is distinct from p_new.activity_name
    or p_old.blocked_instructor_ids is distinct from p_new.blocked_instructor_ids
    or p_old.allowed_instructor_ids is distinct from p_new.allowed_instructor_ids
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
  session_row record;
  target_location text;
  previous_location text;
  next_location text;
  required_minutes integer;
  gap_minutes integer;
  education_level text;
  course_key text;
  v_weekday integer;
  previous_end time;
  chain_count integer;
  target_duration integer;
  target_dates date[];
  selected_emp_id bigint;
begin
  select * into target
  from public.activities
  where row_id = p_activity_id;
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

  select * into selected_instructor
  from public.contacts_instructors
  where emp_id = selected_emp_id;
  if not found then return 'instructor_not_found'; end if;
  if lower(coalesce(selected_instructor.active::text, 'yes')) in ('no','false','0','לא פעיל') then return 'instructor_inactive'; end if;
  if nullif(btrim(coalesce(selected_instructor.address, '')), '') is null then return 'scheduling_instructor_profile_incomplete'; end if;

  select * into profile
  from public.instructor_scheduling_profiles
  where emp_id = selected_emp_id;
  if not found then return 'scheduling_instructor_profile_incomplete'; end if;

  if nullif(btrim(coalesce(target.instruction_language, '')), '') is not null then
    if coalesce(cardinality(profile.instruction_languages), 0) = 0 then return 'scheduling_instructor_profile_incomplete'; end if;
    if not (target.instruction_language = any(profile.instruction_languages)) then return 'scheduling_language_mismatch'; end if;
  end if;

  if coalesce(target.required_instructor_gender, 'any') <> 'any' then
    if nullif(btrim(coalesce(profile.gender, '')), '') is null then return 'scheduling_instructor_profile_incomplete'; end if;
    if profile.gender <> target.required_instructor_gender then return 'scheduling_gender_mismatch'; end if;
  end if;

  education_level := public.scheduling_education_level(target.education_level, target.grade);
  if education_level <> '' then
    if coalesce(cardinality(profile.education_levels), 0) = 0 then return 'scheduling_instructor_profile_incomplete'; end if;
    if not (education_level = any(profile.education_levels)) then return 'scheduling_education_level_mismatch'; end if;
  end if;

  if nullif(btrim(coalesce(profile.course_restriction_mode, '')), '') is null then return 'scheduling_instructor_profile_incomplete'; end if;
  course_key := coalesce(nullif(btrim(target.activity_no), ''), nullif(btrim(target.activity_name), ''), '');
  if profile.course_restriction_mode = 'allow_only'
    and not (course_key = any(coalesce(profile.course_ids, '{}'::text[])))
  then return 'scheduling_course_not_allowed'; end if;
  if profile.course_restriction_mode = 'block_selected'
    and course_key = any(coalesce(profile.course_ids, '{}'::text[]))
  then return 'scheduling_course_blocked'; end if;

  if selected_emp_id::text = any(coalesce(target.blocked_instructor_ids, '{}'::text[])) then return 'scheduling_instructor_blocked'; end if;
  if coalesce(cardinality(target.allowed_instructor_ids), 0) > 0
    and not (selected_emp_id::text = any(target.allowed_instructor_ids))
  then return 'scheduling_instructor_not_allowed'; end if;

  if coalesce(profile.blocked_authorities, '{}'::text[])
    && array_remove(array[target.authority_id::text, target.authority]::text[], null)
  then return 'scheduling_authority_blocked'; end if;
  if coalesce(profile.blocked_schools, '{}'::text[])
    && array_remove(array[target.school_id::text, target.school]::text[], null)
  then return 'scheduling_school_blocked'; end if;

  select array_agg(d order by d) into target_dates
  from (
    select nullif(to_jsonb(target)->>('date_' || n), '')::date as d
    from generate_series(1,35) n
  ) dates
  where d is not null;
  if coalesce(cardinality(target_dates), 0) = 0 then return 'scheduling_activity_dates_missing'; end if;
  if target.start_time is null or target.end_time is null or target.start_time >= target.end_time then return 'scheduling_activity_hours_missing'; end if;

  target_location := public.scheduling_school_location(target.school_id, target.school, target.authority_id, target.authority);
  target_duration := floor(extract(epoch from (target.end_time - target.start_time)) / 60);

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
      where a.row_id <> target.row_id
        and a.activity_season = 'school_2027'
        and lower(btrim(coalesce(a.status::text, ''))) not in ('סגור','נמחק','בוטל','closed','deleted','cancelled','canceled','inactive','לא פעיל')
        and (a.emp_id::text = selected_emp_id::text or a.emp_id_2::text = selected_emp_id::text)
        and meeting.meeting_date = any(array(
          select nullif(to_jsonb(a)->>('date_' || n), '')::date
          from generate_series(1,35) n
        ))
        and a.start_time < target.end_time
        and target.start_time < a.end_time
    ) then return 'scheduling_conflict_detected'; end if;

    previous_activity := null;
    select a.* into previous_activity
    from public.activities a
    where a.row_id <> target.row_id
      and a.activity_season = 'school_2027'
      and lower(btrim(coalesce(a.status::text, ''))) not in ('סגור','נמחק','בוטל','closed','deleted','cancelled','canceled','inactive','לא פעיל')
      and (a.emp_id::text = selected_emp_id::text or a.emp_id_2::text = selected_emp_id::text)
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
      if nullif(btrim(coalesce(previous_location, '')), '') is null
        or nullif(btrim(coalesce(target_location, '')), '') is null
      then return 'scheduling_transition_unverified'; end if;
      required_minutes := public.scheduling_cached_travel_minutes(previous_location, target_location);
      if required_minutes is null then return 'scheduling_transition_unverified'; end if;
      gap_minutes := floor(extract(epoch from (target.start_time - previous_activity.end_time)) / 60);
      if gap_minutes < required_minutes then return 'scheduling_transition_insufficient'; end if;
    end if;

    next_activity := null;
    select a.* into next_activity
    from public.activities a
    where a.row_id <> target.row_id
      and a.activity_season = 'school_2027'
      and lower(btrim(coalesce(a.status::text, ''))) not in ('סגור','נמחק','בוטל','closed','deleted','cancelled','canceled','inactive','לא פעיל')
      and (a.emp_id::text = selected_emp_id::text or a.emp_id_2::text = selected_emp_id::text)
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
      if nullif(btrim(coalesce(next_location, '')), '') is null
        or nullif(btrim(coalesce(target_location, '')), '') is null
      then return 'scheduling_transition_unverified'; end if;
      required_minutes := public.scheduling_cached_travel_minutes(target_location, next_location);
      if required_minutes is null then return 'scheduling_transition_unverified'; end if;
      gap_minutes := floor(extract(epoch from (next_activity.start_time - target.end_time)) / 60);
      if gap_minutes < required_minutes then return 'scheduling_transition_insufficient'; end if;
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
          and (a.emp_id::text = selected_emp_id::text or a.emp_id_2::text = selected_emp_id::text)
          and meeting.meeting_date = any(array(
            select nullif(to_jsonb(a)->>('date_' || n), '')::date from generate_series(1,35) n
          ))
      ) sessions
      where sessions.start_time is not null and sessions.end_time is not null
      order by sessions.start_time
    loop
      if previous_end is null
        or floor(extract(epoch from (session_row.start_time - previous_end)) / 60) > 30
      then chain_count := 1;
      else chain_count := chain_count + 1;
      end if;
      previous_end := greatest(coalesce(previous_end, session_row.end_time), session_row.end_time);
      if (target_duration >= 80 and chain_count > 3)
        or (target_duration < 80 and chain_count > 5)
      then return 'scheduling_daily_sequence_exceeded'; end if;
    end loop;
  end loop;

  return null;
exception
  when others then
    return 'scheduling_revalidation_error:' || sqlstate || ':' || sqlerrm;
end
$$;

create or replace function public.scheduling_apply_course_assignment_revalidation(
  p_activity_id text,
  p_change_reason text default 'activity_requirements_changed'
) returns text
language plpgsql
security definer
set search_path=public
as $$
declare
  target public.activities;
  validation_reason text;
  prior_status text;
  next_status text;
  audit_reason text;
begin
  select * into target
  from public.activities
  where row_id = p_activity_id
  for update;
  if not found then return null; end if;

  if coalesce(target.activity_season, '') <> 'school_2027'
    or lower(btrim(coalesce(target.activity_type::text, ''))) not in ('קורס','course','program')
    or lower(btrim(coalesce(target.status::text, ''))) not in ('פתוח','open')
    or target.instructor_assignment_locked is not true
    or (
      target.emp_id is null
      and nullif(btrim(coalesce(target.emp_id_2::text, '')), '') is null
      and nullif(btrim(coalesce(target.instructor_name, '')), '') is null
      and nullif(btrim(coalesce(target.instructor_name_2, '')), '') is null
    )
  then
    return target.instructor_assignment_status;
  end if;

  validation_reason := public.scheduling_locked_course_validation_reason(p_activity_id);
  prior_status := target.instructor_assignment_status;
  next_status := case when validation_reason is null then 'שובץ' else 'נדרש טיפול' end;
  audit_reason := concat_ws(' · ', nullif(btrim(coalesce(p_change_reason, '')), ''), validation_reason);

  if prior_status is distinct from next_status then
    update public.activities
    set instructor_assignment_status = next_status
    where row_id = p_activity_id;
  end if;

  if auth.uid() is not null then
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
      selected_by
    ) values (
      p_activity_id,
      coalesce(target.emp_id::text, target.emp_id_2::text, ''),
      coalesce(nullif(btrim(target.instructor_name), ''), nullif(btrim(target.instructor_name_2), ''), 'לא ידוע'),
      null,
      null,
      null,
      'revalidated',
      nullif(audit_reason, ''),
      prior_status,
      next_status,
      auth.uid()
    );
  end if;

  return next_status;
end
$$;

create or replace function public.scheduling_revalidate_assignment_after_activity_change()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;
  if not public.scheduling_assignment_sensitive_changed(old, new) then return new; end if;
  perform public.scheduling_apply_course_assignment_revalidation(new.row_id, 'activity_requirements_changed');
  return new;
end
$$;

drop trigger if exists activities_revalidate_locked_assignment on public.activities;
create trigger activities_revalidate_locked_assignment
after update on public.activities
for each row
execute function public.scheduling_revalidate_assignment_after_activity_change();

create or replace function public.scheduling_revalidate_assignments_after_school_address_change()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  activity_row record;
  target_school_id bigint;
  target_school text;
  target_authority text;
begin
  if pg_trigger_depth() > 1 then return new; end if;

  if tg_table_name = 'schools' then
    if (to_jsonb(old)->>'institution_address') is not distinct from (to_jsonb(new)->>'institution_address')
      and (to_jsonb(old)->>'mailing_address') is not distinct from (to_jsonb(new)->>'mailing_address')
      and (to_jsonb(old)->>'city') is not distinct from (to_jsonb(new)->>'city')
      and (to_jsonb(old)->>'house_number') is not distinct from (to_jsonb(new)->>'house_number')
    then return new; end if;
    target_school_id := nullif(to_jsonb(new)->>'id', '')::bigint;
    target_school := to_jsonb(new)->>'school_name';
    target_authority := to_jsonb(new)->>'authority';
  else
    if tg_op = 'UPDATE' and (to_jsonb(old)->>'address') is not distinct from (to_jsonb(new)->>'address') then return new; end if;
    target_school_id := nullif(to_jsonb(new)->>'school_id', '')::bigint;
    target_school := to_jsonb(new)->>'school';
    target_authority := to_jsonb(new)->>'authority';
  end if;

  for activity_row in
    select a.row_id
    from public.activities a
    where a.activity_season = 'school_2027'
      and lower(btrim(coalesce(a.activity_type::text, ''))) in ('קורס','course','program')
      and lower(btrim(coalesce(a.status::text, ''))) in ('פתוח','open')
      and a.instructor_assignment_locked is true
      and (
        (target_school_id is not null and a.school_id = target_school_id)
        or (
          lower(btrim(coalesce(a.school, ''))) = lower(btrim(coalesce(target_school, '')))
          and lower(btrim(coalesce(a.authority, ''))) = lower(btrim(coalesce(target_authority, '')))
        )
      )
  loop
    perform public.scheduling_apply_course_assignment_revalidation(activity_row.row_id, 'school_address_changed');
  end loop;

  return new;
end
$$;

drop trigger if exists contacts_schools_revalidate_assignments on public.contacts_schools;
create trigger contacts_schools_revalidate_assignments
after update of address on public.contacts_schools
for each row
execute function public.scheduling_revalidate_assignments_after_school_address_change();

drop trigger if exists contacts_schools_insert_revalidate_assignments on public.contacts_schools;
create trigger contacts_schools_insert_revalidate_assignments
after insert on public.contacts_schools
for each row
execute function public.scheduling_revalidate_assignments_after_school_address_change();

drop trigger if exists schools_revalidate_assignments on public.schools;
create trigger schools_revalidate_assignments
after update of institution_address, mailing_address, city, house_number on public.schools
for each row
execute function public.scheduling_revalidate_assignments_after_school_address_change();

create or replace function public.revalidate_course_instructor_assignment(
  p_activity_id text
) returns text
language plpgsql
security definer
set search_path=public
as $$
declare
  caller_role text := public.app_current_role();
begin
  if caller_role is null or caller_role not in ('admin','operation_manager') then
    raise exception 'scheduling_permission_denied' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.users
    where auth_user_id = auth.uid() and is_active is true
  ) then
    raise exception 'scheduling_permission_denied' using errcode='42501';
  end if;
  return public.scheduling_apply_course_assignment_revalidation(p_activity_id, 'manual_revalidation');
end
$$;

revoke all on function public.scheduling_assignment_sensitive_changed(public.activities, public.activities) from public;
revoke all on function public.scheduling_locked_course_validation_reason(text) from public;
revoke all on function public.scheduling_apply_course_assignment_revalidation(text, text) from public;
revoke all on function public.scheduling_revalidate_assignment_after_activity_change() from public;
revoke all on function public.scheduling_revalidate_assignments_after_school_address_change() from public;
revoke all on function public.revalidate_course_instructor_assignment(text) from public;
grant execute on function public.revalidate_course_instructor_assignment(text) to authenticated;

comment on function public.revalidate_course_instructor_assignment(text) is
  'Revalidates a locked 2027 course assignment without replacing the instructor; returns שובץ or נדרש טיפול.';