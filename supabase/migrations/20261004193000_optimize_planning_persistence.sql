-- Planning persistence hotfix:
-- 1) replace row-by-row full snapshot writes with set-based validation/upsert
-- 2) add an incremental snapshot RPC so local repairs only persist changed rows

create or replace function public.save_scheduling_planning_snapshot(
  p_period_key text,
  p_district text,
  p_engine_version text,
  p_data_fingerprint text,
  p_context_fingerprint text,
  p_rows jsonb,
  p_expected_revision bigint default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  scope_period text := nullif(btrim(coalesce(p_period_key, '')), '');
  scope_district text := btrim(coalesce(p_district, ''));
  workspace public.scheduling_planning_workspaces;
begin
  if not public.app_has_permission('view_operations_scheduling') then
    raise exception 'scheduling_permission_denied' using errcode='42501';
  end if;
  if scope_period is null then raise exception 'planning_period_required'; end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'planning_rows_invalid';
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

  -- Validate every submitted activity version in one set-based query.
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) item
    left join public.activities a
      on a.row_id = nullif(btrim(coalesce(item->>'activityId', '')), '')
    where nullif(btrim(coalesce(item->>'activityId', '')), '') is null
       or a.row_id is null
       or a.updated_at is distinct from nullif(item->>'activityUpdatedAt', '')::timestamptz
  ) then
    raise exception 'planning_activity_changed';
  end if;

  -- One INSERT .. SELECT replaces the previous per-row PL/pgSQL loop.
  insert into public.scheduling_planning_rows(
    workspace_id, activity_id, row_data, activity_updated_at, needs_recalc, updated_at
  )
  select
    workspace.id,
    btrim(item->>'activityId'),
    coalesce(item->'row', '{}'::jsonb),
    nullif(item->>'activityUpdatedAt', '')::timestamptz,
    false,
    now()
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) item
  on conflict on constraint scheduling_planning_rows_pkey
  do update set
    row_data = excluded.row_data,
    activity_updated_at = excluded.activity_updated_at,
    needs_recalc = false,
    updated_at = now();

  delete from public.scheduling_planning_rows r
  where r.workspace_id = workspace.id
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) item
      where btrim(item->>'activityId') = r.activity_id
    );

  update public.scheduling_planning_workspaces
  set engine_version = coalesce(p_engine_version, ''),
      data_fingerprint = coalesce(p_data_fingerprint, ''),
      context_fingerprint = coalesce(p_context_fingerprint, ''),
      calculated_at = now(),
      updated_at = now(),
      updated_by = auth.uid(),
      revision = revision + 1
  where id = workspace.id
  returning * into workspace;

  return jsonb_build_object(
    'id', workspace.id,
    'revision', workspace.revision,
    'calculatedAt', workspace.calculated_at,
    'updatedAt', workspace.updated_at
  );
end
$$;

revoke all on function public.save_scheduling_planning_snapshot(text,text,text,text,text,jsonb,bigint) from public;
grant execute on function public.save_scheduling_planning_snapshot(text,text,text,text,text,jsonb,bigint) to authenticated;

create or replace function public.save_scheduling_planning_incremental_snapshot(
  p_period_key text,
  p_district text,
  p_engine_version text,
  p_data_fingerprint text,
  p_context_fingerprint text,
  p_rows jsonb,
  p_removed_activity_ids jsonb default '[]'::jsonb,
  p_expected_revision bigint default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  scope_period text := nullif(btrim(coalesce(p_period_key, '')), '');
  scope_district text := btrim(coalesce(p_district, ''));
  workspace public.scheduling_planning_workspaces;
begin
  if not public.app_has_permission('view_operations_scheduling') then
    raise exception 'scheduling_permission_denied' using errcode='42501';
  end if;
  if scope_period is null then raise exception 'planning_period_required'; end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'planning_rows_invalid';
  end if;
  if jsonb_typeof(coalesce(p_removed_activity_ids, '[]'::jsonb)) <> 'array' then
    raise exception 'planning_removed_activity_ids_invalid';
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

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) item
    left join public.activities a
      on a.row_id = nullif(btrim(coalesce(item->>'activityId', '')), '')
    where nullif(btrim(coalesce(item->>'activityId', '')), '') is null
       or a.row_id is null
       or a.updated_at is distinct from nullif(item->>'activityUpdatedAt', '')::timestamptz
  ) then
    raise exception 'planning_activity_changed';
  end if;

  insert into public.scheduling_planning_rows(
    workspace_id, activity_id, row_data, activity_updated_at, needs_recalc, updated_at
  )
  select
    workspace.id,
    btrim(item->>'activityId'),
    coalesce(item->'row', '{}'::jsonb),
    nullif(item->>'activityUpdatedAt', '')::timestamptz,
    false,
    now()
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) item
  on conflict on constraint scheduling_planning_rows_pkey
  do update set
    row_data = excluded.row_data,
    activity_updated_at = excluded.activity_updated_at,
    needs_recalc = false,
    updated_at = now();

  delete from public.scheduling_planning_rows r
  where r.workspace_id = workspace.id
    and r.activity_id in (
      select btrim(value)
      from jsonb_array_elements_text(coalesce(p_removed_activity_ids, '[]'::jsonb)) value
      where btrim(value) <> ''
    );

  update public.scheduling_planning_workspaces
  set engine_version = coalesce(p_engine_version, ''),
      data_fingerprint = coalesce(p_data_fingerprint, ''),
      context_fingerprint = coalesce(p_context_fingerprint, ''),
      calculated_at = now(),
      updated_at = now(),
      updated_by = auth.uid(),
      revision = revision + 1
  where id = workspace.id
  returning * into workspace;

  return jsonb_build_object(
    'id', workspace.id,
    'revision', workspace.revision,
    'calculatedAt', workspace.calculated_at,
    'updatedAt', workspace.updated_at,
    'savedRows', jsonb_array_length(coalesce(p_rows, '[]'::jsonb)),
    'removedRows', jsonb_array_length(coalesce(p_removed_activity_ids, '[]'::jsonb))
  );
end
$$;

revoke all on function public.save_scheduling_planning_incremental_snapshot(text,text,text,text,text,jsonb,jsonb,bigint) from public;
grant execute on function public.save_scheduling_planning_incremental_snapshot(text,text,text,text,text,jsonb,jsonb,bigint) to authenticated;
