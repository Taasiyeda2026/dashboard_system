-- Final consistency follow-up for school_2027 scheduling.
-- Requires 20260807203000_course_scheduling_e2e_alignment.sql.

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

    if target.end_time is not null and exists (
      select 1
      from public.school_calendar sc
      where sc.is_active is true
        and sc.enforce_end_time is true
        and sc.school_day_end_time is not null
        and sc.start_date is not null
        and meeting_date between sc.start_date and coalesce(sc.end_date, sc.start_date)
        and target.end_time > sc.school_day_end_time
    ) then
      return 'activity_after_shortened_school_day';
    end if;
  end loop;

  return null;
end
$$;

revoke all on function public.scheduling_school_calendar_validation_reason(text) from public;

create or replace function public.scheduling_revalidate_assignments_after_school_calendar_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  activity_row record;
  calendar_reason text;
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  for activity_row in
    select a.row_id
    from public.activities a
    where a.activity_season = 'school_2027'
      and lower(btrim(coalesce(a.activity_type::text, ''))) in ('קורס', 'course', 'program')
      and lower(btrim(coalesce(a.status::text, ''))) in ('פתוח', 'open')
      and a.instructor_assignment_locked is true
      and (a.emp_id is not null or a.emp_id_2 is not null)
  loop
    perform public.scheduling_apply_course_assignment_revalidation(
      activity_row.row_id,
      'school_calendar_changed'
    );

    calendar_reason := public.scheduling_school_calendar_validation_reason(activity_row.row_id);
    if calendar_reason is not null then
      update public.activities
      set instructor_assignment_status = 'נדרש טיפול'
      where row_id = activity_row.row_id;
    end if;
  end loop;

  return null;
end
$$;

revoke all on function public.scheduling_revalidate_assignments_after_school_calendar_change() from public;

drop trigger if exists school_calendar_revalidate_locked_assignments on public.school_calendar;
create trigger school_calendar_revalidate_locked_assignments
after insert or update or delete on public.school_calendar
for each statement
execute function public.scheduling_revalidate_assignments_after_school_calendar_change();

-- Keep activities as the single assignment source while protecting direct edits.
create or replace function public.scheduling_guard_activity_calendar_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  draft_holder bigint;
  meetings jsonb;
  canonical_name text;
  official_assignment_changed boolean;
begin
  if new.activity_season is distinct from 'school_2027'
    or lower(btrim(coalesce(new.activity_type::text, ''))) not in ('קורס', 'course', 'program')
    or lower(btrim(coalesce(new.status::text, ''))) not in ('פתוח', 'open')
  then
    return new;
  end if;

  official_assignment_changed :=
    old.emp_id is distinct from new.emp_id
    or old.emp_id_2 is distinct from new.emp_id_2
    or old.instructor_name is distinct from new.instructor_name
    or old.instructor_name_2 is distinct from new.instructor_name_2;

  if new.emp_id is null then
    if nullif(btrim(coalesce(new.instructor_name, '')), '') is not null then
      raise exception 'scheduling_instructor_identity_incomplete';
    end if;
  else
    select ci.full_name into canonical_name
    from public.contacts_instructors ci
    where ci.emp_id = new.emp_id;
    if not found then raise exception 'instructor_not_found'; end if;
    if btrim(coalesce(new.instructor_name, '')) <> btrim(coalesce(canonical_name, '')) then
      raise exception 'instructor_name_mismatch';
    end if;
  end if;

  if new.emp_id_2 is null then
    if nullif(btrim(coalesce(new.instructor_name_2, '')), '') is not null then
      raise exception 'scheduling_instructor_identity_incomplete';
    end if;
  else
    select ci.full_name into canonical_name
    from public.contacts_instructors ci
    where ci.emp_id = new.emp_id_2;
    if not found then raise exception 'instructor_not_found'; end if;
    if btrim(coalesce(new.instructor_name_2, '')) <> btrim(coalesce(canonical_name, '')) then
      raise exception 'instructor_name_mismatch';
    end if;
  end if;

  if old.draft_emp_id is distinct from new.draft_emp_id
    or old.draft_instructor_name is distinct from new.draft_instructor_name
    or old.draft_proposed_meetings is distinct from new.draft_proposed_meetings
  then
    if new.draft_emp_id is null then
      if nullif(btrim(coalesce(new.draft_instructor_name, '')), '') is not null then
        raise exception 'scheduling_instructor_identity_incomplete';
      end if;
    else
      draft_holder := new.draft_emp_id::bigint;
      select ci.full_name into canonical_name
      from public.contacts_instructors ci
      where ci.emp_id = draft_holder;
      if not found then raise exception 'instructor_not_found'; end if;
      if btrim(coalesce(new.draft_instructor_name, '')) <> btrim(coalesce(canonical_name, '')) then
        raise exception 'instructor_name_mismatch';
      end if;

      perform public.scheduling_lock_instructor_for_write(draft_holder);
      meetings := case
        when new.draft_proposed_meetings is not null then new.draft_proposed_meetings
        else public.scheduling_activity_official_meetings(new)
      end;
      perform public.scheduling_assert_home_route(draft_holder, new.row_id);
      perform public.scheduling_assert_assignment_calendar(new.row_id, draft_holder, meetings);
    end if;
  end if;

  if official_assignment_changed then
    if new.emp_id is null and new.emp_id_2 is null then
      new.instructor_assignment_locked := false;
      new.instructor_assignment_status := null;
    else
      new.instructor_assignment_locked := true;
      new.instructor_assignment_status := 'שובץ';
    end if;
  end if;

  return new;
