-- Self-invalidating shared planning:
-- 1) Targeted needs_recalc when instructor availability / profile / activity inputs change
-- 2) Never mark an entire planning workspace dirty
-- 3) Production hotfix for known stale Aline / meeting-count rows
-- 4) Confirm continues to re-validate against live hard gates

-- ---------------------------------------------------------------------------
-- Helpers: instructor / meeting references inside a planning row
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
  ) dates
  where d is not null;
$$;

create or replace function public.scheduling_planning_row_references_instructor(
  p_row public.scheduling_planning_rows,
  p_emp_id text,
  p_exception_date date default null
) returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  emp text := nullif(btrim(coalesce(p_emp_id, '')), '');
  instructor_ids text[];
  meeting_dates date[];
begin
  if emp is null then
    return false;
  end if;
  instructor_ids := public.scheduling_planning_row_instructor_ids(p_row);
  if not (emp = any(instructor_ids)) then
    return false;
  end if;
  if p_exception_date is null then
    return true;
  end if;
  meeting_dates := public.scheduling_planning_row_meeting_dates(p_row);
  if coalesce(cardinality(meeting_dates), 0) = 0 then
    -- No stored meetings: still dirty the instructor-linked row so recovery can run.
    return true;
  end if;
  return p_exception_date = any(meeting_dates);
end
$$;

-- ---------------------------------------------------------------------------
-- Mark only rows that depend on a given instructor (optional date filter)
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

    update public.scheduling_planning_rows r
    set needs_recalc = true,
        updated_at = now()
    where r.workspace_id = workspace_rec.id
      and r.needs_recalc is distinct from true
      and public.scheduling_planning_row_references_instructor(r, emp, p_exception_date);
    get diagnostics row_affected = row_count;
    affected_total := affected_total + row_affected;

    select coalesce(array_agg(distinct r.activity_id order by r.activity_id), array[]::text[])
      into batch_ids
    from public.scheduling_planning_rows r
    where r.workspace_id = workspace_rec.id
      and r.needs_recalc is true
      and public.scheduling_planning_row_references_instructor(r, emp, p_exception_date);

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

