-- Commit an already-validated full-planning checkpoint without re-uploading and
-- reparsing the complete snapshot JSON. The checkpoint is fenced by the same
-- run/source/workspace revisions as the canonical snapshot writer.

create or replace function public.commit_scheduling_planning_checkpoint(
  p_period_key text,
  p_district text,
  p_engine_version text,
  p_data_fingerprint text,
  p_context_fingerprint text,
  p_expected_revision bigint,
  p_run_id uuid default null,
  p_source_revision bigint default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  scope_period text := nullif(btrim(coalesce(p_period_key, '')), '');
  scope_district text := btrim(coalesce(p_district, ''));
  workspace public.scheduling_planning_workspaces;
  checkpoint public.scheduling_planning_checkpoints;
  saved_count integer;
begin
  if p_expected_revision is null then raise exception 'planning_revision_required'; end if;
  if scope_period is null then raise exception 'planning_period_required'; end if;

  perform public.assert_scheduling_planning_run_ownership(
    scope_period, scope_district, p_run_id, p_expected_revision, p_source_revision
  );

  select * into workspace
  from public.scheduling_planning_workspaces
  where period_key = scope_period and district = scope_district
  for update;

  select * into checkpoint
  from public.scheduling_planning_checkpoints
  where period_key = scope_period and district = scope_district
  for update;

  if not found
     or checkpoint.phase is distinct from 'validated'
     or checkpoint.engine_version is distinct from coalesce(p_engine_version, '')
     or checkpoint.data_fingerprint is distinct from coalesce(p_data_fingerprint, '')
     or checkpoint.context_fingerprint is distinct from coalesce(p_context_fingerprint, '')
     or checkpoint.rows_data->0->>'sourceRevision' is distinct from p_source_revision::text
     or checkpoint.rows_data->0->>'workspaceRevision' is distinct from p_expected_revision::text
     or checkpoint.completed_count is distinct from checkpoint.total_count then
    raise exception 'planning_validated_checkpoint_required';
  end if;

  select count(*)::integer into saved_count
  from public.scheduling_planning_checkpoint_rows r
  where r.period_key = scope_period and r.district = scope_district;

  if saved_count is distinct from checkpoint.total_count then
    raise exception 'planning_checkpoint_incomplete';
  end if;

  -- The source-revision fence proves the live scheduling inputs have not changed.
  -- Still fail closed if any checkpoint row no longer maps 1:1 to an activity.
  if exists (
    select 1
    from public.scheduling_planning_checkpoint_rows r
    left join public.activities a on a.row_id = r.activity_id
    where r.period_key = scope_period
      and r.district = scope_district
      and (a.row_id is null or r.row_data->>'courseId' is distinct from r.activity_id)
  ) then
    raise exception 'planning_activity_changed';
  end if;

  insert into public.scheduling_planning_rows as existing (
    workspace_id, activity_id, row_data, activity_updated_at, needs_recalc, updated_at
  )
  select
    workspace.id,
    r.activity_id,
    r.row_data,
    a.updated_at,
    false,
    now()
  from public.scheduling_planning_checkpoint_rows r
  join public.activities a on a.row_id = r.activity_id
  where r.period_key = scope_period and r.district = scope_district
  on conflict on constraint scheduling_planning_rows_pkey
  do update set
    row_data = excluded.row_data,
    activity_updated_at = excluded.activity_updated_at,
    needs_recalc = false,
    updated_at = excluded.updated_at
  where existing.row_data is distinct from excluded.row_data
     or existing.activity_updated_at is distinct from excluded.activity_updated_at
     or existing.needs_recalc is distinct from false;

  delete from public.scheduling_planning_rows r
  where r.workspace_id = workspace.id
    and not exists (
      select 1
      from public.scheduling_planning_checkpoint_rows checkpoint_row
      where checkpoint_row.period_key = scope_period
        and checkpoint_row.district = scope_district
        and checkpoint_row.activity_id = r.activity_id
    );

  update public.scheduling_planning_workspaces
  set engine_version = coalesce(p_engine_version, ''),
      data_fingerprint = coalesce(p_data_fingerprint, ''),
      context_fingerprint = coalesce(p_context_fingerprint, ''),
      calculated_at = now(),
      updated_at = now(),
      updated_by = auth.uid(),
      validated_source_revision = p_source_revision,
      revision = revision + 1
  where id = workspace.id
  returning * into workspace;

  perform public.assert_scheduling_planning_run_ownership(
    scope_period, scope_district, p_run_id, null, p_source_revision
  );

  return jsonb_build_object(
    'id', workspace.id,
    'revision', workspace.revision,
    'calculatedAt', workspace.calculated_at,
    'updatedAt', workspace.updated_at
  );
end
$$;

revoke all on function public.commit_scheduling_planning_checkpoint(text,text,text,text,text,bigint,uuid,bigint) from public, anon, authenticated;
grant execute on function public.commit_scheduling_planning_checkpoint(text,text,text,text,text,bigint,uuid,bigint) to authenticated;