end
$$;

revoke all on function public.scheduling_guard_activity_calendar_write() from public;

drop trigger if exists activities_guard_effective_scheduling_calendar on public.activities;
create trigger activities_guard_effective_scheduling_calendar
before update of emp_id, emp_id_2, instructor_name, instructor_name_2,
  draft_emp_id, draft_instructor_name, draft_proposed_meetings
on public.activities
for each row
when (
  old.emp_id is distinct from new.emp_id
  or old.emp_id_2 is distinct from new.emp_id_2
  or old.instructor_name is distinct from new.instructor_name
  or old.instructor_name_2 is distinct from new.instructor_name_2
  or old.draft_emp_id is distinct from new.draft_emp_id
  or old.draft_instructor_name is distinct from new.draft_instructor_name
  or old.draft_proposed_meetings is distinct from new.draft_proposed_meetings
)
execute function public.scheduling_guard_activity_calendar_write();

create or replace function public.scheduling_validate_direct_activity_assignment_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  holder bigint;
  violations text[];
  meetings jsonb;
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if new.activity_season is distinct from 'school_2027'
    or lower(btrim(coalesce(new.activity_type::text, ''))) not in ('קורס', 'course', 'program')
    or lower(btrim(coalesce(new.status::text, ''))) not in ('פתוח', 'open')
  then
    return new;
  end if;

  foreach holder in array array_remove(array[new.emp_id::bigint, new.emp_id_2::bigint], null)
  loop
    perform public.scheduling_lock_instructor_for_write(holder);

    violations := public.scheduling_course_instructor_violations(new.row_id, holder, false);
    if coalesce(array_length(violations, 1), 0) > 0 then
      raise exception '%', violations[1];
    end if;

    meetings := public.scheduling_activity_official_meetings(new);
    perform public.scheduling_assert_home_route(holder, new.row_id);
    perform public.scheduling_assert_assignment_calendar(new.row_id, holder, meetings);
  end loop;

  return new;
end
$$;

revoke all on function public.scheduling_validate_direct_activity_assignment_after_write() from public;

drop trigger if exists activities_validate_direct_assignment_after_write on public.activities;
create trigger activities_validate_direct_assignment_after_write
after update of emp_id, emp_id_2, instructor_name, instructor_name_2
on public.activities
for each row
when (
  old.emp_id is distinct from new.emp_id
  or old.emp_id_2 is distinct from new.emp_id_2
  or old.instructor_name is distinct from new.instructor_name
  or old.instructor_name_2 is distinct from new.instructor_name_2
)
execute function public.scheduling_validate_direct_activity_assignment_after_write();
