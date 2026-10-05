-- Distributed planning run lease: one active engine run per period_key + district.

create table if not exists public.scheduling_planning_run_leases (
  period_key text not null,
  district text not null default '',
  run_id uuid not null,
  owner_id uuid not null,
  acquired_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (period_key, district)
);

create index if not exists scheduling_planning_run_leases_expires_idx
  on public.scheduling_planning_run_leases (expires_at);

alter table public.scheduling_planning_run_leases enable row level security;

revoke all on table public.scheduling_planning_run_leases from public;
grant select, insert, update, delete on table public.scheduling_planning_run_leases to service_role;

create or replace function public.acquire_scheduling_planning_run_lease(
  p_period_key text,
  p_district text default '',
  p_run_id uuid default null,
  p_ttl_seconds integer default 900
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  scope_period text := nullif(btrim(coalesce(p_period_key, '')), '');
  scope_district text := coalesce(btrim(coalesce(p_district, '')), '');
  v_run_id uuid := coalesce(p_run_id, gen_random_uuid());
  v_ttl integer := greatest(60, least(coalesce(p_ttl_seconds, 900), 3600));
  v_now timestamptz := now();
  v_expires timestamptz := v_now + make_interval(secs => v_ttl);
  existing public.scheduling_planning_run_leases;
  v_owner uuid := auth.uid();
begin
  if not public.app_has_permission('view_operations_scheduling') then
    raise exception 'scheduling_permission_denied' using errcode = '42501';
  end if;
  if scope_period is null then
    raise exception 'planning_scope_invalid';
  end if;
  if v_owner is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtext('scheduling_planning_run'),
    hashtext(scope_period || '|' || scope_district)
  );

  delete from public.scheduling_planning_run_leases
  where period_key = scope_period
    and district = scope_district
    and expires_at <= v_now;

  select * into existing
  from public.scheduling_planning_run_leases
  where period_key = scope_period and district = scope_district
  for update;

  if found then
    if existing.owner_id = v_owner then
      update public.scheduling_planning_run_leases
      set run_id = v_run_id,
          heartbeat_at = v_now,
          expires_at = v_expires,
          acquired_at = case when existing.run_id = v_run_id then existing.acquired_at else v_now end
      where period_key = scope_period and district = scope_district;
      return jsonb_build_object(
        'acquired', true,
        'renewed', existing.run_id = v_run_id,
        'replaced', existing.run_id <> v_run_id,
        'run_id', v_run_id,
        'expires_at', v_expires
      );
    end if;
    return jsonb_build_object(
      'acquired', false,
      'reason', 'planning_run_locked',
      'run_id', existing.run_id,
      'owner_id', existing.owner_id,
      'expires_at', existing.expires_at
    );
  end if;

  insert into public.scheduling_planning_run_leases(
    period_key, district, run_id, owner_id, acquired_at, heartbeat_at, expires_at
  ) values (
    scope_period, scope_district, v_run_id, v_owner, v_now, v_now, v_expires
  );

  return jsonb_build_object(
    'acquired', true,
    'renewed', false,
    'run_id', v_run_id,
    'expires_at', v_expires
  );
end;
$$;

create or replace function public.heartbeat_scheduling_planning_run_lease(
  p_period_key text,
  p_district text default '',
  p_run_id uuid default null,
  p_ttl_seconds integer default 900
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  scope_period text := nullif(btrim(coalesce(p_period_key, '')), '');
  scope_district text := coalesce(btrim(coalesce(p_district, '')), '');
  v_run_id uuid := p_run_id;
  v_ttl integer := greatest(60, least(coalesce(p_ttl_seconds, 900), 3600));
  v_now timestamptz := now();
  v_expires timestamptz := v_now + make_interval(secs => v_ttl);
  existing public.scheduling_planning_run_leases;
  v_owner uuid := auth.uid();
begin
  if not public.app_has_permission('view_operations_scheduling') then
    raise exception 'scheduling_permission_denied' using errcode = '42501';
  end if;
  if scope_period is null or v_run_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  if v_owner is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  select * into existing
  from public.scheduling_planning_run_leases
  where period_key = scope_period and district = scope_district
  for update;

  if not found or existing.expires_at <= v_now then
    delete from public.scheduling_planning_run_leases
    where period_key = scope_period and district = scope_district;
    return jsonb_build_object('ok', false, 'reason', 'lease_missing');
  end if;
  if existing.owner_id <> v_owner or existing.run_id <> v_run_id then
    return jsonb_build_object('ok', false, 'reason', 'lease_not_owned');
  end if;

  update public.scheduling_planning_run_leases
  set heartbeat_at = v_now,
      expires_at = v_expires
  where period_key = scope_period and district = scope_district;

  return jsonb_build_object('ok', true, 'expires_at', v_expires);
end;
$$;

create or replace function public.release_scheduling_planning_run_lease(
  p_period_key text,
  p_district text default '',
  p_run_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  scope_period text := nullif(btrim(coalesce(p_period_key, '')), '');
  scope_district text := coalesce(btrim(coalesce(p_district, '')), '');
  v_run_id uuid := p_run_id;
  existing public.scheduling_planning_run_leases;
  v_owner uuid := auth.uid();
begin
  if scope_period is null or v_run_id is null then
    return jsonb_build_object('released', false, 'reason', 'invalid_request');
  end if;
  if v_owner is null then
    return jsonb_build_object('released', false, 'reason', 'authentication_required');
  end if;

  select * into existing
  from public.scheduling_planning_run_leases
  where period_key = scope_period and district = scope_district
  for update;

  if not found then
    return jsonb_build_object('released', true, 'reason', 'already_free');
  end if;
  if existing.owner_id <> v_owner or existing.run_id <> v_run_id then
    return jsonb_build_object('released', false, 'reason', 'lease_not_owned');
  end if;

  delete from public.scheduling_planning_run_leases
  where period_key = scope_period and district = scope_district;

  return jsonb_build_object('released', true);
end;
$$;

revoke all on function public.acquire_scheduling_planning_run_lease(text, text, uuid, integer) from public;
grant execute on function public.acquire_scheduling_planning_run_lease(text, text, uuid, integer) to authenticated;

revoke all on function public.heartbeat_scheduling_planning_run_lease(text, text, uuid, integer) from public;
grant execute on function public.heartbeat_scheduling_planning_run_lease(text, text, uuid, integer) to authenticated;

revoke all on function public.release_scheduling_planning_run_lease(text, text, uuid) from public;
grant execute on function public.release_scheduling_planning_run_lease(text, text, uuid) to authenticated;

comment on function public.acquire_scheduling_planning_run_lease(text, text, uuid, integer) is
  'Atomically acquire or renew a distributed planning engine lease for period_key + district.';
