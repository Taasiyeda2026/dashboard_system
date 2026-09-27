-- Incremental planning must upsert only affected rows.
-- Full replace (delete rows missing from payload) is allowed only when p_replace_all=true.

create or replace function public.save_scheduling_planning_snapshot(
  p_period_key text,
  p_district text,
  p_engine_version text,
  p_data_fingerprint text,
  p_context_fingerprint text,
  p_rows jsonb,
  p_expected_revision bigint default null,
  p_replace_all boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  scope_period text := nullif(btrim(coalesce(p_period_key, '')), '');
  scope_district text := btrim(coalesce(p_district, ''));
  workspace public.scheduling_planning_workspaces;
  item jsonb;
  v_activity_id text;
  source_updated_at timestamptz;
  current_updated_at timestamptz;
  row_ids text[] := array[]::text[];
  touched_count integer := 0;
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

  for item in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    v_activity_id := nullif(btrim(coalesce(item->>'activityId', '')), '');
    if v_activity_id is null then raise exception 'planning_activity_id_required'; end if;
    source_updated_at := nullif(item->>'activityUpdatedAt', '')::timestamptz;
    select a.updated_at into current_updated_at from public.activities a where a.row_id = v_activity_id;
    if not found or current_updated_at is distinct from source_updated_at then
      raise exception 'planning_activity_changed';
    end if;
    row_ids := array_append(row_ids, v_activity_id);
  end loop;

  for item in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    v_activity_id := btrim(item->>'activityId');
    source_updated_at := nullif(item->>'activityUpdatedAt', '')::timestamptz;
    insert into public.scheduling_planning_rows(
      workspace_id, activity_id, row_data, activity_updated_at, needs_recalc, updated_at
    ) values (
      workspace.id, v_activity_id, coalesce(item->'row', '{}'::jsonb), source_updated_at, false, now()
    )
    on conflict on constraint scheduling_planning_rows_pkey
    do update set
      row_data = excluded.row_data,
      activity_updated_at = excluded.activity_updated_at,
      needs_recalc = false,
      updated_at = now();
    touched_count := touched_count + 1;
  end loop;

  if coalesce(p_replace_all, false) then
    delete from public.scheduling_planning_rows r
    where r.workspace_id = workspace.id
      and not (r.activity_id = any(row_ids));
  end if;

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
    'touchedCount', touched_count,
    'replaceAll', coalesce(p_replace_all, false)
  );
end
$$;

revoke all on function public.save_scheduling_planning_snapshot(text,text,text,text,text,jsonb,bigint,boolean) from public;
grant execute on function public.save_scheduling_planning_snapshot(text,text,text,text,text,jsonb,bigint,boolean) to authenticated;

-- Keep the previous 7-arg signature callable for older clients; default replace_all=false
-- so accidental full rewrites stop.
drop function if exists public.save_scheduling_planning_snapshot(text,text,text,text,text,jsonb,bigint);

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
begin
  return public.save_scheduling_planning_snapshot(
    p_period_key,
    p_district,
    p_engine_version,
    p_data_fingerprint,
    p_context_fingerprint,
    p_rows,
    p_expected_revision,
    false
  );
end
$$;

revoke all on function public.save_scheduling_planning_snapshot(text,text,text,text,text,jsonb,bigint) from public;
grant execute on function public.save_scheduling_planning_snapshot(text,text,text,text,text,jsonb,bigint) to authenticated;
