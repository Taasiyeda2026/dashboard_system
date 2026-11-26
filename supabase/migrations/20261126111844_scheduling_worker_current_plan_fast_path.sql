-- The existing service-only claim command already serializes against planning
-- leases. Complete redundant incremental jobs while holding that same lock.
-- Full requests, stale source stamps and missing workspaces follow the old path.
do $migration$
declare
  definition text;
  lock_call text := $lock$  perform pg_advisory_xact_lock(hashtext('scheduling_planning_run'),hashtext('year|'));$lock$;
  claim_lock text := $lock$  if p_action='claim' then
    if not pg_try_advisory_xact_lock(hashtext('scheduling_planning_run'),hashtext('year|')) then
      return jsonb_build_object('claimed',false,'busy',true);
    end if;
  else
    perform pg_advisory_xact_lock(hashtext('scheduling_planning_run'),hashtext('year|'));
  end if;$lock$;
  anchor text := $anchor$    if not found then return jsonb_build_object('claimed',false); end if;
    update public.scheduling_agent_team_optimization_jobs
      set status='running'$anchor$;
  fast_path text := $branch$    if j.mode='incremental' then
      v_facts:=public.get_scheduling_planning_preflight('year','');
      if v_facts->>'sourceRevision' is not null
        and v_facts->'workspace'->>'revision' is not null
        and v_facts->>'sourceRevision'=v_facts->'workspace'->>'validatedSourceRevision'
        and v_facts->'workspace'->>'engineVersion'=v_engine
        and (v_facts->>'dirtyCount')::integer=0
      then
        v_result:=jsonb_build_object('jobId',j.id,'runId',v_run,'status','completed',
          'revision',v_facts->'workspace'->'revision','sourceRevision',v_facts->>'sourceRevision',
          'engineVersion',v_engine,'rowCount',0,'noOp',true);
        update public.scheduling_agent_team_optimization_jobs
          set status='completed',worker_run_id=v_run,finished_at=clock_timestamp(),
            dispatch_token=null,dispatch_expires_at=null,failure_code=null,result_receipt=v_result
          where id=j.id;
        insert into public.scheduling_agent_worker_audit(job_id,run_id,event_type)
          values(j.id,v_run,'completed');
        return v_result;
      end if;
    end if;
$branch$;
begin
  select pg_get_functiondef('public.scheduling_agent_worker_command(text,jsonb)'::regprocedure)
    into definition;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1
    or (length(definition)-length(replace(definition,lock_call,'')))/length(lock_call)<>1 then
    raise exception 'scheduling_worker_claim_shape_changed';
  end if;
  execute replace(replace(definition,lock_call,claim_lock),anchor,replace(anchor,
    '    update public.scheduling_agent_team_optimization_jobs',
    fast_path||'    update public.scheduling_agent_team_optimization_jobs'));
end
$migration$;

-- Recover an interrupted queue attempt after its engine lease has expired.
-- The original function already checks that there is no live national lease.
do $migration$
declare
  definition text;
  old_timeout text := $old$coalesce(worker_heartbeat_at,claimed_at)<clock_timestamp()-interval '15 minutes'$old$;
begin
  select pg_get_functiondef('public.scheduling_agent_recover_jobs()'::regprocedure)
    into definition;
  if (length(definition)-length(replace(definition,old_timeout,'')))/length(old_timeout)<>1 then
    raise exception 'scheduling_worker_recovery_shape_changed';
  end if;
  execute replace(definition,old_timeout,
    $new$coalesce(worker_heartbeat_at,claimed_at)<clock_timestamp()-interval '2 minutes'$new$);
end
$migration$;

