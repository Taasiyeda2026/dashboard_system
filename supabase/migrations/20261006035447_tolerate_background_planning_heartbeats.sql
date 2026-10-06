-- Chromium may throttle timers in a background tab to roughly one minute.
-- The planning lease already has an explicit expires_at TTL, so heartbeat age
-- must not impose a second, shorter 60-second lease that races that throttle.

create or replace function public.get_scheduling_planning_preflight(p_period_key text,p_district text default '')
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if not public.app_has_permission('view_operations_scheduling') or auth.uid() is null then
    raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
  return (with w as (
    select id,engine_version,revision,validated_source_revision
    from public.scheduling_planning_workspaces
    where period_key=btrim(p_period_key) and district=btrim(coalesce(p_district,''))
  ), l as (
    select run_id,owner_id,expires_at,heartbeat_at from public.scheduling_planning_run_leases
    where period_key=btrim(p_period_key) and district=btrim(coalesce(p_district,''))
      and expires_at>clock_timestamp()
  ), cp as (
    select completed_count,total_count,updated_at,phase,engine_version
    from public.scheduling_planning_checkpoints
    where period_key=btrim(p_period_key) and district=btrim(coalesce(p_district,''))
  ) select jsonb_build_object('schemaVersion',1,'sourceRevision',s.revision::text,
    'serverTime',clock_timestamp(),
    'dirtyCount',(select count(*) from public.scheduling_planning_rows r where r.workspace_id=(select id from w) and r.needs_recalc),
    'workspace',(select jsonb_build_object('engineVersion',engine_version,'revision',revision,
      'validatedSourceRevision',validated_source_revision::text) from w),
    'activeLease',(select jsonb_build_object('run_id',run_id,'owner_id',owner_id,
      'expires_at',expires_at,'heartbeat_at',heartbeat_at,'retry_at',expires_at) from l),
    'checkpoint',(select jsonb_build_object('completedCount',completed_count,'totalCount',total_count,
      'updatedAt',updated_at,'phase',phase,'engineVersion',engine_version) from cp))
    from public.scheduling_planning_source_state s where s.singleton);
end $$;
revoke all on function public.get_scheduling_planning_preflight(text,text) from public;
grant execute on function public.get_scheduling_planning_preflight(text,text) to authenticated;

create or replace function public.assert_scheduling_planning_run_ownership(
  p_period text,p_district text,p_run_id uuid,p_expected_revision bigint,p_source_revision bigint
) returns void language plpgsql security definer set search_path=public as $$
declare l public.scheduling_planning_run_leases; w public.scheduling_planning_workspaces; source_revision bigint;
begin
  if not public.app_has_permission('view_operations_scheduling') or auth.uid() is null then
    raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtext('scheduling_planning_run'),hashtext(btrim(p_period)||'|'||btrim(coalesce(p_district,''))));
  select * into l from public.scheduling_planning_run_leases
    where period_key=btrim(p_period) and district=btrim(coalesce(p_district,'')) for update;
  if p_run_id is null or l.run_id is distinct from p_run_id or l.owner_id is distinct from auth.uid()
    or l.expires_at <= clock_timestamp() then
    raise exception 'planning_run_ownership_lost'; end if;
  select revision into source_revision from public.scheduling_planning_source_state where singleton for share;
  if p_source_revision is null or source_revision is distinct from p_source_revision then raise exception 'planning_source_revision_conflict'; end if;
  select * into w from public.scheduling_planning_workspaces
    where period_key=btrim(p_period) and district=btrim(coalesce(p_district,'')) for update;
  if p_expected_revision is not null and coalesce(w.revision,0) <> p_expected_revision then
    raise exception 'planning_revision_conflict'; end if;
end $$;
revoke all on function public.assert_scheduling_planning_run_ownership(text,text,uuid,bigint,bigint) from public;

