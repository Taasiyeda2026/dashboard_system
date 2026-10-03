-- Planning v26: coherent school-first scheduling.
-- 1) Reinstall/enforce operational tour rules in production.
-- 2) Treat hidden packingOptions as real scheduling dependencies.
-- 3) Availability/profile invalidation expands to flexible school siblings.
-- 4) preferred_work_days is not a planning input.
-- 5) Force one targeted rebuild of existing flexible proposal rows.

-- ---------------------------------------------------------------------------
-- Tours / "התנסות בתעשייה" are operationally 09:00-14:00 and exclusive.
-- Pricing hours are deliberately untouched.
-- ---------------------------------------------------------------------------

create or replace function public.scheduling_activity_is_full_day_tour(
  p_activity public.activities
) returns boolean
language sql
immutable
set search_path = public
as $$
  select
    lower(btrim(coalesce(p_activity.activity_type::text, ''))) in ('tour', 'סיור', 'סיורים')
    or btrim(coalesce(p_activity.activity_no::text, '')) = '13990'
    or lower(regexp_replace(btrim(coalesce(p_activity.activity_name, '')), '\\s+', ' ', 'g'))
      like '%התנסות בתעשייה%';
$$;

revoke all on function public.scheduling_activity_is_full_day_tour(public.activities) from public;
grant execute on function public.scheduling_activity_is_full_day_tour(public.activities) to authenticated;

create or replace function public.scheduling_guard_full_day_tour_conflicts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  instructor_id bigint;
  meeting jsonb;
  meeting_date date;
  target_is_full_day_tour boolean;
begin
  if coalesce(new.activity_season, '') <> 'school_2027'
    or lower(btrim(coalesce(new.status::text, ''))) in (
      'סגור','נמחק','בוטל','closed','deleted','cancelled','canceled','inactive','לא פעיל'
    )
  then
    return new;
  end if;

  if nullif(new.emp_id::text, '') is null
    and nullif(new.emp_id_2::text, '') is null
    and nullif(new.draft_emp_id::text, '') is null
  then
    return new;
  end if;

  target_is_full_day_tour := public.scheduling_activity_is_full_day_tour(new);

  for instructor_id in
    select distinct instructor_text::bigint
    from unnest(array[
      nullif(new.emp_id::text, ''),
      nullif(new.emp_id_2::text, ''),
      nullif(new.draft_emp_id::text, '')
    ]) instructor_text
    where instructor_text is not null
      and instructor_text ~ '^[0-9]+$'
  loop
    for meeting in
      select value
      from jsonb_array_elements(public.scheduling_effective_meetings(new, instructor_id))
    loop
      meeting_date := nullif(meeting->>'date', '')::date;
      if meeting_date is null then
        continue;
      end if;

      if target_is_full_day_tour
        and (
          left(coalesce(meeting->>'start_time', ''), 5) <> '09:00'
          or left(coalesce(meeting->>'end_time', ''), 5) <> '14:00'
        )
      then
        raise exception 'scheduling_tour_operational_hours_required';
      end if;

      if exists (
        select 1
        from public.activities a
        cross join lateral jsonb_array_elements(
          public.scheduling_effective_meetings(a, instructor_id)
        ) effective(value)
        where a.row_id <> new.row_id
          and a.activity_season = 'school_2027'
          and lower(btrim(coalesce(a.status::text, ''))) not in (
            'סגור','נמחק','בוטל','closed','deleted','cancelled','canceled','inactive','לא פעיל'
          )
          and (
            a.emp_id::text = instructor_id::text
            or a.emp_id_2::text = instructor_id::text
            or a.draft_emp_id::text = instructor_id::text
          )
          and effective.value->>'date' = meeting_date::text
          and (
            target_is_full_day_tour
            or public.scheduling_activity_is_full_day_tour(a)
          )
      ) then
        raise exception 'scheduling_full_day_tour_conflict';
      end if;
    end loop;
  end loop;

  return new;
end;
$$;

