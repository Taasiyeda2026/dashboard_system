-- Shared, revision-safe course-planning workspace.
-- Planning proposals remain separate from real activity assignments/drafts until an explicit
-- scheduling action persists them to public.activities.

create table if not exists public.scheduling_planning_workspaces (
  id uuid primary key default gen_random_uuid(),
  period_key text not null,
  district text not null default '',
  engine_version text not null default '',
  data_fingerprint text not null default '',
  context_fingerprint text not null default '',
  calculated_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  revision bigint not null default 0,
  constraint scheduling_planning_workspaces_scope_key unique (period_key, district)
);

create table if not exists public.scheduling_planning_rows (
  workspace_id uuid not null references public.scheduling_planning_workspaces(id) on delete cascade,
  activity_id text not null references public.activities(row_id) on delete cascade,
  row_data jsonb not null default '{}'::jsonb,
  activity_updated_at timestamptz,
  locked_option jsonb,
  locked_by uuid,
  locked_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, activity_id)
);

create index if not exists scheduling_planning_rows_activity_idx
  on public.scheduling_planning_rows(activity_id);

alter table public.scheduling_planning_workspaces enable row level security;
alter table public.scheduling_planning_rows enable row level security;

revoke all on public.scheduling_planning_workspaces from anon;
revoke all on public.scheduling_planning_rows from anon;
revoke insert, update, delete on public.scheduling_planning_workspaces from authenticated;
revoke insert, update, delete on public.scheduling_planning_rows from authenticated;
grant select on public.scheduling_planning_workspaces to authenticated;
grant select on public.scheduling_planning_rows to authenticated;

drop policy if exists scheduling_planning_workspaces_read on public.scheduling_planning_workspaces;
create policy scheduling_planning_workspaces_read
  on public.scheduling_planning_workspaces
  for select
  to authenticated
  using (public.app_has_permission('view_operations_scheduling'));

drop policy if exists scheduling_planning_rows_read on public.scheduling_planning_rows;
create policy scheduling_planning_rows_read
  on public.scheduling_planning_rows
  for select
  to authenticated
  using (public.app_has_permission('view_operations_scheduling'));

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
  if scope_period is null then
    raise exception 'planning_period_required';
  end if;

  select * into workspace
  from public.scheduling_planning_workspaces
  where period_key = scope_period
    and district = scope_district;

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
        'lockedBy', r.locked_by
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

revoke all on function public.get_scheduling_planning_workspace(text,text) from public;
grant execute on function public.get_scheduling_planning_workspace(text,text) to authenticated;

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
  if scope_period is null then
    raise exception 'planning_period_required';
  end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'planning_rows_invalid';
  end if;

  insert into public.scheduling_planning_workspaces(period_key, district, updated_by)
  values (scope_period, scope_district, auth.uid())
  on conflict (period_key, district) do nothing;

  select * into workspace
  from public.scheduling_planning_workspaces
  where period_key = scope_period
    and district = scope_district
  for update;

  if p_expected_revision is not null and workspace.revision <> p_expected_revision then
    raise exception 'planning_revision_conflict';
  end if;

  -- Guard the calculation/save race: every source activity version supplied by the
  -- browser must still match the live row at the instant the shared snapshot is saved.
  for item in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    activity_id := nullif(btrim(coalesce(item->>'activityId', '')), '');
    if activity_id is null then
      raise exception 'planning_activity_id_required';
    end if;
    source_updated_at := nullif(item->>'activityUpdatedAt', '')::timestamptz;
    select a.updated_at into current_updated_at
    from public.activities a
    where a.row_id = activity_id;
    if not found then
      raise exception 'planning_activity_changed';
    end if;
    if current_updated_at is distinct from source_updated_at then
      raise exception 'planning_activity_changed';
    end if;
    row_ids := array_append(row_ids, activity_id);
  end loop;

  for item in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    activity_id := btrim(item->>'activityId');
    source_updated_at := nullif(item->>'activityUpdatedAt', '')::timestamptz;

    insert into public.scheduling_planning_rows(
      workspace_id,
      activity_id,
      row_data,
      activity_updated_at,
      updated_at
    ) values (
      workspace.id,
      activity_id,
      coalesce(item->'row', '{}'::jsonb),
      source_updated_at,
      now()
    )
    on conflict (workspace_id, activity_id)
    do update set
      row_data = excluded.row_data,
      activity_updated_at = excluded.activity_updated_at,
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

