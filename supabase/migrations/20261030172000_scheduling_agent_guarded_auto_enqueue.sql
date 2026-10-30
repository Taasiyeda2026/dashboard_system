-- Safe, staged source-to-queue admission for the 2027 year planning workspace.
-- NO autonomous requests are enabled by installing this migration.
-- Do not enable before a separate, successful guarded canary calculation.
alter table public.scheduling_agent_worker_settings
  add column if not exists auto_enqueue_enabled boolean not null default false;

create table if not exists public.scheduling_agent_auto_enqueue_state (
  singleton boolean primary key default true check (singleton),
  last_requested_source_revision bigint not null default -1,
  last_requested_at timestamptz,
  last_job_id uuid references public.scheduling_agent_team_optimization_jobs(id)
);
insert into public.scheduling_agent_auto_enqueue_state(singleton)
values(true) on conflict(singleton) do nothing;
alter table public.scheduling_agent_auto_enqueue_state enable row level security;
revoke all on table public.scheduling_agent_auto_enqueue_state from public, anon, authenticated;

create or replace function public.scheduling_agent_enqueue_dirty_once()
returns boolean
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  v_source_revision bigint;
  v_source_updated_at timestamptz;
  v_validated_revision bigint;
  v_last_revision bigint;
  v_last_at timestamptz;
  v_last_job_id uuid;
  v_last_job_status text;
  v_owner uuid;
  v_job_id uuid;
begin
  -- Admission is serialized with request_optimization and the worker lease.
  perform pg_advisory_xact_lock(hashtext('scheduling_planning_run'),hashtext('year|'));
  if not exists (
    select 1 from public.scheduling_agent_worker_settings
    where singleton and enabled and autonomous_enabled and auto_enqueue_enabled
  ) then return false; end if;

  select revision,updated_at into v_source_revision,v_source_updated_at
    from public.scheduling_planning_source_state where singleton;
  select validated_source_revision into v_validated_revision
    from public.scheduling_planning_workspaces
    where period_key='year' and district='' limit 1;
  if v_source_revision is null or v_source_updated_at is null
    or v_validated_revision is null
    or v_source_revision<=v_validated_revision
    or v_source_updated_at>clock_timestamp()-interval '3 minutes'
  then return false; end if;

  -- No background plan if there is nothing marked for recomputation.
  if not exists (
    select 1 from public.scheduling_planning_rows r
    join public.scheduling_planning_workspaces w on w.id=r.workspace_id
    where w.period_key='year' and w.district='' and r.needs_recalc
  ) then return false; end if;

  -- Never create a second job while the first is queued or running.
  if exists (select 1 from public.scheduling_agent_team_optimization_jobs
             where status in ('queued','running')) then return false; end if;
  if exists (select 1 from public.scheduling_planning_run_leases
             where period_key='year' and district='' and expires_at>clock_timestamp())
  then return false; end if;

  select last_requested_source_revision,last_requested_at,last_job_id
    into v_last_revision,v_last_at,v_last_job_id
    from public.scheduling_agent_auto_enqueue_state where singleton for update;
  if not found or v_last_revision>=v_source_revision
    or (v_last_at is not null and v_last_at>clock_timestamp()-interval '5 minutes')
  then return false; end if;

  if v_last_job_id is not null then
    select status into v_last_job_status
      from public.scheduling_agent_team_optimization_jobs where id=v_last_job_id;
    -- A failed automatic plan needs explicit diagnosis, not a loop of retries.
    if v_last_job_status is distinct from 'completed' then return false; end if;
  end if;

  select c.approver_id into v_owner from public.scheduling_agent_control c
    join public.users u on u.auth_user_id=c.approver_id
    where c.singleton and u.is_active is true and u.role='admin';
  if v_owner is null then return false; end if;

  -- Mark the source version BEFORE inserting: the queue's immediate wakeup
  -- trigger re-enters the supervisor and must not enqueue a second job.
  update public.scheduling_agent_auto_enqueue_state
    set last_requested_source_revision=v_source_revision,last_requested_at=clock_timestamp()
    where singleton;

  insert into public.scheduling_agent_team_optimization_jobs(created_by,mode)
    values (v_owner,'incremental') returning id into v_job_id;
  update public.scheduling_agent_auto_enqueue_state set last_job_id=v_job_id where singleton;
  insert into public.scheduling_agent_worker_audit(job_id,event_type)
    values(v_job_id,'automatic_source_update_requested');
  return true;
end
$function$;

revoke all on function public.scheduling_agent_enqueue_dirty_once()
  from public,anon,authenticated,service_role;

-- Preserve the one-minute supervisor and all existing recovery/alert logic.
-- New queue creation is explicitly OFF until auto_enqueue_enabled is set true.
create or replace function public.scheduling_agent_wakeup_tick()
returns void language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare wake_secret text;
begin
  perform pg_advisory_xact_lock(hashtext('scheduling_planning_run'),hashtext('year|'));
  if not exists(select 1 from public.scheduling_agent_worker_settings
    where singleton and enabled and autonomous_enabled) then return; end if;
  perform public.scheduling_agent_collect_alerts();
  perform public.scheduling_agent_recover_jobs();
  perform public.scheduling_agent_collect_alerts();
  -- The new queue row's existing INSERT trigger handles its single wakeup.
  if public.scheduling_agent_enqueue_dirty_once() then return; end if;
  if not exists(select 1 from public.scheduling_agent_team_optimization_jobs
    where status='queued' and next_attempt_at<=clock_timestamp() and dispatch_due_at<=clock_timestamp()
      and (dispatch_expires_at is null or dispatch_expires_at<=clock_timestamp()))
    and not exists(select 1 from public.scheduling_agent_alerts
    where delivered_at is null and send_started_at is null
      and delivery_attempts<5 and delivery_due_at<=clock_timestamp())
  then return; end if;
  select decrypted_secret into wake_secret from vault.decrypted_secrets
    where name='scheduling_agent_wakeup_secret' limit 1;
  if wake_secret is null or length(wake_secret)<32 then return; end if;
  perform net.http_post(
    url:='https://szinlhjuwyiyszdpsdop.supabase.co/functions/v1/scheduling-agent-wakeup',
    headers:=jsonb_build_object('Content-Type','application/json','x-scheduling-wakeup-secret',wake_secret),
    body:='{}'::jsonb,timeout_milliseconds:=10000);
end
$function$;

revoke all on function public.scheduling_agent_wakeup_tick()
  from public,anon,authenticated,service_role;
