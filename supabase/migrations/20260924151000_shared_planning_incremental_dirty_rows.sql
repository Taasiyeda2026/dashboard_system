-- Persist targeted planning invalidation so every user sees the same pending recalculation set.

alter table public.scheduling_planning_rows
  add column if not exists needs_recalc boolean not null default false;

create index if not exists scheduling_planning_rows_needs_recalc_idx
  on public.scheduling_planning_rows(workspace_id, needs_recalc)
  where needs_recalc is true;

create or replace function public.get_scheduling_planning_workspace(
  p_period_key text,
  p_district text default ''
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  scope_period text := nullif(btrim(coalesce(p_period_key, '')), '');
  scope_district text := btrim(coalesce(p_district, ''));
  workspace public.scheduling_planning_workspaces;
  editor_name text;
  rows_json jsonb;
begin
  if not public.app_has_permission('view_operations_scheduling') then
    raise exception 'scheduling_permission_denied' using errcode='42501';
  end if;
  if scope_period is null then raise exception 'planning_period_required'; end if;

  select * into workspace
  from public.scheduling_planning_workspaces
  where period_key = scope_period and district = scope_district;

  if not found then
    return jsonb_build_object('workspace', null, 'rows', '[]'::jsonb);
  end if;

  select coalesce(u.full_name, u.name, u.email, '')
    into editor_name
  from public.users u
  where u.auth_user_id = workspace.updated_by
  limit 1;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'activityId', r.activity_id,
        'row', r.row_data,
        'activityUpdatedAt', r.activity_updated_at,
        'lockedOption', r.locked_option,
        'lockedAt', r.locked_at,
        'lockedBy', r.locked_by,
        'needsRecalc', r.needs_recalc
      )
      order by r.activity_id
    ),
    '[]'::jsonb
  ) into rows_json
  from public.scheduling_planning_rows r
  where r.workspace_id = workspace.id;

  return jsonb_build_object(
    'workspace', jsonb_build_object(
      'id', workspace.id,
      'periodKey', workspace.period_key,
      'district', workspace.district,
      'engineVersion', workspace.engine_version,
      'dataFingerprint', workspace.data_fingerprint,
      'contextFingerprint', workspace.context_fingerprint,
      'calculatedAt', workspace.calculated_at,
      'updatedAt', workspace.updated_at,
      'updatedBy', workspace.updated_by,
      'updatedByName', coalesce(editor_name, ''),
      'revision', workspace.revision
    ),
    'rows', rows_json
  );
end
$$;

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
  item jsonb;
  activity_id text;
  source_updated_at timestamptz;
  current_updated_at timestamptz;
  row_ids text[] := array[]::text[];
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
    activity_id := nullif(btrim(coalesce(item->>'activityId', '')), '');
    if activity_id is null then raise exception 'planning_activity_id_required'; end if;
    source_updated_at := nullif(item->>'activityUpdatedAt', '')::timestamptz;
    select a.updated_at into current_updated_at from public.activities a where a.row_id = activity_id;
    if not found or current_updated_at is distinct from source_updated_at then
      raise exception 'planning_activity_changed';
    end if;
    row_ids := array_append(row_ids, activity_id);
  end loop;

  for item in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    activity_id := btrim(item->>'activityId');
    source_updated_at := nullif(item->>'activityUpdatedAt', '')::timestamptz;
    insert into public.scheduling_planning_rows(
      workspace_id, activity_id, row_data, activity_updated_at, needs_recalc, updated_at
    ) values (
      workspace.id, activity_id, coalesce(item->'row', '{}'::jsonb), source_updated_at, false, now()
    )
    on conflict (workspace_id, activity_id)
    do update set
      row_data = excluded.row_data,
      activity_updated_at = excluded.activity_updated_at,
      needs_recalc = false,
      updated_at = now();
  end loop;

  delete from public.scheduling_planning_rows r
  where r.workspace_id = workspace.id
    and not (r.activity_id = any(row_ids));

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
    false,
    now()
  from public.activities a where a.row_id = activity_id
  on conflict (workspace_id, activity_id)
  do update set
    locked_option = excluded.locked_option,
    locked_by = excluded.locked_by,
    locked_at = excluded.locked_at,
    needs_recalc = false,
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
    'affected', affected
  );
end
$$;

revoke all on function public.get_scheduling_planning_workspace(text,text) from public;
grant execute on function public.get_scheduling_planning_workspace(text,text) to authenticated;
revoke all on function public.save_scheduling_planning_snapshot(text,text,text,text,text,jsonb,bigint) from public;
grant execute on function public.save_scheduling_planning_snapshot(text,text,text,text,text,jsonb,bigint) to authenticated;
revoke all on function public.set_scheduling_planning_lock(text,text,text,jsonb,bigint) from public;
grant execute on function public.set_scheduling_planning_lock(text,text,text,jsonb,bigint) to authenticated;
