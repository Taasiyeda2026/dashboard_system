-- Fingerprint-only upgrade for legacy plain context hashes -> granular JSON storage.
-- Must not touch planning rows, locks, assignments, or calculated_at.

create or replace function public.upgrade_scheduling_planning_context_fingerprint(
  p_period_key text,
  p_district text,
  p_context_fingerprint text,
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
  if nullif(btrim(coalesce(p_context_fingerprint, '')), '') is null then
    raise exception 'planning_context_fingerprint_required';
  end if;

  select * into workspace
  from public.scheduling_planning_workspaces
  where period_key = scope_period and district = scope_district
  for update;

  if not found then
    raise exception 'planning_workspace_missing';
  end if;

  if p_expected_revision is not null and workspace.revision <> p_expected_revision then
    raise exception 'planning_revision_conflict';
  end if;

  update public.scheduling_planning_workspaces
  set context_fingerprint = btrim(p_context_fingerprint),
      updated_at = now(),
      updated_by = auth.uid(),
      revision = revision + 1
  where id = workspace.id
  returning * into workspace;

  return jsonb_build_object(
    'id', workspace.id,
    'revision', workspace.revision,
    'contextFingerprint', workspace.context_fingerprint,
    'updatedAt', workspace.updated_at,
    'calculatedAt', workspace.calculated_at
  );
end
$$;

revoke all on function public.upgrade_scheduling_planning_context_fingerprint(text, text, text, bigint) from public;
grant execute on function public.upgrade_scheduling_planning_context_fingerprint(text, text, text, bigint) to authenticated;