-- Endpoint keys use the same normalization as the engine. The worker supplies
-- all homes and school locations in its frozen snapshot, including blockers.
create function public.get_scheduling_worker_routes(
  p_schools text[], p_homes text[], p_valid_at timestamptz,
  p_after_origin text default null, p_after_destination text default null
)
returns jsonb
language sql stable security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(page) order by page.origin_key,page.destination_key),'[]'::jsonb)
    from (
      select r.origin_key,r.destination_key,r.distance_km,r.duration_minutes
        from public.scheduling_travel_cache r
        where r.location_suspect=false and r.expires_at>p_valid_at
          and (p_after_origin is null or (r.origin_key,r.destination_key)>(p_after_origin,p_after_destination))
          and ((r.origin_key=any(p_schools) and
                (r.destination_key=any(p_schools) or r.destination_key=any(p_homes)))
            or (r.origin_key=any(p_homes) and r.destination_key=any(p_schools)))
        order by r.origin_key,r.destination_key
        limit 1000
    ) page
$$;
revoke all on function public.get_scheduling_worker_routes(text[],text[],timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.get_scheduling_worker_routes(text[],text[],timestamptz,text,text) to service_role;

-- Reuse the same chunked, ownership-fenced checkpoint storage as the browser.
-- Worker metadata ties resume to the same durable job and frozen revisions.
do $migration$
declare
  definition text;
  actions text := $actions$'blockers','persist','finish','release'$actions$;
  anchor text := $anchor$  if p_action='persist' then
    if not exists ($anchor$;
  checkpoint_actions text := $branch$  if p_action in ('load_checkpoint','save_checkpoint') then
    v_source:=(p_payload->>'sourceRevision')::bigint;
    v_expected:=(p_payload->>'workspaceRevision')::bigint;
    if j.mode<>'full' or v_source is null or v_expected is null
      or coalesce(p_payload->>'dataFingerprint','')=''
      or coalesce(p_payload->>'contextFingerprint','')=''
    then raise exception 'worker_checkpoint_input_invalid'; end if;
    if coalesce(p_payload->>'planningDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'worker_checkpoint_date_invalid';
    end if;
    perform public.assert_scheduling_planning_run_ownership('year','',v_run,v_expected,v_source);
    -- The parent row is scoped by period/district. Use a job/date-specific
    -- fingerprint so the existing saver clears unrelated chunks atomically.
    v_mode:=(p_payload->>'dataFingerprint')||':worker:'||j.id::text||':'||(p_payload->>'planningDate');
    if p_action='load_checkpoint' then
      v_result:=public.get_scheduling_planning_checkpoint('year','',v_engine,
        v_mode,p_payload->>'contextFingerprint');
      if v_result->'rows'->0->>'workerJobId' is distinct from j.id::text
        or v_result->'rows'->0->>'workspaceRevision' is distinct from v_expected::text
        or v_result->'rows'->0->>'sourceRevision' is distinct from v_source::text
        or v_result->'rows'->0->>'planningDate' is distinct from p_payload->>'planningDate'
      then return null; end if;
      return (v_result->'rows')-0;
    end if;
    if jsonb_typeof(p_payload->'rows') is distinct from 'array' then
      raise exception 'worker_checkpoint_rows_invalid';
    end if;
    return public.save_scheduling_planning_checkpoint('year','',v_engine,
      v_mode,p_payload->>'contextFingerprint',
      0,(p_payload->>'total')::integer,'[]'::jsonb,
      jsonb_build_array(jsonb_build_object('__planningRunMeta',true,'workerJobId',j.id,
        'workspaceRevision',v_expected,'sourceRevision',v_source,'phase','running',
        'planningDate',p_payload->>'planningDate'))||(p_payload->'rows'),v_run,v_source);
  end if;

$branch$;
begin
  select pg_get_functiondef('public.scheduling_agent_worker_command(text,jsonb)'::regprocedure)
    into definition;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1
    or (length(definition)-length(replace(definition,actions,'')))/length(actions)<>1 then
    raise exception 'scheduling_worker_checkpoint_shape_changed';
  end if;
  execute replace(replace(definition,actions,
    $actions$'blockers','load_checkpoint','save_checkpoint','persist','finish','release'$actions$),
    anchor,checkpoint_actions||anchor);
end
$migration$;
