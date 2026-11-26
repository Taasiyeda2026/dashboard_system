-- Serialize with the national worker before retiring open queue entries.
select pg_advisory_xact_lock(hashtext('scheduling_planning_run'), hashtext('year|'));

update public.scheduling_agent_worker_settings
set enabled = false, autonomous_enabled = false, auto_enqueue_enabled = false
where singleton;

alter table public.scheduling_agent_worker_settings
  add constraint scheduling_agent_manual_only
  check (not enabled and not autonomous_enabled and not auto_enqueue_enabled);

update public.scheduling_agent_team_optimization_jobs
set status = 'failed', failure_code = 'scheduling_manual_only',
    finished_at = clock_timestamp(), dispatch_token = null, dispatch_expires_at = null
where status in ('queued', 'running');

do $$
declare supervisor_job bigint;
begin
  select jobid into supervisor_job from cron.job where jobname = 'scheduling-agent-supervisor';
  if supervisor_job is not null then
    perform cron.alter_job(supervisor_job, active := false);
  end if;
end
$$;

-- Older browser bundles and gateway deployments may still offer these actions.
-- Keep their read APIs and all manual assignment/approval functions available.
revoke execute on function public.scheduling_agent_team_request_optimization(text),
  public.scheduling_agent_team_claim_optimization(),
  public.scheduling_agent_team_finish_optimization(uuid,boolean,text),
  public.scheduling_agent_team_confirm_planning_option(text,integer,bigint,bigint,boolean),
  public.acquire_scheduling_planning_run_lease(text,text,uuid,integer),
  public.heartbeat_scheduling_planning_run_lease(text,text,uuid,integer),
  public.save_scheduling_planning_snapshot(text,text,text,text,text,jsonb,bigint,uuid,bigint),
  public.save_scheduling_planning_incremental_snapshot(text,text,text,text,text,jsonb,jsonb,bigint,uuid,bigint),
  public.save_scheduling_planning_checkpoint(text,text,text,text,text,integer,integer,jsonb,jsonb,uuid,bigint),
  public.commit_scheduling_planning_checkpoint(text,text,text,text,text,bigint,uuid,bigint),
  public.set_scheduling_planning_lock(text,text,text,jsonb,bigint)
from public, anon, authenticated, service_role;

revoke execute on function public.get_scheduling_dashboard_candidates(text)
from public, anon, authenticated, service_role;

-- Preserve the team snapshot's operational data and suppress stored proposals.
do $$
declare
  definition text := pg_get_functiondef('public.scheduling_agent_team_read_snapshot()'::regprocedure);
  anchor constant text := $line$can_recommend := (preflight->>'planningCurrent')::boolean;$line$;
begin
  if length(definition) - length(replace(definition, anchor, '')) <> length(anchor) then
    raise exception 'scheduling_team_snapshot_contract_changed';
  end if;
  execute replace(definition, anchor, 'can_recommend := false;');
end
$$;

-- Reject recommendation-based writes from stale dashboards after authorization.
-- Manual operations and the independent activity revision check stay in place.
do $$
declare
  definition text := pg_get_functiondef('public.scheduling_dashboard_assignment(text,jsonb,timestamptz,bigint,bigint)'::regprocedure);
  anchor constant text := ' if p_expected_updated_at is null';
begin
  if length(definition) - length(replace(definition, anchor, '')) <> length(anchor) then
    raise exception 'scheduling_dashboard_assignment_contract_changed';
  end if;
  execute replace(definition, anchor, $gate$ if p_expected_source_revision is not null or p_expected_workspace_revision is not null then
   raise exception 'scheduling_manual_only' using errcode='42501';
 end if;
$gate$ || anchor);
end
$$;
