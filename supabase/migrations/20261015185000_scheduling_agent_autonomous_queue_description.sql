-- Report true execution ownership to ChatGPT, without changing auth or queue semantics.
-- Actual jobs are claimed by a signed GitHub OIDC worker, not by a browser.
create or replace function public.scheduling_agent_team_request_optimization(p_mode text default 'incremental')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.scheduling_agent_team_optimization_jobs;
begin
  perform public.scheduling_agent_team_assert_member();
  if p_mode not in ('incremental','full') then raise exception 'invalid_optimization_mode'; end if;
  if p_mode='full' and auth.uid() is distinct from
     (select approver_id from public.scheduling_agent_control where singleton)
  then raise exception 'full_optimization_requires_admin' using errcode='42501'; end if;
  select * into j from public.scheduling_agent_team_optimization_jobs
  where status in ('queued','running') and mode=p_mode order by created_at asc limit 1;
  if not found then
    insert into public.scheduling_agent_team_optimization_jobs(created_by,mode)
    values(auth.uid(),p_mode) returning * into j;
  end if;
  return jsonb_build_object('jobId',j.id,'status',j.status,
    'mode',j.mode,'accepted',true,
    'execution','autonomous_github_agent_worker');
end $$;
revoke all on function public.scheduling_agent_team_request_optimization(text) from public,anon;
grant execute on function public.scheduling_agent_team_request_optimization(text) to authenticated;
