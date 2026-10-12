-- 2026-10-12: optimize v37 checkpoint and incremental commits under
-- authenticated 8s timeout. Preserve all revision/lease/source/locked gates.
-- The validator reads only prior row.startDate, instructorEmpId, meetings,
-- lockedOption and courseId. Do not materialize unused options/packingOptions
-- /scheduleOptions (9.2 MB -> 292 KB for current 247-row workspace).
-- Keep input and saved rows completely unchanged. No limits or permission changes.


CREATE OR REPLACE FUNCTION public.save_scheduling_planning_incremental_snapshot(p_period_key text, p_district text, p_engine_version text, p_data_fingerprint text, p_context_fingerprint text, p_rows jsonb, p_removed_activity_ids jsonb, p_expected_revision bigint, p_run_id uuid DEFAULT NULL::uuid, p_source_revision bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb; previous_version text; prior_payload jsonb;
begin
  perform public.assert_scheduling_planning_run_ownership(p_period_key,p_district,p_run_id,p_expected_revision,p_source_revision);
  select engine_version into previous_version from public.scheduling_planning_workspaces where period_key=btrim(p_period_key) and district=btrim(coalesce(p_district,''));
  select coalesce(jsonb_agg(jsonb_build_object('courseId',r.activity_id,'row',jsonb_build_object('instructorEmpId',r.row_data->'instructorEmpId','startDate',r.row_data->'startDate','meetings',r.row_data->'meetings'),'lockedOption',r.locked_option)),'[]'::jsonb) into prior_payload from public.scheduling_planning_rows r join public.scheduling_planning_workspaces w on w.id=r.workspace_id where w.period_key=btrim(p_period_key) and w.district=btrim(coalesce(p_district,''));
  if previous_version like 'planning-v37-%' and p_engine_version is distinct from previous_version then raise exception 'planning_engine_downgrade_forbidden'; end if;
  result:=public.save_scheduling_planning_incremental_snapshot_before_v37(p_period_key,p_district,p_engine_version,p_data_fingerprint,p_context_fingerprint,p_rows,p_removed_activity_ids,p_expected_revision,p_run_id,p_source_revision);
  if p_engine_version like 'planning-v37-%' then perform public.scheduling_v37_workspace_validation((result->>'id')::uuid,prior_payload); end if;
  return result;
end $function$
;


CREATE OR REPLACE FUNCTION public.commit_scheduling_planning_checkpoint(p_period_key text, p_district text, p_engine_version text, p_data_fingerprint text, p_context_fingerprint text, p_expected_revision bigint, p_run_id uuid DEFAULT NULL::uuid, p_source_revision bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb; previous_version text; prior_payload jsonb;
begin
  perform public.assert_scheduling_planning_run_ownership(p_period_key,p_district,p_run_id,p_expected_revision,p_source_revision);
  select engine_version into previous_version from public.scheduling_planning_workspaces where period_key=btrim(p_period_key) and district=btrim(coalesce(p_district,''));
  select coalesce(jsonb_agg(jsonb_build_object('courseId',r.activity_id,'row',jsonb_build_object('instructorEmpId',r.row_data->'instructorEmpId','startDate',r.row_data->'startDate','meetings',r.row_data->'meetings'),'lockedOption',r.locked_option)),'[]'::jsonb) into prior_payload from public.scheduling_planning_rows r join public.scheduling_planning_workspaces w on w.id=r.workspace_id where w.period_key=btrim(p_period_key) and w.district=btrim(coalesce(p_district,''));
  if previous_version like 'planning-v37-%' and p_engine_version is distinct from previous_version then raise exception 'planning_engine_downgrade_forbidden'; end if;
  result:=public.commit_scheduling_planning_checkpoint_before_v37(p_period_key,p_district,p_engine_version,p_data_fingerprint,p_context_fingerprint,p_expected_revision,p_run_id,p_source_revision);
  if p_engine_version like 'planning-v37-%' then perform public.scheduling_v37_workspace_validation((result->>'id')::uuid,prior_payload); end if;
  return result;
end $function$
;


CREATE OR REPLACE FUNCTION public.save_scheduling_planning_snapshot(p_period_key text, p_district text, p_engine_version text, p_data_fingerprint text, p_context_fingerprint text, p_rows jsonb, p_expected_revision bigint, p_run_id uuid DEFAULT NULL::uuid, p_source_revision bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb; previous_version text; prior_payload jsonb;
begin
  perform public.assert_scheduling_planning_run_ownership(p_period_key,p_district,p_run_id,p_expected_revision,p_source_revision);
  select engine_version into previous_version from public.scheduling_planning_workspaces where period_key=btrim(p_period_key) and district=btrim(coalesce(p_district,''));
  select coalesce(jsonb_agg(jsonb_build_object('courseId',r.activity_id,'row',jsonb_build_object('instructorEmpId',r.row_data->'instructorEmpId','startDate',r.row_data->'startDate','meetings',r.row_data->'meetings'),'lockedOption',r.locked_option)),'[]'::jsonb) into prior_payload from public.scheduling_planning_rows r join public.scheduling_planning_workspaces w on w.id=r.workspace_id where w.period_key=btrim(p_period_key) and w.district=btrim(coalesce(p_district,''));
  if previous_version like 'planning-v37-%' and p_engine_version is distinct from previous_version then raise exception 'planning_engine_downgrade_forbidden'; end if;
  result:=public.save_scheduling_planning_snapshot_before_v37(p_period_key,p_district,p_engine_version,p_data_fingerprint,p_context_fingerprint,p_rows,p_expected_revision,p_run_id,p_source_revision);
  if p_engine_version like 'planning-v37-%' then perform public.scheduling_v37_workspace_validation((result->>'id')::uuid,prior_payload); end if;
  return result;
end $function$
;


CREATE OR REPLACE FUNCTION public.save_scheduling_planning_incremental_snapshot_unfenced(p_period_key text, p_district text, p_engine_version text, p_data_fingerprint text, p_context_fingerprint text, p_rows jsonb, p_removed_activity_ids jsonb DEFAULT '[]'::jsonb, p_expected_revision bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    updated_at = now()
  where public.scheduling_planning_rows.row_data is distinct from excluded.row_data
     or public.scheduling_planning_rows.activity_updated_at is distinct from excluded.activity_updated_at
     or public.scheduling_planning_rows.needs_recalc is distinct from false;

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
$function$
;
