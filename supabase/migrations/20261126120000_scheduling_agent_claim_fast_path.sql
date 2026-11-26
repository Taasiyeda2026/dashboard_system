-- Use the same authenticated preflight and delegated identity as the durable
-- worker command. Complete an already-current request in the claim transaction.
do $migration$
declare
  recovery_definition text := pg_get_functiondef('public.scheduling_agent_recover_jobs()'::regprocedure);
  recovery_delay text := 'interval ''15 minutes''';
  definition text := pg_get_functiondef('public.scheduling_agent_worker_command(text,jsonb)'::regprocedure);
  advisory_lock text := '  perform pg_advisory_xact_lock(hashtext(''scheduling_planning_run''),hashtext(''year|''));';
  claim_anchor text := $anchor$    if not found then return jsonb_build_object('claimed',false); end if;
    update public.scheduling_agent_team_optimization_jobs$anchor$;
  claim_receipt text := $receipt$    return jsonb_build_object('claimed',true,'jobId',j.id,'runId',v_run,'mode',j.mode);$receipt$;
  claim_fast_path text := $claim$    if not found then return jsonb_build_object('claimed',false); end if;
    if j.mode='incremental' then
      v_facts:=public.get_scheduling_planning_preflight('year','');
      if v_facts->>'schemaVersion'='1'
        and v_facts->>'dirtyCount'='0'
        and v_facts->'workspace'->>'engineVersion'=v_engine
        and v_facts->>'sourceRevision'=v_facts->'workspace'->>'validatedSourceRevision'
        and v_facts->'workspace'->>'revision' is not null
        and v_facts->>'activeLease' is null
      then
        v_result:=jsonb_build_object('jobId',j.id,'runId',v_run,'status','completed',
          'noOp',true,'rowCount',0,'engineVersion',v_engine,
          'sourceRevision',v_facts->>'sourceRevision',
          'workspaceRevision',v_facts->'workspace'->>'revision',
          'revision',v_facts->'workspace'->'revision');
        update public.scheduling_agent_team_optimization_jobs
          set status='completed',worker_run_id=v_run,finished_at=clock_timestamp(),
            result_receipt=v_result,failure_code=null,dispatch_token=null,dispatch_expires_at=null
          where id=j.id;
        insert into public.scheduling_agent_worker_audit(
          job_id,run_id,event_type,source_revision,workspace_revision
        ) values(j.id,v_run,'already_current',(v_result->>'sourceRevision')::bigint,
          (v_result->>'revision')::bigint);
        return v_result;
      end if;
    end if;
    v_result:=public.acquire_scheduling_planning_run_lease('year','',v_run,120);
    if v_result->>'acquired' is distinct from 'true' then
      return jsonb_build_object('claimed',false);
    end if;
    insert into public.scheduling_agent_worker_audit(job_id,run_id,event_type)
      values(j.id,v_run,'lease_acquired');
    update public.scheduling_agent_team_optimization_jobs$claim$;
begin
  if array_length(string_to_array(definition,advisory_lock),1) is distinct from 2
    or array_length(string_to_array(definition,claim_anchor),1) is distinct from 2
    or array_length(string_to_array(definition,claim_receipt),1) is distinct from 2
    or array_length(string_to_array(recovery_definition,recovery_delay),1) is distinct from 2
  then raise exception 'scheduling_agent_worker_claim_shape_changed'; end if;
  definition:=replace(definition,advisory_lock,$lock$  if p_action='claim' then
    if not pg_try_advisory_xact_lock(hashtext('scheduling_planning_run'),hashtext('year|')) then
      return jsonb_build_object('claimed',false);
    end if;
  elsif p_action<>'probe' then
    perform pg_advisory_xact_lock(hashtext('scheduling_planning_run'),hashtext('year|'));
  end if;$lock$);
  definition:=replace(definition,claim_anchor,claim_fast_path);
  execute replace(definition,claim_receipt,$receipt$    return jsonb_build_object('claimed',true,'jobId',j.id,'runId',v_run,'mode',j.mode,'leaseAcquired',true);$receipt$);
  -- Active leases still defer recovery. The 120-second grace also covers an
  -- interrupted old worker that claimed before this migration and lacks a lease.
  execute replace(recovery_definition,recovery_delay,'interval ''2 minutes''');
end
$migration$;

-- Interactive callers can find out the plan is current without waiting for a
-- GitHub runner to wake up. The worker rechecks queued jobs at claim time.
create or replace function public.scheduling_agent_team_request_optimization(p_mode text default 'incremental')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  j public.scheduling_agent_team_optimization_jobs;
  facts jsonb;
begin
  perform public.scheduling_agent_team_assert_member();
  if p_mode is null or p_mode not in ('incremental','full') then
    raise exception 'invalid_optimization_mode';
  end if;
  if p_mode='full' and auth.uid() is distinct from
    (select approver_id from public.scheduling_agent_control where singleton)
  then raise exception 'full_optimization_requires_admin' using errcode='42501'; end if;

  facts:=public.get_scheduling_planning_preflight('year','');
  if facts->>'activeLease' is not null then
    return jsonb_build_object('status','blocked','accepted',false,'mode',p_mode,
      'reason','planning_run_locked','retryAt',facts->'activeLease'->>'expires_at',
      'serverTime',facts->>'serverTime');
  end if;
  if p_mode='incremental' and facts->>'schemaVersion'='1' and facts->>'dirtyCount'='0'
    and facts->'workspace'->>'engineVersion'='planning-v38-20261015-transition-30-45'
    and facts->>'sourceRevision'=facts->'workspace'->>'validatedSourceRevision'
    and facts->'workspace'->>'revision' is not null
  then
    return jsonb_build_object('status','completed','noOp',true,'accepted',true,'mode',p_mode,
      'sourceRevision',facts->>'sourceRevision','workspaceRevision',facts->'workspace'->>'revision');
  end if;

  perform pg_advisory_xact_lock(hashtext('scheduling_planning_run'),hashtext('year|'));
  select * into j from public.scheduling_agent_team_optimization_jobs
    where status in ('queued','running') and mode=p_mode order by created_at,id limit 1;
  if not found then
    insert into public.scheduling_agent_team_optimization_jobs(created_by,mode)
    values(auth.uid(),p_mode) returning * into j;
  end if;
  return jsonb_build_object('jobId',j.id,'status',j.status,'mode',j.mode,
    'accepted',true,'execution','autonomous_github_agent_worker');
end $$;