revoke all on function public.scheduling_guard_full_day_tour_conflicts() from public;

drop trigger if exists activities_guard_full_day_tour_conflicts_insert on public.activities;
create trigger activities_guard_full_day_tour_conflicts_insert
before insert on public.activities
for each row
execute function public.scheduling_guard_full_day_tour_conflicts();

drop trigger if exists activities_guard_full_day_tour_conflicts_update on public.activities;
create trigger activities_guard_full_day_tour_conflicts_update
before update of
  activity_no,
  activity_name,
  activity_type,
  activity_season,
  status,
  emp_id,
  emp_id_2,
  draft_emp_id,
  draft_proposed_meetings,
  start_time,
  end_time,
  date_1, date_2, date_3, date_4, date_5, date_6, date_7, date_8, date_9, date_10,
  date_11, date_12, date_13, date_14, date_15, date_16, date_17, date_18, date_19, date_20,
  date_21, date_22, date_23, date_24, date_25, date_26, date_27, date_28, date_29, date_30,
  date_31, date_32, date_33, date_34, date_35
on public.activities
for each row
execute function public.scheduling_guard_full_day_tour_conflicts();

-- ---------------------------------------------------------------------------
-- Planning dependency tracking includes hidden school-packing alternatives.
-- ---------------------------------------------------------------------------

create or replace function public.scheduling_planning_row_instructor_ids(
  p_row public.scheduling_planning_rows
) returns text[]
language sql
stable
set search_path = public
as $$
  select coalesce(array_agg(distinct emp_id), array[]::text[])
  from (
    select nullif(btrim(coalesce(p_row.row_data->>'instructorEmpId', '')), '') as emp_id
    union all
    select nullif(btrim(coalesce(p_row.locked_option->>'instructorEmpId', '')), '')
    union all
    select nullif(btrim(coalesce(p_row.row_data->>'draftInstructorEmpId', '')), '')
    union all
    select nullif(btrim(coalesce(p_row.locked_option->>'draftInstructorEmpId', '')), '')
    union all
    select nullif(btrim(coalesce(option_row->>'instructorEmpId', '')), '')
    from jsonb_array_elements(coalesce(p_row.row_data->'options', '[]'::jsonb)) option_row
    union all
    select nullif(btrim(coalesce(option_row->>'instructorEmpId', '')), '')
    from jsonb_array_elements(coalesce(p_row.row_data->'packingOptions', '[]'::jsonb)) option_row
    union all
    select nullif(btrim(coalesce(meeting->>'substituteEmpId', '')), '')
    from jsonb_array_elements(coalesce(p_row.row_data->'meetings', '[]'::jsonb)) meeting
    union all
    select nullif(btrim(coalesce(meeting->>'substituteEmpId', '')), '')
    from jsonb_array_elements(coalesce(p_row.locked_option->'meetings', '[]'::jsonb)) meeting
    union all
    select nullif(btrim(coalesce(meeting->>'substituteEmpId', '')), '')
    from jsonb_array_elements(coalesce(p_row.row_data->'options', '[]'::jsonb)) option_row
    cross join lateral jsonb_array_elements(coalesce(option_row->'meetings', '[]'::jsonb)) meeting
    union all
    select nullif(btrim(coalesce(meeting->>'substituteEmpId', '')), '')
    from jsonb_array_elements(coalesce(p_row.row_data->'packingOptions', '[]'::jsonb)) option_row
    cross join lateral jsonb_array_elements(coalesce(option_row->'meetings', '[]'::jsonb)) meeting
    union all
    select nullif(btrim(coalesce(sub->>'substituteEmpId', '')), '')
    from jsonb_array_elements(coalesce(p_row.row_data->'singleMeetingSubstitutions', '[]'::jsonb)) sub
    union all
    select nullif(btrim(coalesce(sub->>'substituteEmpId', '')), '')
    from jsonb_array_elements(coalesce(p_row.locked_option->'singleMeetingSubstitutions', '[]'::jsonb)) sub
  ) ids
  where emp_id is not null;
