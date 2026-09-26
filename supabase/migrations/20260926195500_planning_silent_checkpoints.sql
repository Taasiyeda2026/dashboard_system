-- Durable, hidden checkpoints for long-running scheduling planning.
-- Checkpoints never replace the canonical planning workspace and are not shown in the UI.

create table if not exists public.scheduling_planning_checkpoints (
  period_key text not null,
  district text not null default '',
  engine_version text not null,
  data_fingerprint text not null,
  context_fingerprint text not null,
  completed_count integer not null default 0,
  total_count integer not null default 0,
  completed_activity_ids jsonb not null default '[]'::jsonb,
  rows_data jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (period_key, district)
);

alter table public.scheduling_planning_checkpoints enable row level security;
revoke all on public.scheduling_planning_checkpoints from anon;
revoke all on public.scheduling_planning_checkpoints from authenticated;

create or replace function public.get_scheduling_planning_checkpoint(
  p_period_key text,
  p_district text,
  p_engine_version text,
  p_data_fingerprint text,
  p_context_fingerprint text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  scope_period text := nullif(btrim(coalesce(p_period_key, '')), '');
  scope_district text := btrim(coalesce(p_district, ''));
  checkpoint public.scheduling_planning_checkpoints;
begin
  if not public.app_has_permission('view_operations_scheduling') then
    raise exception 'scheduling_permission_denied' using errcode='42501';
  end if;
  if scope_period is null then raise exception 'planning_period_required'; end if;

  select * into checkpoint
  from public.scheduling_planning_checkpoints
  where period_key = scope_period
    and district = scope_district
    and engine_version = coalesce(p_engine_version, '')
    and data_fingerprint = coalesce(p_data_fingerprint, '')
    and context_fingerprint = coalesce(p_context_fingerprint, '');

  if not found then return null; end if;

  return jsonb_build_object(
    'completedCount', checkpoint.completed_count,
    'totalCount', checkpoint.total_count,
    'completedActivityIds', checkpoint.completed_activity_ids,
    'rows', checkpoint.rows_data,
    'updatedAt', checkpoint.updated_at
  );
end
$$;

create or replace function public.save_scheduling_planning_checkpoint(
  p_period_key text,
  p_district text,
  p_engine_version text,
  p_data_fingerprint text,
  p_context_fingerprint text,
  p_completed_count integer,
  p_total_count integer,
  p_completed_activity_ids jsonb,
  p_rows jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  scope_period text := nullif(btrim(coalesce(p_period_key, '')), '');
  scope_district text := btrim(coalesce(p_district, ''));
  saved public.scheduling_planning_checkpoints;
begin
  if not public.app_has_permission('view_operations_scheduling') then
    raise exception 'scheduling_permission_denied' using errcode='42501';
  end if;
  if scope_period is null then raise exception 'planning_period_required'; end if;
  if jsonb_typeof(coalesce(p_completed_activity_ids, '[]'::jsonb)) <> 'array' then
    raise exception 'planning_checkpoint_ids_invalid';
  end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'planning_checkpoint_rows_invalid';
  end if;

  insert into public.scheduling_planning_checkpoints(
    period_key, district, engine_version, data_fingerprint, context_fingerprint,
    completed_count, total_count, completed_activity_ids, rows_data, updated_at, updated_by
  ) values (
    scope_period,
    scope_district,
    coalesce(p_engine_version, ''),
    coalesce(p_data_fingerprint, ''),
    coalesce(p_context_fingerprint, ''),
    greatest(0, coalesce(p_completed_count, 0)),
    greatest(0, coalesce(p_total_count, 0)),
    coalesce(p_completed_activity_ids, '[]'::jsonb),
    coalesce(p_rows, '[]'::jsonb),
    now(),
    auth.uid()
  )
  on conflict (period_key, district)
  do update set
    engine_version = excluded.engine_version,
    data_fingerprint = excluded.data_fingerprint,
    context_fingerprint = excluded.context_fingerprint,
    completed_count = excluded.completed_count,
    total_count = excluded.total_count,
    completed_activity_ids = excluded.completed_activity_ids,
    rows_data = excluded.rows_data,
    updated_at = now(),
    updated_by = auth.uid()
  returning * into saved;

  return jsonb_build_object(
    'completedCount', saved.completed_count,
    'totalCount', saved.total_count,
    'updatedAt', saved.updated_at
  );
end
$$;

create or replace function public.clear_scheduling_planning_checkpoint(
  p_period_key text,
  p_district text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  scope_period text := nullif(btrim(coalesce(p_period_key, '')), '');
  scope_district text := btrim(coalesce(p_district, ''));
begin
  if not public.app_has_permission('view_operations_scheduling') then
    raise exception 'scheduling_permission_denied' using errcode='42501';
  end if;
  if scope_period is null then raise exception 'planning_period_required'; end if;

  delete from public.scheduling_planning_checkpoints
  where period_key = scope_period and district = scope_district;
  return true;
end
$$;

revoke all on function public.get_scheduling_planning_checkpoint(text,text,text,text,text) from public;
grant execute on function public.get_scheduling_planning_checkpoint(text,text,text,text,text) to authenticated;
revoke all on function public.save_scheduling_planning_checkpoint(text,text,text,text,text,integer,integer,jsonb,jsonb) from public;
grant execute on function public.save_scheduling_planning_checkpoint(text,text,text,text,text,integer,integer,jsonb,jsonb) to authenticated;
revoke all on function public.clear_scheduling_planning_checkpoint(text,text) from public;
grant execute on function public.clear_scheduling_planning_checkpoint(text,text) to authenticated;
