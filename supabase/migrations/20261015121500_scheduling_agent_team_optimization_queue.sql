-- Delegated, explicitly requested optimization jobs.
-- A job never changes an activity assignment; it invokes the already validated
-- dashboard planning engine in an authenticated dashboard session.
-- Queue is scoped to the sole current-year national workspace.
create table if not exists public.scheduling_agent_team_optimization_jobs (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null,
  mode text not null check (mode in ('incremental','full')),
  status text not null default 'queued' check (status in ('queued','running','completed','failed')),
  created_at timestamptz not null default now(),
  claimed_by uuid,
  claimed_at timestamptz,
  finished_at timestamptz,
  failure_code text
);
create index if not exists scheduling_agent_team_optimization_jobs_queue_idx
on public.scheduling_agent_team_optimization_jobs(status,created_at);
alter table public.scheduling_agent_team_optimization_jobs enable row level security;
revoke all on table public.scheduling_agent_team_optimization_jobs from public,anon,authenticated;

create or replace function public.scheduling_agent_team_request_optimization(p_mode text default 'incremental')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.scheduling_agent_team_optimization_jobs;
begin
  perform public.scheduling_agent_team_assert_member();
  if p_mode not in ('incremental','full') then raise exception 'invalid_optimization_mode'; end if;
  if p_mode='full' and auth.uid() is distinct from
     (select approver_id from public.scheduling_agent_control where singleton)
  then raise exception 'full_optimization_requires_admin' using errcode='42501'; end if;
  -- One queued job per shared national workspace. All account identities retained.
  select * into j from public.scheduling_agent_team_optimization_jobs
  where status='queued' order by created_at asc limit 1;
  if not found then
    insert into public.scheduling_agent_team_optimization_jobs(created_by,mode)
    values(auth.uid(),p_mode) returning * into j;
  end if;
  return jsonb_build_object('jobId',j.id,'status',j.status,
    'mode',j.mode,'accepted',true,
    'execution','requires_authenticated_scheduling_dashboard_session');
end $$;

create or replace function public.scheduling_agent_team_optimization_status(p_job_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare j public.scheduling_agent_team_optimization_jobs;
begin
  perform public.scheduling_agent_team_assert_member();
  select * into j from public.scheduling_agent_team_optimization_jobs where id=p_job_id;
  if not found then raise exception 'optimization_job_not_found'; end if;
  return jsonb_build_object('jobId',j.id,'status',j.status,'mode',j.mode,
    'createdAt',j.created_at,'finishedAt',j.finished_at,
    'failureCode',j.failure_code);
end $$;

-- Dashboard workboard claims only when actively open in an authenticated session.
create or replace function public.scheduling_agent_team_claim_optimization()
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.scheduling_agent_team_optimization_jobs;
begin
  perform public.scheduling_agent_team_assert_member();
  select * into j from public.scheduling_agent_team_optimization_jobs
  where status='queued' order by created_at asc
  for update skip locked limit 1;
  if not found then return jsonb_build_object('claimed',false); end if;
  update public.scheduling_agent_team_optimization_jobs
  set status='running',claimed_by=auth.uid(),claimed_at=now()
  where id=j.id returning * into j;
  return jsonb_build_object('claimed',true,'jobId',j.id,'mode',j.mode);
end $$;

create or replace function public.scheduling_agent_team_finish_optimization(
  p_job_id uuid,p_success boolean,p_failure_code text default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.scheduling_agent_team_optimization_jobs;
  facts jsonb;
  truly_valid boolean;
begin
  perform public.scheduling_agent_team_assert_member();
  select * into j from public.scheduling_agent_team_optimization_jobs where id=p_job_id for update;
  if not found or j.status<>'running' or j.claimed_by is distinct from auth.uid()
  then raise exception 'optimization_job_ownership_denied' using errcode='42501'; end if;
  facts := public.get_scheduling_planning_preflight('year','');
  truly_valid :=
    facts->>'sourceRevision' is not distinct from facts->'workspace'->>'validatedSourceRevision'
    and coalesce((facts->>'dirtyCount')::integer,0)=0
    and facts->'workspace'->>'engineVersion'='planning-v38-20261015-transition-30-45';
  update public.scheduling_agent_team_optimization_jobs
    set status=case when p_success is true and truly_valid then 'completed' else 'failed' end,
      failure_code=case when p_success is true and truly_valid then null
        else left(coalesce(nullif(p_failure_code,''),'planning_not_current'),120) end,
      finished_at=now()
  where id=j.id returning * into j;
  return jsonb_build_object('jobId',j.id,'status',j.status,'failureCode',j.failure_code);
end $$;

revoke all on function public.scheduling_agent_team_request_optimization(text) from public,anon;
revoke all on function public.scheduling_agent_team_optimization_status(uuid) from public,anon;
revoke all on function public.scheduling_agent_team_claim_optimization() from public,anon;
revoke all on function public.scheduling_agent_team_finish_optimization(uuid,boolean,text) from public,anon;
grant execute on function public.scheduling_agent_team_request_optimization(text) to authenticated;
grant execute on function public.scheduling_agent_team_optimization_status(uuid) to authenticated;
grant execute on function public.scheduling_agent_team_claim_optimization() to authenticated;
grant execute on function public.scheduling_agent_team_finish_optimization(uuid,boolean,text) to authenticated;
