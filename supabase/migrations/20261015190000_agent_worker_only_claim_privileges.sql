-- After the approved server-agent cutover, the dashboard/browser may read
-- scheduling jobs, but it must never claim or finish queued optimization jobs.
-- The GitHub OIDC worker claims through service-role gated
-- scheduling_agent_worker_command; this revoke does not affect it.
revoke execute on function public.scheduling_agent_team_claim_optimization() from authenticated;
revoke execute on function public.scheduling_agent_team_finish_optimization(uuid,boolean,text) from authenticated;