create or replace function public.mark_scheduling_planning_needs_recalc_many(
  p_activity_ids text[],
  p_require_permission boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  activity_id text;
  payload jsonb;
  marked_ids text[] := array[]::text[];
  rows_touched integer := 0;
  workspace_count integer := 0;
begin
  if coalesce(p_require_permission, true)
    and not public.app_has_permission('view_operations_scheduling')
  then
    raise exception 'scheduling_permission_denied' using errcode = '42501';
  end if;

  for activity_id in
    select distinct nullif(btrim(coalesce(id, '')), '')
    from unnest(coalesce(p_activity_ids, array[]::text[])) as id
    where nullif(btrim(coalesce(id, '')), '') is not null
  loop
    payload := public.mark_scheduling_planning_needs_recalc(activity_id, false);
    select coalesce(array_agg(distinct merged.activity_id order by merged.activity_id), array[]::text[])
      into marked_ids
    from (
      select unnest(marked_ids) as activity_id
      union
      select jsonb_array_elements_text(coalesce(payload->'markedActivityIds', '[]'::jsonb))
    ) merged;
    rows_touched := rows_touched + coalesce((payload->>'rowsTouched')::integer, 0);
    workspace_count := workspace_count + coalesce((payload->>'workspaceCount')::integer, 0);
  end loop;

  return jsonb_build_object(
    'markedActivityIds', to_jsonb(coalesce(marked_ids, array[]::text[])),
    'affectedCount', coalesce(cardinality(marked_ids), 0),
    'rowsTouched', rows_touched,
    'workspaceCount', workspace_count
  );
end
$$;

-- ---------------------------------------------------------------------------
-- Triggers: availability exceptions / rules / profiles / instructor contact
-- ---------------------------------------------------------------------------

create or replace function public.scheduling_invalidate_planning_after_availability_exception()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  emp bigint;
  exception_day date;
begin
  if tg_op = 'DELETE' then
    emp := old.emp_id;
    exception_day := old.exception_date;
  else
    emp := new.emp_id;
    exception_day := new.exception_date;
    if tg_op = 'UPDATE'
      and old.emp_id is not distinct from new.emp_id
      and old.exception_date is not distinct from new.exception_date
      and old.available is not distinct from new.available
      and old.start_time is not distinct from new.start_time
      and old.end_time is not distinct from new.end_time
    then
      return new;
    end if;
  end if;

  perform public.mark_scheduling_planning_needs_recalc_for_instructor(emp, exception_day, false);
  if tg_op = 'UPDATE' and old.emp_id is distinct from new.emp_id then
    perform public.mark_scheduling_planning_needs_recalc_for_instructor(old.emp_id, old.exception_date, false);
  elsif tg_op = 'UPDATE' and old.exception_date is distinct from new.exception_date then
    perform public.mark_scheduling_planning_needs_recalc_for_instructor(old.emp_id, old.exception_date, false);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

create or replace function public.scheduling_invalidate_planning_after_availability_rule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  emp bigint;
begin
  if tg_op = 'DELETE' then
    emp := old.emp_id;
  else
    emp := new.emp_id;
    if tg_op = 'UPDATE'
      and old.emp_id is not distinct from new.emp_id
      and old.weekday is not distinct from new.weekday
      and old.available is not distinct from new.available
      and old.start_time is not distinct from new.start_time
      and old.end_time is not distinct from new.end_time
    then
      return new;
    end if;
  end if;

  perform public.mark_scheduling_planning_needs_recalc_for_instructor(emp, null, false);
  if tg_op = 'UPDATE' and old.emp_id is distinct from new.emp_id then
    perform public.mark_scheduling_planning_needs_recalc_for_instructor(old.emp_id, null, false);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

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

create or replace function public.scheduling_invalidate_planning_after_instructor_contact()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
    and old.active is not distinct from new.active
    and old.address is not distinct from new.address
  then
    return new;
  end if;

  perform public.mark_scheduling_planning_needs_recalc_for_instructor(new.emp_id, null, false);
  return new;
end
$$;

drop trigger if exists instructor_availability_exceptions_invalidate_planning
  on public.instructor_availability_exceptions;
create trigger instructor_availability_exceptions_invalidate_planning
  after insert or update or delete on public.instructor_availability_exceptions
  for each row
  execute function public.scheduling_invalidate_planning_after_availability_exception();

drop trigger if exists instructor_availability_rules_invalidate_planning
  on public.instructor_availability_rules;
create trigger instructor_availability_rules_invalidate_planning
  after insert or update or delete on public.instructor_availability_rules
  for each row
  execute function public.scheduling_invalidate_planning_after_availability_rule();

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

drop trigger if exists contacts_instructors_invalidate_planning
  on public.contacts_instructors;
create trigger contacts_instructors_invalidate_planning
  after update of active, address on public.contacts_instructors
  for each row
  execute function public.scheduling_invalidate_planning_after_instructor_contact();

-- ---------------------------------------------------------------------------
-- Confirm: refuse stale dirty drafts + keep live hard-gate validation
-- ---------------------------------------------------------------------------

create or replace function public.confirm_scheduling_planning_draft(
  p_period_key text,
  p_district text,
  p_activity_id text,
  p_expected_revision bigint default null
) returns activities
language plpgsql
security definer
set search_path = public
as $$
declare
  scope_period text := nullif(btrim(coalesce(p_period_key, '')), '');
  scope_district text := btrim(coalesce(p_district, ''));
  v_activity_id text := nullif(btrim(coalesce(p_activity_id, '')), '');
  workspace public.scheduling_planning_workspaces;
  planning_row public.scheduling_planning_rows;
  target public.activities;
  selected_instructor public.contacts_instructors;
  option jsonb;
  meetings jsonb;
  canonical jsonb := '[]'::jsonb;
  item jsonb;
  meeting_date date;
  meeting_start time without time zone;
  meeting_end time without time zone;
  first_start time without time zone;
  first_end time without time zone;
  first_date date;
  last_date date;
  previous_date date;
  expected_count integer := 0;
  official_count integer := 0;
  idx integer := 1;
  v_emp_id bigint;
  v_score integer;
  violations text[];
  result public.activities;
  caller_role text := public.app_current_role();
  skip_dates date[] := '{}'::date[];
  main_meetings jsonb := '[]'::jsonb;
  substitute_emp_id bigint;
  substitute_item jsonb;
  meeting_payload jsonb;
begin
  if caller_role is null
    or caller_role not in ('admin','operation_manager')
    or not exists (
      select 1 from public.users u
      where u.auth_user_id = auth.uid() and u.is_active is true
    )
  then
    raise exception 'scheduling_permission_denied' using errcode = '42501';
  end if;

  if scope_period is null or v_activity_id is null then
    raise exception 'planning_scope_invalid';
  end if;

  select * into workspace
  from public.scheduling_planning_workspaces
  where period_key = scope_period and district = scope_district
  for update;
  if not found then raise exception 'planning_workspace_missing'; end if;

  if p_expected_revision is not null and workspace.revision <> p_expected_revision then
    raise exception 'planning_revision_conflict';
  end if;

  select * into planning_row
  from public.scheduling_planning_rows
  where workspace_id = workspace.id and activity_id = v_activity_id
  for update;
  if not found or planning_row.locked_option is null then
    raise exception 'planning_draft_missing';
  end if;

  -- Stale stored draft must never be confirmed; live gates below are the second line.
  if planning_row.needs_recalc is true then
    raise exception 'planning_draft_stale_needs_recalc';
  end if;

  option := planning_row.locked_option;
  if coalesce(option->>'instructorEmpId', '') !~ '^[0-9]+$' then
    raise exception 'planning_draft_invalid';
  end if;
  v_emp_id := (option->>'instructorEmpId')::bigint;
  meetings := option->'meetings';

  if jsonb_typeof(meetings) <> 'array'
    or jsonb_array_length(meetings) = 0
    or jsonb_array_length(meetings) > 35
  then
    raise exception 'planning_draft_invalid';
  end if;

  perform public.scheduling_lock_instructor_for_write(v_emp_id);

  select * into selected_instructor
  from public.contacts_instructors
  where emp_id = v_emp_id;
  if not found then raise exception 'instructor_not_found'; end if;
  if lower(coalesce(selected_instructor.active::text, 'yes')) in ('no','false','0','לא פעיל') then
    raise exception 'instructor_inactive';
  end if;

  select * into target
  from public.activities
  where row_id = v_activity_id
  for update;
  if not found then raise exception 'activity_not_found'; end if;

  if target.activity_season <> 'school_2027' then
    raise exception 'scheduling_activity_not_school_2027';
  end if;
  if lower(btrim(coalesce(target.status::text, ''))) not in ('פתוח','open') then
    raise exception 'scheduling_activity_not_open';
  end if;
  if target.instructor_assignment_locked
    or target.emp_id is not null
    or nullif(btrim(coalesce(target.instructor_name, '')), '') is not null
  then
    raise exception 'scheduling_assignment_locked';
  end if;
  if nullif(btrim(coalesce(target.draft_emp_id, '')), '') is not null then
    raise exception 'scheduling_draft_exists';
  end if;

  if planning_row.activity_updated_at is not null
    and target.updated_at is distinct from planning_row.activity_updated_at
  then
    raise exception 'planning_activity_changed';
  end if;

  if coalesce(target.sessions, '') ~ '^\d+$' then
    expected_count := target.sessions::integer;
  end if;
  select count(*) into official_count
  from generate_series(1, 35) n
  where nullif(to_jsonb(target)->>('date_' || n), '') is not null;
  if expected_count <= 0 then expected_count := official_count; end if;
  if expected_count > 0 and jsonb_array_length(meetings) <> expected_count then
    raise exception 'scheduling_proposed_meeting_count_mismatch';
  end if;
  if official_count > 0 and expected_count > 0 and official_count <> expected_count then
    raise exception 'scheduling_proposed_meeting_count_mismatch';
  end if;

  for item in select value from jsonb_array_elements(meetings) loop
    if nullif(item->>'date', '') is null
      or nullif(item->>'start_time', '') is null
      or nullif(item->>'end_time', '') is null
    then
      raise exception 'planning_draft_invalid';
    end if;
    begin
      meeting_date := (item->>'date')::date;
      meeting_start := (item->>'start_time')::time;
      meeting_end := (item->>'end_time')::time;
    exception when others then
      raise exception 'planning_draft_invalid';
    end;

    if meeting_start >= meeting_end then raise exception 'planning_draft_invalid'; end if;
    if extract(dow from meeting_date) = 6
      and coalesce(public.school_calendar_sector_for_school_id(target.school_id), '') <> 'arab'
    then
      raise exception 'scheduling_saturday_blocked';
    end if;
    if previous_date is not null and meeting_date <= previous_date then
      raise exception 'planning_draft_invalid';
    end if;

    first_start := coalesce(first_start, meeting_start);
    first_end := coalesce(first_end, meeting_end);
    if meeting_start <> first_start or meeting_end <> first_end then
      raise exception 'planning_draft_variable_hours_unsupported';
    end if;

    first_date := coalesce(first_date, meeting_date);
    last_date := meeting_date;
    previous_date := meeting_date;
    canonical := canonical || jsonb_build_array(jsonb_build_object(
      'date', meeting_date,
      'meeting_no', idx,
      'start_time', meeting_start,
      'end_time', meeting_end
    ));
    if coalesce(item->>'substituteEmpId', '') ~ '^[0-9]+$' then
      skip_dates := array_append(skip_dates, meeting_date);
    else
      main_meetings := main_meetings || jsonb_build_array(jsonb_build_object(
        'date', meeting_date,
        'meeting_no', idx,
        'start_time', meeting_start,
        'end_time', meeting_end
      ));
    end if;
    idx := idx + 1;
  end loop;

  if coalesce(array_length(skip_dates, 1), 0) = 0 then
    main_meetings := canonical;
  end if;

  update public.activities
  set start_time = first_start,
      end_time = first_end,
      start_date = first_date,
      end_date = last_date,
      date_1 = nullif(canonical->0->>'date', '')::date,
      date_2 = nullif(canonical->1->>'date', '')::date,
      date_3 = nullif(canonical->2->>'date', '')::date,
      date_4 = nullif(canonical->3->>'date', '')::date,
      date_5 = nullif(canonical->4->>'date', '')::date,
      date_6 = nullif(canonical->5->>'date', '')::date,
      date_7 = nullif(canonical->6->>'date', '')::date,
      date_8 = nullif(canonical->7->>'date', '')::date,
      date_9 = nullif(canonical->8->>'date', '')::date,
      date_10 = nullif(canonical->9->>'date', '')::date,
      date_11 = nullif(canonical->10->>'date', '')::date,
      date_12 = nullif(canonical->11->>'date', '')::date,
      date_13 = nullif(canonical->12->>'date', '')::date,
      date_14 = nullif(canonical->13->>'date', '')::date,
      date_15 = nullif(canonical->14->>'date', '')::date,
      date_16 = nullif(canonical->15->>'date', '')::date,
      date_17 = nullif(canonical->16->>'date', '')::date,
      date_18 = nullif(canonical->17->>'date', '')::date,
      date_19 = nullif(canonical->18->>'date', '')::date,
      date_20 = nullif(canonical->19->>'date', '')::date,
      date_21 = nullif(canonical->20->>'date', '')::date,
      date_22 = nullif(canonical->21->>'date', '')::date,
      date_23 = nullif(canonical->22->>'date', '')::date,
      date_24 = nullif(canonical->23->>'date', '')::date,
      date_25 = nullif(canonical->24->>'date', '')::date,
      date_26 = nullif(canonical->25->>'date', '')::date,
      date_27 = nullif(canonical->26->>'date', '')::date,
      date_28 = nullif(canonical->27->>'date', '')::date,
      date_29 = nullif(canonical->28->>'date', '')::date,
      date_30 = nullif(canonical->29->>'date', '')::date,
      date_31 = nullif(canonical->30->>'date', '')::date,
      date_32 = nullif(canonical->31->>'date', '')::date,
      date_33 = nullif(canonical->32->>'date', '')::date,
      date_34 = nullif(canonical->33->>'date', '')::date,
      date_35 = nullif(canonical->34->>'date', '')::date
  where row_id = v_activity_id;

  for substitute_item in
    select value from jsonb_array_elements(meetings) item(value)
    where coalesce(value->>'substituteEmpId', '') ~ '^[0-9]+$'
  loop
    substitute_emp_id := (substitute_item->>'substituteEmpId')::bigint;
    if substitute_emp_id = v_emp_id then
      raise exception 'scheduling_substitute_already_assigned';
    end if;
    if not exists (
      select 1 from public.contacts_instructors ci
      where ci.emp_id = substitute_emp_id
        and lower(btrim(coalesce(ci.active, ''))) = 'yes'
    ) then
      raise exception 'instructor_inactive';
    end if;
    meeting_date := (substitute_item->>'date')::date;
    meeting_start := (substitute_item->>'start_time')::time;
    meeting_end := (substitute_item->>'end_time')::time;
    if exists (
      select 1
      from public.activities a
      cross join lateral jsonb_array_elements(public.scheduling_effective_meetings(a, substitute_emp_id)) effective(value)
      where a.row_id <> v_activity_id
        and a.activity_season = 'school_2027'
        and lower(btrim(coalesce(a.status::text, ''))) not in ('סגור','נמחק','בוטל','closed','deleted','cancelled','canceled','inactive','לא פעיל')
        and (a.emp_id::text = substitute_emp_id::text or a.emp_id_2::text = substitute_emp_id::text or a.draft_emp_id = substitute_emp_id::text)
        and effective.value->>'date' = meeting_date::text
        and (effective.value->>'start_time')::time < meeting_end
        and meeting_start < (effective.value->>'end_time')::time
    ) then
      raise exception 'scheduling_conflict_detected';
    end if;
    if not exists (
      select 1
      from (
        select e.available, e.start_time, e.end_time, 1 priority
        from public.instructor_availability_exceptions e
        where e.emp_id = substitute_emp_id and e.exception_date = meeting_date
        union all
        select r.available, r.start_time, r.end_time, 2 priority
        from public.instructor_availability_rules r
        where r.emp_id = substitute_emp_id and r.weekday = extract(dow from meeting_date)::integer
      ) x
      where x.available is true
        and x.start_time is not null
        and x.end_time is not null
        and meeting_start >= x.start_time
        and meeting_end <= x.end_time
      order by x.priority
      limit 1
    ) then
      raise exception 'scheduling_instructor_unavailable';
    end if;
  end loop;

  -- Live hard gates vs current availability / gender / language / overlap.
  violations := public.scheduling_course_instructor_violations(v_activity_id, v_emp_id, true, skip_dates);
  if coalesce(array_length(violations, 1), 0) > 0 then
    raise exception '%', violations[1];
  end if;
  perform public.scheduling_assert_assignment_calendar(v_activity_id, v_emp_id, main_meetings);

  v_score := case
    when coalesce(option->>'score', '') ~ '^-?\d+(?:\.\d+)?$'
      then round((option->>'score')::numeric)::integer
    else null
  end;

  result := public.assign_activity_instructor(
    v_activity_id,
    v_emp_id,
    selected_instructor.full_name,
    v_emp_id,
    v_score,
    v_score,
    'approved',
    'אישור טיוטת תכנון'
  );

  for substitute_item in
    select value from jsonb_array_elements(meetings) item(value)
    where coalesce(value->>'substituteEmpId', '') ~ '^[0-9]+$'
  loop
    perform public.set_course_meeting_substitute(
      v_activity_id,
      (substitute_item->>'date')::date,
      (substitute_item->>'substituteEmpId')::bigint
    );
  end loop;

  perform public.set_scheduling_planning_lock(
    scope_period,
    scope_district,
    v_activity_id,
    null,
    workspace.revision
  );

  return result;
end
$$;

revoke all on function public.confirm_scheduling_planning_draft(text, text, text, bigint) from public;
grant execute on function public.confirm_scheduling_planning_draft(text, text, text, bigint) to authenticated;

comment on function public.confirm_scheduling_planning_draft(text, text, text, bigint) is
'Atomically promotes a shared planning draft after live hard-gate revalidation; refuses stale needs_recalc rows.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.scheduling_planning_row_instructor_ids(public.scheduling_planning_rows) from public;
revoke all on function public.scheduling_planning_row_meeting_dates(public.scheduling_planning_rows) from public;
revoke all on function public.scheduling_planning_row_references_instructor(public.scheduling_planning_rows, text, date) from public;
revoke all on function public.mark_scheduling_planning_needs_recalc_for_instructor(bigint, date, boolean) from public;
revoke all on function public.mark_scheduling_planning_needs_recalc_many(text[], boolean) from public;
revoke all on function public.scheduling_invalidate_planning_after_availability_exception() from public;
revoke all on function public.scheduling_invalidate_planning_after_availability_rule() from public;
revoke all on function public.scheduling_invalidate_planning_after_scheduling_profile() from public;
revoke all on function public.scheduling_invalidate_planning_after_instructor_contact() from public;

grant execute on function public.mark_scheduling_planning_needs_recalc_for_instructor(bigint, date, boolean) to authenticated;
grant execute on function public.mark_scheduling_planning_needs_recalc_many(text[], boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Production hotfix: only the known stale rows (+ no full workspace dirty)
-- ---------------------------------------------------------------------------

do $$
declare
  target_ids text[] := array[
    'PAI-ae276b4c-9042-4ae0-acff-41fbb558e9b0-3',
    'PAI-ae276b4c-9042-4ae0-acff-41fbb558e9b0-4',
    'ACT-4b161a51-4e41-4dd6-9454-db8ab327599b',
    'ACT-2edeaefd-0d76-49ec-97e4-fedc2c51c035'
  ];
  touched integer := 0;
begin
  update public.scheduling_planning_rows r
  set needs_recalc = true,
      updated_at = now()
  where r.activity_id = any(target_ids)
    and r.needs_recalc is distinct from true;
  get diagnostics touched = row_count;

  if touched > 0 then
    update public.scheduling_planning_workspaces w
    set updated_at = now(),
        revision = revision + 1
    where exists (
      select 1
      from public.scheduling_planning_rows r
      where r.workspace_id = w.id
        and r.activity_id = any(target_ids)
        and r.needs_recalc is true
    );
  end if;

  raise notice 'planning_self_invalidation_hotfix_rows_touched=%', touched;
end
$$;
