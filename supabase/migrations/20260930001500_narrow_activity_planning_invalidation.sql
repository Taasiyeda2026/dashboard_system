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
