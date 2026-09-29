-- The hard-gate audit identifies specific invalid proposals. It must not use
-- activity-change invalidation, which expands through every candidate instructor.
create or replace function public.mark_scheduling_planning_needs_recalc_many(
  p_activity_ids text[],
  p_require_permission boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  marked_ids text[] := array[]::text[];
  rows_touched integer := 0;
  workspace_count integer := 0;
begin
  -- This RPC is only used by the client audit; do not allow callers to bypass
  -- the scheduling permission through p_require_permission=false.
  if not public.app_has_permission('view_operations_scheduling') then
    raise exception 'scheduling_permission_denied' using errcode = '42501';
  end if;

  with requested as (
    select distinct nullif(btrim(id), '') as activity_id
    from unnest(coalesce(p_activity_ids, array[]::text[])) as ids(id)
  ), touched as (
    update public.scheduling_planning_rows r
    set needs_recalc = true, updated_at = now()
    from requested ids
    where ids.activity_id = r.activity_id
      and r.needs_recalc is distinct from true
    returning r.workspace_id, r.activity_id
  ), changed_workspaces as (
    update public.scheduling_planning_workspaces w
    set updated_at = now(), updated_by = auth.uid(), revision = w.revision + 1
    where w.id in (select distinct workspace_id from touched)
    returning w.id
  )
  select
    coalesce((select array_agg(distinct activity_id order by activity_id) from touched), array[]::text[]),
    (select count(*) from touched),
    (select count(*) from changed_workspaces)
  into marked_ids, rows_touched, workspace_count;

  return jsonb_build_object(
    'markedActivityIds', to_jsonb(marked_ids),
    'affectedCount', cardinality(marked_ids),
    'rowsTouched', rows_touched,
    'workspaceCount', workspace_count
  );
end
$$;

revoke all on function public.mark_scheduling_planning_needs_recalc_many(text[], boolean) from public, anon;
grant execute on function public.mark_scheduling_planning_needs_recalc_many(text[], boolean) to authenticated;