$$;

create or replace function public.scheduling_planning_row_meeting_dates(
  p_row public.scheduling_planning_rows
) returns date[]
language sql
stable
set search_path = public
as $$
  select coalesce(array_agg(distinct d order by d), array[]::date[])
  from (
    select nullif(btrim(coalesce(meeting->>'date', '')), '')::date as d
    from jsonb_array_elements(coalesce(p_row.locked_option->'meetings', '[]'::jsonb)) meeting
    where coalesce(meeting->>'date', '') ~ '^\d{4}-\d{2}-\d{2}'
    union
    select nullif(btrim(coalesce(meeting->>'date', '')), '')::date
    from jsonb_array_elements(coalesce(p_row.row_data->'meetings', '[]'::jsonb)) meeting
    where coalesce(meeting->>'date', '') ~ '^\d{4}-\d{2}-\d{2}'
    union
    select nullif(btrim(coalesce(meeting->>'date', '')), '')::date
    from jsonb_array_elements(coalesce(p_row.row_data->'options', '[]'::jsonb)) option_row
    cross join lateral jsonb_array_elements(coalesce(option_row->'meetings', '[]'::jsonb)) meeting
    where coalesce(meeting->>'date', '') ~ '^\d{4}-\d{2}-\d{2}'
    union
    select nullif(btrim(coalesce(meeting->>'date', '')), '')::date
    from jsonb_array_elements(coalesce(p_row.row_data->'packingOptions', '[]'::jsonb)) option_row
    cross join lateral jsonb_array_elements(coalesce(option_row->'meetings', '[]'::jsonb)) meeting
    where coalesce(meeting->>'date', '') ~ '^\d{4}-\d{2}-\d{2}'
  ) dates
  where d is not null;
$$;

-- ---------------------------------------------------------------------------
-- An instructor constraint change invalidates that instructor's dependent rows
-- AND movable proposal siblings in the same school group.
-- ---------------------------------------------------------------------------