create or replace function public.acquire_scheduling_planning_run_lease(
  p_period_key text,
  p_district text default '',
  p_run_id uuid default null,
  p_ttl_seconds integer default 120
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  scope_period text := nullif(btrim(coalesce(p_period_key, '')), '');
  scope_district text := coalesce(btrim(coalesce(p_district, '')), '');
  v_run_id uuid := coalesce(p_run_id, gen_random_uuid());
  v_ttl integer := greatest(60, least(coalesce(p_ttl_seconds, 120), 3600));
  v_now timestamptz := clock_timestamp();
  v_expires timestamptz := v_now + make_interval(secs => v_ttl);
  existing public.scheduling_planning_run_leases;
  v_owner uuid := auth.uid();
begin
  if not public.app_has_permission('view_operations_scheduling') then
    raise exception 'scheduling_permission_denied' using errcode = '42501';
  end if;
  if scope_period is null then raise exception 'planning_scope_invalid'; end if;
  if v_owner is null then raise exception 'authentication_required' using errcode = '42501'; end if;

  perform pg_advisory_xact_lock(hashtext('scheduling_planning_run'),hashtext(scope_period || '|' || scope_district));
  v_now := clock_timestamp();
  v_expires := v_now + make_interval(secs => v_ttl);

  delete from public.scheduling_planning_run_leases
  where period_key = scope_period and district = scope_district and expires_at <= v_now;

  select * into existing from public.scheduling_planning_run_leases
  where period_key = scope_period and district = scope_district for update;

  if found then
    if existing.owner_id = v_owner then
      if existing.run_id <> v_run_id then
        return jsonb_build_object('acquired',false,'reason','planning_run_locked','run_id',existing.run_id,
          'owner_id',existing.owner_id,'expires_at',existing.expires_at,'retry_at',existing.expires_at);
      end if;
      update public.scheduling_planning_run_leases
      set heartbeat_at=v_now,expires_at=v_expires,acquired_at=existing.acquired_at
      where period_key=scope_period and district=scope_district;
      return jsonb_build_object('acquired',true,'renewed',true,'replaced',false,'run_id',v_run_id,'expires_at',v_expires);
    end if;
    return jsonb_build_object('acquired',false,'reason','planning_run_locked','run_id',existing.run_id,
      'owner_id',existing.owner_id,'expires_at',existing.expires_at,'retry_at',existing.expires_at);
  end if;

  insert into public.scheduling_planning_run_leases(period_key,district,run_id,owner_id,acquired_at,heartbeat_at,expires_at)
  values(scope_period,scope_district,v_run_id,v_owner,v_now,v_now,v_expires);
  return jsonb_build_object('acquired',true,'renewed',false,'run_id',v_run_id,'expires_at',v_expires);
end;
$$;

create or replace function public.heartbeat_scheduling_planning_run_lease(
  p_period_key text,
  p_district text default '',
  p_run_id uuid default null,
  p_ttl_seconds integer default 120
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  scope_period text := nullif(btrim(coalesce(p_period_key, '')), '');
  scope_district text := coalesce(btrim(coalesce(p_district, '')), '');
  v_run_id uuid := p_run_id;
  v_ttl integer := greatest(60, least(coalesce(p_ttl_seconds, 120), 3600));
  v_now timestamptz := clock_timestamp();
  v_expires timestamptz := v_now + make_interval(secs => v_ttl);
  existing public.scheduling_planning_run_leases;
  v_owner uuid := auth.uid();
begin
  if not public.app_has_permission('view_operations_scheduling') then
    raise exception 'scheduling_permission_denied' using errcode = '42501';
  end if;
  if scope_period is null or v_run_id is null then return jsonb_build_object('ok',false,'reason','invalid_request'); end if;
  if v_owner is null then raise exception 'authentication_required' using errcode = '42501'; end if;

  perform pg_advisory_xact_lock(hashtext('scheduling_planning_run'),hashtext(scope_period || '|' || scope_district));
  v_now := clock_timestamp();
  v_expires := v_now + make_interval(secs => v_ttl);

  select * into existing from public.scheduling_planning_run_leases
  where period_key=scope_period and district=scope_district for update;

  if not found or existing.expires_at <= v_now then
    delete from public.scheduling_planning_run_leases where period_key=scope_period and district=scope_district;
    return jsonb_build_object('ok',false,'reason','lease_missing');
  end if;
  if existing.owner_id <> v_owner or existing.run_id <> v_run_id then
    return jsonb_build_object('ok',false,'reason','lease_not_owned');
  end if;
  update public.scheduling_planning_run_leases set heartbeat_at=v_now,expires_at=v_expires
  where period_key=scope_period and district=scope_district;
  return jsonb_build_object('ok',true,'expires_at',v_expires);
end;
$$;
