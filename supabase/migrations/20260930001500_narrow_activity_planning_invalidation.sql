create or replace function public.mark_scheduling_planning_needs_recalc(
  p_activity_id text,
  p_require_permission boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_activity_id text := nullif(btrim(coalesce(p_activity_id, '')), '');
  workspace_rec public.scheduling_planning_workspaces;
  marked_ids text[] := array[]::text[];
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

    update public.scheduling_planning_rows r
    set needs_recalc = true,
        updated_at = now()
    where r.workspace_id = workspace_rec.id
      and r.activity_id = v_activity_id
      and r.needs_recalc is distinct from true;
    get diagnostics row_affected = row_count;
    affected_total := affected_total + row_affected;

    if not (v_activity_id = any(marked_ids)) then
      marked_ids := array_append(marked_ids, v_activity_id);
    end if;

    update public.scheduling_planning_workspaces w
    set updated_at = now(),
        updated_by = auth.uid(),
        revision = w.revision + 1
    where w.id = workspace_rec.id;
  end loop;

  return jsonb_build_object(
    'activityId', v_activity_id,
    'markedActivityIds', to_jsonb(marked_ids),
    'affectedCount', cardinality(marked_ids),
    'rowsTouched', affected_total,
    'workspaceCount', workspace_count
  );
end
$function$;


-- Lock/selection changes are point mutations. Ripple only to unlocked non-live
-- drafts that use the old/new instructor AND overlap one of the changed dates.
create or replace function public.set_scheduling_planning_lock(
  p_period_key text,
  p_district text,
  p_activity_id text,
  p_option jsonb,
  p_expected_revision bigint default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  scope_period text := nullif(btrim(coalesce(p_period_key, '')), '');
  scope_district text := btrim(coalesce(p_district, ''));
  activity_id text := nullif(btrim(coalesce(p_activity_id, '')), '');
  workspace public.scheduling_planning_workspaces;
  old_option jsonb;
  affected integer := 0;
  old_emp text;
  new_emp text;
begin
  if not public.app_has_permission('view_operations_scheduling') then
    raise exception 'scheduling_permission_denied' using errcode='42501';
  end if;
  if scope_period is null or activity_id is null then raise exception 'planning_scope_invalid'; end if;
  if not exists(select 1 from public.activities a where a.row_id = activity_id) then
    raise exception 'activity_not_found';
  end if;

  insert into public.scheduling_planning_workspaces(period_key, district, updated_by)
  values (scope_period, scope_district, auth.uid())
  on conflict (period_key, district) do nothing;

  select * into workspace
  from public.scheduling_planning_workspaces
  where period_key = scope_period and district = scope_district
  for update;

  if p_expected_revision is not null and workspace.revision <> p_expected_revision then
    raise exception 'planning_revision_conflict';
  end if;

  select r.locked_option into old_option
  from public.scheduling_planning_rows r
  where r.workspace_id = workspace.id and r.activity_id = activity_id;

  old_emp := nullif(btrim(coalesce(old_option->>'instructorEmpId', '')), '');
  new_emp := nullif(btrim(coalesce(p_option->>'instructorEmpId', '')), '');

  insert into public.scheduling_planning_rows(
    workspace_id, activity_id, row_data, activity_updated_at,
    locked_option, locked_by, locked_at, needs_recalc, updated_at
  )
  select
    workspace.id, a.row_id, jsonb_build_object('courseId', a.row_id), a.updated_at,
    p_option,
    case when p_option is null then null else auth.uid() end,
    case when p_option is null then null else now() end,
    (p_option is null),
    now()
  from public.activities a where a.row_id = activity_id
  on conflict (workspace_id, activity_id)
  do update set
    locked_option = excluded.locked_option,
    locked_by = excluded.locked_by,
    locked_at = excluded.locked_at,
    needs_recalc = (p_option is null),
    updated_at = now();

  if old_emp is not null or new_emp is not null then
    with affected_dates as (
      select distinct value->>'date' as meeting_date
      from jsonb_array_elements(
        case when jsonb_typeof(old_option->'meetings') = 'array'
          then old_option->'meetings' else '[]'::jsonb end
      )
      where nullif(value->>'date', '') is not null
      union
      select distinct value->>'date' as meeting_date
      from jsonb_array_elements(
        case when jsonb_typeof(p_option->'meetings') = 'array'
          then p_option->'meetings' else '[]'::jsonb end
      )
      where nullif(value->>'date', '') is not null
    )
    update public.scheduling_planning_rows r
    set needs_recalc = true,
        updated_at = now()
    where r.workspace_id = workspace.id
      and r.activity_id <> activity_id
      and r.locked_option is null
      and lower(coalesce(r.row_data->>'kind', '')) <> 'live'
      and (
        coalesce(r.row_data->>'instructorEmpId', '') in (coalesce(old_emp, ''), coalesce(new_emp, ''))
        or exists (
          select 1
          from jsonb_array_elements(
            case when jsonb_typeof(r.row_data->'options') = 'array'
              then r.row_data->'options' else '[]'::jsonb end
          ) option_row
          where coalesce(option_row->>'instructorEmpId', '') in (coalesce(old_emp, ''), coalesce(new_emp, ''))
        )
      )
      and exists (
        select 1
        from affected_dates changed_date
        where exists (
          select 1
          from jsonb_array_elements(
            case when jsonb_typeof(r.row_data->'meetings') = 'array'
              then r.row_data->'meetings' else '[]'::jsonb end
          ) row_meeting
          where row_meeting->>'date' = changed_date.meeting_date
        )
        or exists (
          select 1
          from jsonb_array_elements(
            case when jsonb_typeof(r.row_data->'options') = 'array'
              then r.row_data->'options' else '[]'::jsonb end
          ) option_row
          cross join lateral jsonb_array_elements(
            case when jsonb_typeof(option_row->'meetings') = 'array'
              then option_row->'meetings' else '[]'::jsonb end
          ) option_meeting
          where coalesce(option_row->>'instructorEmpId', '') in (coalesce(old_emp, ''), coalesce(new_emp, ''))
            and option_meeting->>'date' = changed_date.meeting_date
        )
      );
    get diagnostics affected = row_count;
  end if;

  update public.scheduling_planning_workspaces
  set updated_at = now(), updated_by = auth.uid(), revision = revision + 1
  where id = workspace.id
  returning * into workspace;

  return jsonb_build_object(
    'revision', workspace.revision,
    'updatedAt', workspace.updated_at,
    'affected', affected + case when p_option is null then 1 else 0 end
  );
end
$$;

revoke all on function public.set_scheduling_planning_lock(text,text,text,jsonb,bigint) from public;
grant execute on function public.set_scheduling_planning_lock(text,text,text,jsonb,bigint) to authenticated;
