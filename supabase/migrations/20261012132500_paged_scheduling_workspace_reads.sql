-- 2026-10-12: bounded, revision-fenced full-workspace reads.
-- Avoid the single >9MB JSON RPC that has timed out (57014) under load.
-- This additive RPC preserves the exact original workspace/row response shape.
create or replace function public.get_scheduling_planning_workspace_page(
  p_period_key text,
  p_district text default '',
  p_limit integer default 25,
  p_offset integer default 0,
  p_expected_revision bigint default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  scope_period text := nullif(btrim(coalesce(p_period_key,'')),'');
  scope_district text := btrim(coalesce(p_district,''));
  workspace public.scheduling_planning_workspaces;
  editor_name text := '';
  rows_json jsonb := '[]'::jsonb;
  total_count integer := 0;
  verified_revision bigint;
begin
  if auth.uid() is null or not public.app_has_permission('view_operations_scheduling') then
    raise exception 'scheduling_permission_denied' using errcode='42501';
  end if;
  if scope_period is null then raise exception 'planning_period_required'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 50 or p_offset is null or p_offset < 0 then
    raise exception 'planning_page_arguments_invalid';
  end if;
  select * into workspace from public.scheduling_planning_workspaces
  where period_key=scope_period and district=scope_district;
  if not found then
    if p_expected_revision is not null then raise exception 'planning_revision_conflict'; end if;
    return jsonb_build_object('workspace',null,'rows','[]'::jsonb,'total',0);
  end if;
  if p_expected_revision is not null and workspace.revision is distinct from p_expected_revision then
    raise exception 'planning_revision_conflict';
  end if;
  select coalesce(u.full_name,u.name,u.email,'') into editor_name
  from public.users u where u.auth_user_id=workspace.updated_by limit 1;

  select count(*) into total_count from public.scheduling_planning_rows r where r.workspace_id=workspace.id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'activityId', r.activity_id,
    'row', r.row_data,
    'activityUpdatedAt', r.activity_updated_at,
    'lockedOption', r.locked_option,
    'lockedAt', r.locked_at,
    'lockedBy', r.locked_by,
    'needsRecalc', r.needs_recalc,
    'needsRecalcMarkedAt', r.needs_recalc_marked_at
  ) order by r.activity_id),'[]'::jsonb)
  into rows_json
  from (
    select activity_id,row_data,activity_updated_at,locked_option,locked_at,
      locked_by,needs_recalc,needs_recalc_marked_at
    from public.scheduling_planning_rows
    where workspace_id=workspace.id
    order by activity_id
    limit p_limit offset p_offset
  ) r;
  select revision into verified_revision from public.scheduling_planning_workspaces where id=workspace.id;
  if verified_revision is distinct from workspace.revision then
    raise exception 'planning_revision_conflict';
  end if;
  return jsonb_build_object(
    'workspace',jsonb_build_object(
      'id',workspace.id,'periodKey',workspace.period_key,'district',workspace.district,
      'engineVersion',workspace.engine_version,'dataFingerprint',workspace.data_fingerprint,
      'contextFingerprint',workspace.context_fingerprint,'calculatedAt',workspace.calculated_at,
      'updatedAt',workspace.updated_at,'updatedBy',workspace.updated_by,
      'updatedByName',coalesce(editor_name,''),'revision',workspace.revision
    ),
    'rows',rows_json,'total',total_count
  );
end
$function$;
revoke all on function public.get_scheduling_planning_workspace_page(text,text,integer,integer,bigint) from public,anon;
grant execute on function public.get_scheduling_planning_workspace_page(text,text,integer,integer,bigint) to authenticated;