create or replace function public.mark_scheduling_planning_needs_recalc_for_instructor(
  p_emp_id bigint,
  p_exception_date date default null,
  p_require_permission boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  emp text := nullif(btrim(coalesce(p_emp_id::text, '')), '');
  workspace_rec public.scheduling_planning_workspaces;
  marked_ids text[] := array[]::text[];
  affected_school_ids text[] := array[]::text[];
  workspace_count integer := 0;
  affected_total integer := 0;
  row_affected integer := 0;
  batch_ids text[];
begin
  if emp is null then
    raise exception 'planning_instructor_id_required';
  end if;

  if coalesce(p_require_permission, true)
    and not public.app_has_permission('view_operations_scheduling')
  then
    raise exception 'scheduling_permission_denied' using errcode = '42501';
  end if;

  for workspace_rec in
    select w.*
    from public.scheduling_planning_workspaces w
    where exists (
      select 1
      from public.scheduling_planning_rows r
      where r.workspace_id = w.id
        and public.scheduling_planning_row_references_instructor(r, emp, p_exception_date)
    )
    for update
  loop
    workspace_count := workspace_count + 1;

    select coalesce(array_agg(distinct school_id), array[]::text[])
      into affected_school_ids
    from (
      select coalesce(
        nullif(btrim(coalesce(r.row_data->>'schoolId', '')), ''),
        nullif(btrim(coalesce(a.school_id::text, '')), '')
      ) as school_id
      from public.scheduling_planning_rows r
      left join public.activities a on a.row_id = r.activity_id
      where r.workspace_id = workspace_rec.id
        and public.scheduling_planning_row_references_instructor(r, emp, p_exception_date)
    ) schools
    where school_id is not null;

    update public.scheduling_planning_rows r
    set needs_recalc = true,
        updated_at = now()
    where r.workspace_id = workspace_rec.id
      and r.needs_recalc is distinct from true
      and (
        public.scheduling_planning_row_references_instructor(r, emp, p_exception_date)
        or (
          r.locked_option is null
          and coalesce(r.row_data->>'kind', '') = 'proposal'
          and coalesce(
            nullif(btrim(coalesce(r.row_data->>'schoolId', '')), ''),
            (
              select nullif(btrim(coalesce(a.school_id::text, '')), '')
              from public.activities a
              where a.row_id = r.activity_id
              limit 1
            )
          ) = any(affected_school_ids)
        )
      );
    get diagnostics row_affected = row_count;
    affected_total := affected_total + row_affected;

    select coalesce(array_agg(distinct r.activity_id order by r.activity_id), array[]::text[])
      into batch_ids
    from public.scheduling_planning_rows r
    where r.workspace_id = workspace_rec.id
      and r.needs_recalc is true
      and (
        public.scheduling_planning_row_references_instructor(r, emp, p_exception_date)
        or coalesce(
          nullif(btrim(coalesce(r.row_data->>'schoolId', '')), ''),
          (
            select nullif(btrim(coalesce(a.school_id::text, '')), '')
            from public.activities a
            where a.row_id = r.activity_id
            limit 1
          )
        ) = any(affected_school_ids)
      );

    select coalesce(array_agg(distinct merged.activity_id order by merged.activity_id), array[]::text[])
      into marked_ids
    from (
      select unnest(marked_ids) as activity_id
      union
      select unnest(coalesce(batch_ids, array[]::text[]))
    ) merged;

    if row_affected > 0 then
      update public.scheduling_planning_workspaces
      set updated_at = now(),
          updated_by = auth.uid(),
          revision = revision + 1
      where id = workspace_rec.id;
    end if;
  end loop;

  return jsonb_build_object(
    'empId', emp,
    'exceptionDate', p_exception_date,
    'markedActivityIds', to_jsonb(coalesce(marked_ids, array[]::text[])),
    'affectedCount', coalesce(cardinality(marked_ids), 0),
    'rowsTouched', affected_total,
    'workspaceCount', workspace_count
  );
end
$$;

-- preferred_work_days is legacy metadata, not a planning constraint.
create or replace function public.scheduling_invalidate_planning_after_scheduling_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
    and old.gender is not distinct from new.gender
    and old.instruction_languages is not distinct from new.instruction_languages
    and old.course_restriction_mode is not distinct from new.course_restriction_mode
    and old.course_ids is not distinct from new.course_ids
    and old.blocked_authorities is not distinct from new.blocked_authorities
    and old.blocked_schools is not distinct from new.blocked_schools
  then
    return new;
  end if;

  perform public.mark_scheduling_planning_needs_recalc_for_instructor(new.emp_id, null, false);
  return new;
end
$$;

drop trigger if exists instructor_scheduling_profiles_invalidate_planning
  on public.instructor_scheduling_profiles;

create trigger instructor_scheduling_profiles_invalidate_planning
  after insert or update of
    gender,
    instruction_languages,
    course_restriction_mode,
    course_ids,
    blocked_authorities,
    blocked_schools
  on public.instructor_scheduling_profiles
  for each row
  execute function public.scheduling_invalidate_planning_after_scheduling_profile();

-- One-time v26 rebuild: only current flexible proposal rows, never live/fixed/locked.
with marked as (
  update public.scheduling_planning_rows r
  set needs_recalc = true,
      updated_at = now()
  where coalesce(r.row_data->>'kind', '') = 'proposal'
    and r.locked_option is null
  returning r.workspace_id
),
workspaces as (
  select distinct workspace_id from marked
)
update public.scheduling_planning_workspaces w
set updated_at = now(),
    revision = w.revision + 1
where w.id in (select workspace_id from workspaces);

comment on function public.scheduling_guard_full_day_tour_conflicts() is
  'v26: tours/13990 are 09:00-14:00 full-day instructor commitments and cannot share an instructor date.';

comment on function public.mark_scheduling_planning_needs_recalc_for_instructor(bigint,date,boolean) is
  'v26: invalidates instructor-dependent planning rows plus movable proposal siblings in the same school group.';