revoke all on function public.save_scheduling_planning_snapshot(text,text,text,text,text,jsonb,bigint) from public;
grant execute on function public.save_scheduling_planning_snapshot(text,text,text,text,text,jsonb,bigint) to authenticated;

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
  if scope_period is null or activity_id is null then
    raise exception 'planning_scope_invalid';
  end if;
  if not exists(select 1 from public.activities a where a.row_id = activity_id) then
    raise exception 'activity_not_found';
  end if;

  insert into public.scheduling_planning_workspaces(period_key, district, updated_by)
  values (scope_period, scope_district, auth.uid())
  on conflict (period_key, district) do nothing;

  select * into workspace
  from public.scheduling_planning_workspaces
  where period_key = scope_period
    and district = scope_district
  for update;

  if p_expected_revision is not null and workspace.revision <> p_expected_revision then
    raise exception 'planning_revision_conflict';
  end if;

  select r.locked_option into old_option
  from public.scheduling_planning_rows r
  where r.workspace_id = workspace.id
    and r.activity_id = activity_id;

  old_emp := nullif(btrim(coalesce(old_option->>'instructorEmpId', '')), '');
  new_emp := nullif(btrim(coalesce(p_option->>'instructorEmpId', '')), '');

  insert into public.scheduling_planning_rows(
    workspace_id, activity_id, row_data, activity_updated_at,
    locked_option, locked_by, locked_at, updated_at
  )
  select
    workspace.id,
    a.row_id,
    jsonb_build_object('courseId', a.row_id),
    a.updated_at,
    p_option,
    case when p_option is null then null else auth.uid() end,
    case when p_option is null then null else now() end,
    now()
  from public.activities a
  where a.row_id = activity_id
  on conflict (workspace_id, activity_id)
  do update set
    locked_option = excluded.locked_option,
    locked_by = excluded.locked_by,
    locked_at = excluded.locked_at,
    updated_at = now();

  -- Only recommendations that use the same instructor can be affected by a lock/unlock.
  -- They will be recalculated on the next incremental refresh, while unrelated rows stay stable.
  if old_emp is not null or new_emp is not null then
    update public.scheduling_planning_rows r
    set updated_at = now()
    where r.workspace_id = workspace.id
      and r.activity_id <> activity_id
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
  set updated_at = now(),
      updated_by = auth.uid(),
      revision = revision + 1
  where id = workspace.id
  returning * into workspace;

  return jsonb_build_object(
    'revision', workspace.revision,
    'updatedAt', workspace.updated_at,
    'affected', affected
  );
end
$$;

revoke all on function public.set_scheduling_planning_lock(text,text,text,jsonb,bigint) from public;
grant execute on function public.set_scheduling_planning_lock(text,text,text,jsonb,bigint) to authenticated;

create or replace function public.clear_scheduling_planning_workspace(
  p_period_key text,
  p_district text default '',
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

  select * into workspace
  from public.scheduling_planning_workspaces
  where period_key = scope_period
    and district = scope_district
  for update;

  if not found then
    return jsonb_build_object('revision', 0, 'cleared', true);
  end if;
  if p_expected_revision is not null and workspace.revision <> p_expected_revision then
    raise exception 'planning_revision_conflict';
  end if;

  delete from public.scheduling_planning_rows where workspace_id = workspace.id;

  update public.scheduling_planning_workspaces
  set engine_version = '',
      data_fingerprint = '',
      context_fingerprint = '',
      calculated_at = null,
      updated_at = now(),
      updated_by = auth.uid(),
      revision = revision + 1
  where id = workspace.id
  returning * into workspace;

  return jsonb_build_object('revision', workspace.revision, 'cleared', true, 'updatedAt', workspace.updated_at);
end
$$;

revoke all on function public.clear_scheduling_planning_workspace(text,text,bigint) from public;
grant execute on function public.clear_scheduling_planning_workspace(text,text,bigint) to authenticated;

comment on table public.scheduling_planning_workspaces is
  'Shared course-planning workspace by period and district. This is planning state only; it does not assign instructors.';
comment on table public.scheduling_planning_rows is
  'Shared planning proposal rows and explicit planning locks. Real drafts/assignments remain in public.activities.';
