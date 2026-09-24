-- Unlocking a planning choice must recalculate that activity as well as dependent rows.

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
    update public.scheduling_planning_rows r
    set needs_recalc = true,
        updated_at = now()
    where r.workspace_id = workspace.id
      and r.activity_id <> activity_id
      and r.locked_option is null
      and (
        coalesce(r.row_data->>'instructorEmpId', '') in (coalesce(old_emp, ''), coalesce(new_emp, ''))
        or exists (
          select 1
          from jsonb_array_elements(coalesce(r.row_data->'options', '[]'::jsonb)) option_row
          where coalesce(option_row->>'instructorEmpId', '') in (coalesce(old_emp, ''), coalesce(new_emp, ''))
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
