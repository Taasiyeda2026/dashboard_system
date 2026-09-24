-- Promote a shared planning draft into the official activity atomically.
-- The planning workspace remains the lightweight scenario layer; only this explicit
-- confirmation writes dates/times and the final instructor to public.activities.

create or replace function public.confirm_scheduling_planning_draft(
  p_period_key text,
  p_district text,
  p_activity_id text,
  p_expected_revision bigint default null
) returns public.activities
language plpgsql
security definer
set search_path = public
as $$
declare
  scope_period text := nullif(btrim(coalesce(p_period_key, '')), '');
  scope_district text := btrim(coalesce(p_district, ''));
  activity_id text := nullif(btrim(coalesce(p_activity_id, '')), '');
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
  emp_id bigint;
  score integer;
  violations text[];
  result public.activities;
  caller_role text := public.app_current_role();
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

  if scope_period is null or activity_id is null then
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
  where workspace_id = workspace.id and activity_id = activity_id
  for update;
  if not found or planning_row.locked_option is null then
    raise exception 'planning_draft_missing';
  end if;

  option := planning_row.locked_option;
  if coalesce(option->>'instructorEmpId', '') !~ '^[0-9]+$' then
    raise exception 'planning_draft_invalid';
  end if;
  emp_id := (option->>'instructorEmpId')::bigint;
  meetings := option->'meetings';

  if jsonb_typeof(meetings) <> 'array'
    or jsonb_array_length(meetings) = 0
    or jsonb_array_length(meetings) > 35
  then
    raise exception 'planning_draft_invalid';
  end if;

  perform public.scheduling_lock_instructor_for_write(emp_id);

  select * into selected_instructor
  from public.contacts_instructors
  where emp_id = emp_id;
  if not found then raise exception 'instructor_not_found'; end if;
  if lower(coalesce(selected_instructor.active::text, 'yes')) in ('no','false','0','לא פעיל') then
    raise exception 'instructor_inactive';
  end if;

  select * into target
  from public.activities
  where row_id = activity_id
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

  if coalesce(target.sessions, '') ~ '^\\d+$' then
    expected_count := target.sessions::integer;
  end if;
  select count(*) into official_count
  from generate_series(1, 35) n
  where nullif(to_jsonb(target)->>('date_' || n), '') is not null;
  if expected_count <= 0 then expected_count := official_count; end if;
  if expected_count > 0 and jsonb_array_length(meetings) <> expected_count then
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
    if extract(dow from meeting_date) = 6 then raise exception 'scheduling_saturday_blocked'; end if;
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
    idx := idx + 1;
  end loop;

  -- Write the schedule first inside the same transaction. Any subsequent validation
  -- failure rolls the entire transaction back, so no partial official schedule survives.
  update public.activities
  set start_time = first_start,
      end_time = first_end
  where row_id = activity_id;

  idx := 1;
  for item in select value from jsonb_array_elements(canonical) loop
    execute format('update public.activities set date_%s = $1 where row_id = $2', idx)
      using (item->>'date')::date, activity_id;
    idx := idx + 1;
  end loop;
  while idx <= 35 loop
    execute format('update public.activities set date_%s = null where row_id = $1', idx)
      using activity_id;
    idx := idx + 1;
  end loop;

  update public.activities
  set start_date = first_date,
      end_date = last_date
  where row_id = activity_id;

  violations := public.scheduling_course_instructor_violations(activity_id, emp_id, true);
  if coalesce(array_length(violations, 1), 0) > 0 then
    raise exception '%', violations[1];
  end if;
  perform public.scheduling_assert_assignment_calendar(activity_id, emp_id, canonical);

  score := case
    when coalesce(option->>'score', '') ~ '^-?\\d+(?:\\.\\d+)?$'
      then round((option->>'score')::numeric)::integer
    else null
  end;

  result := public.assign_activity_instructor(
    activity_id,
    emp_id,
    selected_instructor.full_name,
    emp_id,
    score,
    score,
    'approved',
    'אישור טיוטת תכנון'
  );

  perform public.set_scheduling_planning_lock(
    scope_period,
    scope_district,
    activity_id,
    null,
    workspace.revision
  );

  return result;
end
$$;

revoke all on function public.confirm_scheduling_planning_draft(text,text,text,bigint) from public;
grant execute on function public.confirm_scheduling_planning_draft(text,text,text,bigint) to authenticated;

comment on function public.confirm_scheduling_planning_draft(text,text,text,bigint) is
'Atomically promotes the selected shared planning draft into the official activity schedule and final instructor assignment, then releases the planning lock.';
