-- Live assignments are rebuilt from activities and never depend on cached draft options.
-- Preserve direct activity invalidation; exclude unrelated live rows from instructor fanout.

create or replace function public.mark_scheduling_planning_needs_recalc(
  p_activity_id text,
  p_require_permission boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_activity_id text := nullif(btrim(coalesce(p_activity_id, '')), '');
  workspace_rec public.scheduling_planning_workspaces;
  marked_ids text[] := array[]::text[];
  instructor_ids text[] := array[]::text[];
  workspace_count integer := 0;
  affected_total integer := 0;
  row_affected integer := 0;
begin
  if v_activity_id is null then
    raise exception 'planning_activity_id_required';
  end if;

  if coalesce(p_require_permission, true)
    and not public.app_has_permission('view_operations_scheduling')
  then
    raise exception 'scheduling_permission_denied' using errcode = '42501';
  end if;

  if not exists(select 1 from public.activities a where a.row_id = v_activity_id) then
    raise exception 'activity_not_found';
  end if;

  for workspace_rec in
    select w.*
    from public.scheduling_planning_workspaces w
    where exists (
      select 1
      from public.scheduling_planning_rows r
      where r.workspace_id = w.id
        and r.activity_id = v_activity_id
    )
    for update
  loop
    workspace_count := workspace_count + 1;
    instructor_ids := array[]::text[];

    select coalesce(array_agg(distinct instructors.emp_id), array[]::text[])
      into instructor_ids
    from (
      select nullif(btrim(coalesce(r.row_data->>'instructorEmpId', '')), '') as emp_id
      from public.scheduling_planning_rows r
      where r.workspace_id = workspace_rec.id
        and r.activity_id = v_activity_id
      union
      select nullif(btrim(coalesce(r.locked_option->>'instructorEmpId', '')), '')
      from public.scheduling_planning_rows r
      where r.workspace_id = workspace_rec.id
        and r.activity_id = v_activity_id
      union
      select nullif(btrim(coalesce(option_row.value->>'instructorEmpId', '')), '')
      from public.scheduling_planning_rows r
      cross join lateral jsonb_array_elements(coalesce(r.row_data->'options', '[]'::jsonb)) option_row(value)
      where r.workspace_id = workspace_rec.id
        and r.activity_id = v_activity_id
      union
      select nullif(btrim(coalesce(a.emp_id::text, '')), '')
      from public.activities a
      where a.row_id = v_activity_id
      union
      select nullif(btrim(coalesce(a.emp_id_2::text, '')), '')
      from public.activities a
      where a.row_id = v_activity_id
      union
      select nullif(btrim(coalesce(a.draft_emp_id::text, '')), '')
      from public.activities a
      where a.row_id = v_activity_id
    ) instructors
    where instructors.emp_id is not null;

    update public.scheduling_planning_rows r
    set needs_recalc = true,
        updated_at = now()
    where r.workspace_id = workspace_rec.id
      and r.activity_id = v_activity_id
      and r.needs_recalc is distinct from true;
    get diagnostics row_affected = row_count;
    affected_total := affected_total + row_affected;

    if coalesce(cardinality(instructor_ids), 0) > 0 then
      update public.scheduling_planning_rows r
      set needs_recalc = true,
          updated_at = now()
      where r.workspace_id = workspace_rec.id
        and r.activity_id <> v_activity_id
        and coalesce(r.row_data->>'kind', '') <> 'live'
        and r.locked_option is null
        and r.needs_recalc is distinct from true
        and (
          coalesce(r.row_data->>'instructorEmpId', '') = any(instructor_ids)
          or exists (
            select 1
            from jsonb_array_elements(coalesce(r.row_data->'options', '[]'::jsonb)) option_row(value)
            where coalesce(option_row.value->>'instructorEmpId', '') = any(instructor_ids)
          )
        );
      get diagnostics row_affected = row_count;
      affected_total := affected_total + row_affected;
    end if;

    select coalesce(
      array_agg(distinct merged.activity_id order by merged.activity_id),
      array[v_activity_id]
    )
      into marked_ids
    from (
      select unnest(marked_ids) as activity_id
      union
      select r.activity_id
      from public.scheduling_planning_rows r
      where r.workspace_id = workspace_rec.id
        and r.needs_recalc is true
        and (
          r.activity_id = v_activity_id
          or (
            coalesce(cardinality(instructor_ids), 0) > 0
            and r.locked_option is null
            and coalesce(r.row_data->>'kind', '') <> 'live'
            and (
              coalesce(r.row_data->>'instructorEmpId', '') = any(instructor_ids)
              or exists (
                select 1
                from jsonb_array_elements(coalesce(r.row_data->'options', '[]'::jsonb)) option_row(value)
                where coalesce(option_row.value->>'instructorEmpId', '') = any(instructor_ids)
              )
            )
          )
        )
    ) merged;

    update public.scheduling_planning_workspaces w
    set updated_at = now(),
        updated_by = auth.uid(),
        revision = w.revision + 1
    where w.id = workspace_rec.id;
  end loop;

  return jsonb_build_object(
    'activityId', v_activity_id,
    'markedActivityIds', to_jsonb(coalesce(marked_ids, array[]::text[])),
    'affectedCount', coalesce(cardinality(marked_ids), 0),
    'rowsTouched', affected_total,
    'workspaceCount', workspace_count
  );
end
$$;

revoke all on function public.mark_scheduling_planning_needs_recalc(text, boolean) from public;
grant execute on function public.mark_scheduling_planning_needs_recalc(text, boolean) to authenticated;

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
  if coalesce(p_row.row_data->>'kind', '') = 'live' then
    return false;
  end if;
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
