-- Created with Supabase CLI; sequenced after the existing 20261015 evening migrations.
-- Staged infrastructure only. Installing this migration PAUSES automatic compute.
-- Activation, Vault secrets and real computation require separate owner approval.
alter table public.scheduling_agent_worker_settings
  add column autonomous_enabled boolean not null default false;
alter table public.scheduling_agent_team_optimization_jobs
  add column attempt_count integer not null default 0 check(attempt_count>=0),
  add column next_attempt_at timestamptz not null default clock_timestamp(),
  add column dispatch_attempts integer not null default 0 check(dispatch_attempts>=0),
  add column dispatch_due_at timestamptz not null default clock_timestamp(),
  add column dispatch_token uuid,
  add column dispatch_expires_at timestamptz,
  add column dispatch_failure_code text,
  add column result_receipt jsonb;
create index scheduling_agent_jobs_due_idx
  on public.scheduling_agent_team_optimization_jobs(next_attempt_at,dispatch_due_at)
  where status='queued';

-- All lifecycle operations take the same lock FIRST, matching the existing lease.
-- Serializing admission avoids a SELECT/INSERT race without modifying existing jobs.
create or replace function public.scheduling_agent_team_request_optimization(p_mode text default 'incremental')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.scheduling_agent_team_optimization_jobs;
begin
  perform public.scheduling_agent_team_assert_member();
  if p_mode is null or p_mode not in ('incremental','full') then raise exception 'invalid_optimization_mode'; end if;
  if p_mode='full' and auth.uid() is distinct from
    (select approver_id from public.scheduling_agent_control where singleton)
  then raise exception 'full_optimization_requires_admin' using errcode='42501'; end if;
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

-- Only infrastructure-owned running jobs are recoverable; never old browser claims.
create function public.scheduling_agent_recover_jobs() returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.scheduling_agent_team_optimization_jobs;
begin
  perform pg_advisory_xact_lock(hashtext('scheduling_planning_run'),hashtext('year|'));
  if not exists(select 1 from public.scheduling_agent_worker_settings
    where singleton and enabled and autonomous_enabled) then return; end if;
  if exists(select 1 from public.scheduling_planning_run_leases
    where period_key='year' and district='' and expires_at>clock_timestamp()) then return; end if;
  for j in select * from public.scheduling_agent_team_optimization_jobs
    where status='running' and claimed_by is null
      and coalesce(worker_heartbeat_at,claimed_at)<clock_timestamp()-interval '15 minutes'
    for update
  loop
    update public.scheduling_agent_team_optimization_jobs
      set status=case when attempt_count<3 then 'queued' else 'failed' end,
        failure_code=case when attempt_count<3 then 'worker_interrupted' else 'worker_attempts_exhausted' end,
        finished_at=case when attempt_count>=3 then clock_timestamp() else null end,
        worker_run_id=null,worker_heartbeat_at=null,claimed_at=null,
        next_attempt_at=clock_timestamp()+interval '1 minute',
        dispatch_due_at=clock_timestamp()+interval '1 minute',
        dispatch_token=null,dispatch_expires_at=null,dispatch_attempts=0
      where id=j.id and result_receipt is null;
    insert into public.scheduling_agent_worker_audit(job_id,run_id,event_type)
      values(j.id,j.worker_run_id,'interrupted_attempt_recovered');
  end loop;
end $$;

-- Machine-only dispatch reservations; concurrent Cron/trigger deliveries coalesce.
create function public.scheduling_agent_wakeup_command(p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.scheduling_agent_team_optimization_jobs; token uuid;
begin
  if coalesce(auth.role(),'')<>'service_role' then
    raise exception 'worker_machine_identity_required' using errcode='42501'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'wakeup_invalid_input'; end if;
  perform pg_advisory_xact_lock(hashtext('scheduling_planning_run'),hashtext('year|'));
  if not exists(select 1 from public.scheduling_agent_worker_settings
    where singleton and enabled and autonomous_enabled) then
    return jsonb_build_object('reserved',false,'disabled',true); end if;
  if p_action='reserve' then
    perform public.scheduling_agent_recover_jobs();
    if exists(select 1 from public.scheduling_agent_team_optimization_jobs where status='running')
      or exists(select 1 from public.scheduling_planning_run_leases
        where period_key='year' and district='' and expires_at>clock_timestamp())
      or exists(select 1 from public.scheduling_agent_team_optimization_jobs
        where dispatch_expires_at>clock_timestamp()) then return jsonb_build_object('reserved',false); end if;
    -- An accepted dispatch with no claim is retried, but never indefinitely.
    update public.scheduling_agent_team_optimization_jobs set status='failed',
      failure_code='worker_dispatch_attempts_exhausted',finished_at=clock_timestamp()
      where status='queued' and dispatch_attempts>=6 and dispatch_due_at<=clock_timestamp();
    select * into j from public.scheduling_agent_team_optimization_jobs
      where status='queued' and dispatch_attempts<6 and attempt_count<3
        and next_attempt_at<=clock_timestamp() and dispatch_due_at<=clock_timestamp()
        and (mode='incremental' or created_by=(select approver_id from public.scheduling_agent_control where singleton))
      order by created_at,id for update skip locked limit 1;
    if not found then return jsonb_build_object('reserved',false); end if;
    token:=gen_random_uuid();
    update public.scheduling_agent_team_optimization_jobs
      set dispatch_token=token,dispatch_expires_at=clock_timestamp()+interval '90 seconds',
        dispatch_attempts=dispatch_attempts+1,
        dispatch_due_at=clock_timestamp()+make_interval(secs=>least(600,30*(2^dispatch_attempts)::integer))
      where id=j.id;
    insert into public.scheduling_agent_worker_audit(job_id,event_type) values(j.id,'dispatch_reserved');
    return jsonb_build_object('reserved',true,'jobId',j.id,'dispatchToken',token);
  elsif p_action='ack' then
    if nullif(p_payload->>'dispatchToken','') is null or jsonb_typeof(p_payload->'accepted') is distinct from 'boolean'
      then raise exception 'wakeup_invalid_input'; end if;
    select * into j from public.scheduling_agent_team_optimization_jobs
      where id=(p_payload->>'jobId')::uuid for update;
    if found and j.status in ('running','completed') then return jsonb_build_object('acknowledged',true); end if;
    if not found or j.dispatch_token is distinct from (p_payload->>'dispatchToken')::uuid
      or j.dispatch_expires_at<=clock_timestamp() then raise exception 'dispatch_reservation_lost'; end if;
    update public.scheduling_agent_team_optimization_jobs set dispatch_token=null,dispatch_expires_at=null,
      dispatch_due_at=case when p_payload->>'accepted'='true' then clock_timestamp()+interval '2 minutes' else dispatch_due_at end,
      dispatch_failure_code=case when p_payload->>'accepted'='true' then null
        else left(regexp_replace(coalesce(p_payload->>'failureCode','dispatch_failed'),'[^a-z0-9_]','','g'),80) end
      where id=j.id;
    insert into public.scheduling_agent_worker_audit(job_id,event_type)
      values(j.id,case when p_payload->>'accepted'='true' then 'dispatch_accepted' else 'dispatch_failed' end);
    return jsonb_build_object('acknowledged',true);
  end if;
  raise exception 'wakeup_action_not_allowed';
end $$;

-- Durable manager alerts use the EXISTING selected-recipient popup infrastructure.
-- No schedule rows, approvals or source revision stamps are changed by supervision.
create table public.scheduling_agent_alerts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.scheduling_agent_team_optimization_jobs(id),
  kind text not null check(kind in ('failed','queue_overdue','worker_unresponsive','dispatch_failure')),
  message_id uuid not null references public.staff_messages(id),
  created_at timestamptz not null default clock_timestamp(),
  delivered_at timestamptz, send_started_at timestamptz, delivery_unknown boolean not null default false, delivery_attempts integer not null default 0,
  delivery_due_at timestamptz not null default clock_timestamp(),
  delivery_token uuid, delivery_expires_at timestamptz,
  unique(job_id,kind)
);
alter table public.scheduling_agent_alerts enable row level security;
revoke all on public.scheduling_agent_alerts from public,anon,authenticated;

create function public.scheduling_agent_collect_alerts() returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.scheduling_agent_team_optimization_jobs; owner_id uuid; v_kind text; msg uuid;
begin
  perform pg_advisory_xact_lock(hashtext('scheduling_planning_run'),hashtext('year|'));
  if not exists(select 1 from public.scheduling_agent_worker_settings
    where singleton and enabled and autonomous_enabled) then return; end if;
  select c.approver_id into owner_id from public.scheduling_agent_control c
    join public.users u on u.auth_user_id=c.approver_id and u.is_active and u.role='admin'
    where c.singleton;
  if owner_id is null then return; end if;
  -- A crashed/lost send is never replayed: Graph has no idempotent sendMail API.
  update public.scheduling_agent_alerts set delivery_unknown=true
    where send_started_at is not null and delivered_at is null and not delivery_unknown
      and delivery_expires_at<=clock_timestamp();
  update public.staff_messages m set body=left(m.body,2500)||' מצב מסירת הדוא״ל אינו ידוע; נדרשת בדיקה בתיבת השולח. לא יבוצע משלוח חוזר אוטומטי.'
    where m.id in (select a.message_id from public.scheduling_agent_alerts a where a.delivery_unknown)
      and m.body not like '%מצב מסירת הדוא״ל אינו ידוע%';
  for j in select * from public.scheduling_agent_team_optimization_jobs
    where status='failed' or (status in ('queued','running')
      and coalesce(worker_heartbeat_at,claimed_at,created_at)<clock_timestamp()-interval '15 minutes')
  loop
    v_kind:=case when j.failure_code='worker_dispatch_attempts_exhausted' then 'dispatch_failure' when j.status='failed' then 'failed'
      when j.status='running' then 'worker_unresponsive'
      when j.dispatch_attempts>=3 and j.dispatch_failure_code is not null then 'dispatch_failure'
      else 'queue_overdue' end;
    if exists(select 1 from public.scheduling_agent_alerts a where a.job_id=j.id and a.kind=v_kind) then continue; end if;
    insert into public.staff_messages(title,body,schedule_type,scheduled_date,scheduled_time,
      importance,audience,recipient_user_ids,active_from,created_by)
      values('סוכן השיבוצים: נדרשת בדיקת מנהל',
        format('משימת שיבוץ %s: %s. קוד: %s. זמן זיהוי UTC: %s. פעולה נדרשת: בדיקת תור המשימות, לוגי הסוכן והרשאות GitHub Actions. אין להפעיל משימה נוספת ידנית.',
          j.id,case v_kind when 'failed' then 'נכשלה סופית' when 'worker_unresponsive' then 'מנוע החישוב אינו מגיב' when 'dispatch_failure' then 'תקלה מתמשכת בהפעלת GitHub Actions' else 'ממתינה בתור מעל 15 דקות' end,
          coalesce(j.failure_code,j.dispatch_failure_code,'worker_progress_overdue'),clock_timestamp()),
        'once',(clock_timestamp() at time zone 'Asia/Jerusalem')::date,'00:00',
        'critical','selected_users',array[owner_id],(clock_timestamp() at time zone 'Asia/Jerusalem')::date,owner_id)
      returning id into msg;
    insert into public.scheduling_agent_alerts(job_id,kind,message_id) values(j.id,v_kind,msg);
  end loop;
end $$;
revoke all on function public.scheduling_agent_collect_alerts() from public,anon,authenticated,service_role;

-- Optional external delivery is an outbox, independent of browser availability.
create function public.scheduling_agent_alert_command(p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.scheduling_agent_alerts; token uuid; recipient text;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'worker_machine_identity_required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtext('scheduling_planning_run'),hashtext('year|'));
  select u.email into recipient from public.scheduling_agent_control c
    join public.users u on u.auth_user_id=c.approver_id and u.is_active and u.role='admin' where c.singleton;
  if p_action='verify' then return jsonb_build_object('recipientReady',coalesce(recipient ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$',false)); end if;
  if not exists(select 1 from public.scheduling_agent_worker_settings where singleton and enabled and autonomous_enabled)
    then return jsonb_build_object('reserved',false); end if;
  if p_action='reserve' then
    if recipient is null then return jsonb_build_object('reserved',false); end if;
    perform public.scheduling_agent_collect_alerts();
    select * into a from public.scheduling_agent_alerts
      where delivered_at is null and send_started_at is null and delivery_attempts<5 and delivery_due_at<=clock_timestamp()
      and (delivery_expires_at is null or delivery_expires_at<=clock_timestamp())
      order by created_at,id for update skip locked limit 1;
    if not found then return jsonb_build_object('reserved',false); end if;
    token:=gen_random_uuid();
    update public.scheduling_agent_alerts set delivery_token=token,
      delivery_expires_at=clock_timestamp()+interval '90 seconds',delivery_attempts=delivery_attempts+1,
      delivery_due_at=clock_timestamp()+make_interval(secs=>least(3600,60*(2^delivery_attempts)::integer))
      where id=a.id;
    return jsonb_build_object('reserved',true,'alertId',a.id,'deliveryToken',token,'jobId',a.job_id,'kind',a.kind,'recipient',recipient,'eventAt',a.created_at);
  elsif p_action='begin_send' then
    update public.scheduling_agent_alerts set send_started_at=clock_timestamp()
      where id=(p_payload->>'alertId')::uuid and delivery_token=(p_payload->>'deliveryToken')::uuid
        and delivery_expires_at>clock_timestamp() and send_started_at is null and delivered_at is null;
    if not found then raise exception 'alert_reservation_lost'; end if;
    return jsonb_build_object('started',true);
  elsif p_action='ack' then
    update public.scheduling_agent_alerts set
      delivered_at=case when p_payload->>'accepted'='true' then clock_timestamp() else null end,
      delivery_unknown=coalesce(p_payload->>'uncertain'='true',false),
      send_started_at=case when p_payload->>'retrySafe'='true' then null else send_started_at end,
      delivery_token=null,delivery_expires_at=null
      where id=(p_payload->>'alertId')::uuid and delivery_token=(p_payload->>'deliveryToken')::uuid
        and delivery_expires_at>clock_timestamp() and delivered_at is null;
    if not found then raise exception 'alert_reservation_lost'; end if;
    return jsonb_build_object('acknowledged',true);
  end if;
  raise exception 'alert_action_not_allowed';
end $$;
revoke all on function public.scheduling_agent_alert_command(text,jsonb) from public,anon,authenticated;
grant execute on function public.scheduling_agent_alert_command(text,jsonb) to service_role;

-- pg_net delivery is best effort; durable due-state above is the source of truth.
create function public.scheduling_agent_wakeup_tick() returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare wake_secret text;
begin
  perform pg_advisory_xact_lock(hashtext('scheduling_planning_run'),hashtext('year|'));
  if not exists(select 1 from public.scheduling_agent_worker_settings
    where singleton and enabled and autonomous_enabled) then return; end if;
  perform public.scheduling_agent_collect_alerts();
  perform public.scheduling_agent_recover_jobs();
  perform public.scheduling_agent_collect_alerts();
  if not exists(select 1 from public.scheduling_agent_team_optimization_jobs
    where status='queued' and next_attempt_at<=clock_timestamp() and dispatch_due_at<=clock_timestamp()
      and (dispatch_expires_at is null or dispatch_expires_at<=clock_timestamp()))
    and not exists(select 1 from public.scheduling_agent_alerts where delivered_at is null and send_started_at is null
      and delivery_attempts<5 and delivery_due_at<=clock_timestamp()) then return; end if;
  select decrypted_secret into wake_secret from vault.decrypted_secrets
    where name='scheduling_agent_wakeup_secret' limit 1;
  if wake_secret is null or length(wake_secret)<32 then return; end if;
  perform net.http_post(
    url:='https://szinlhjuwyiyszdpsdop.supabase.co/functions/v1/scheduling-agent-wakeup',
    headers:=jsonb_build_object('Content-Type','application/json','x-scheduling-wakeup-secret',wake_secret),
    body:='{}'::jsonb,timeout_milliseconds:=10000);
end $$;

create function public.scheduling_agent_queue_wakeup_trigger() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.status='queued' then
    begin perform public.scheduling_agent_wakeup_tick();
    exception when others then
      -- Request remains durable even if pg_net/Vault is temporarily unavailable.
      insert into public.scheduling_agent_worker_audit(job_id,event_type) values(new.id,'wakeup_delivery_deferred');
    end;
  end if;
  return new;
end $$;
create trigger scheduling_agent_queue_wakeup after insert
  on public.scheduling_agent_team_optimization_jobs for each row
  execute function public.scheduling_agent_queue_wakeup_trigger();

revoke all on function public.scheduling_agent_recover_jobs() from public,anon,authenticated,service_role;
revoke all on function public.scheduling_agent_wakeup_tick() from public,anon,authenticated,service_role;
revoke all on function public.scheduling_agent_queue_wakeup_trigger() from public,anon,authenticated,service_role;
revoke all on function public.scheduling_agent_wakeup_command(text,jsonb) from public,anon,authenticated;
grant execute on function public.scheduling_agent_wakeup_command(text,jsonb) to service_role;
-- Registered but INACTIVE: creating a schedule must not activate production.
do $$ declare job bigint; begin
  job:=cron.schedule('scheduling-agent-supervisor','* * * * *','select public.scheduling_agent_wakeup_tick()');
  perform cron.alter_job(job,active:=false);
end $$;

-- v38 validator and protected-row gates below are retained unchanged.
create or replace function public.scheduling_agent_worker_command(
  p_action text, p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = public,pg_temp as $$
declare
  caller_role text := coalesce(auth.role(),'');
  worker_owner uuid;
  j public.scheduling_agent_team_optimization_jobs;
  l public.scheduling_planning_run_leases;
  v_job uuid;
  v_run uuid;
  v_ttl integer := 120;
  v_mode text;
  v_rows jsonb;
  v_expected bigint;
  v_source bigint;
  v_result jsonb;
  v_facts jsonb;
  v_success boolean;
  v_engine text := 'planning-v38-20261015-transition-30-45';
  v_worker_enabled boolean := false;
begin
  -- Check BEFORE setting a scoped delegated identity. Anonymous/employee
  -- access is never permitted to a service-only control command.
  if caller_role <> 'service_role' then
    raise exception 'worker_machine_identity_required' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('scheduling_planning_run'),hashtext('year|'));
  if p_action not in ('probe','claim','lease','heartbeat','preflight','locations','blockers','persist','finish','release') then
    raise exception 'worker_action_not_allowed' using errcode='42501';
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'worker_invalid_input';
  end if;
  select approver_id into worker_owner from public.scheduling_agent_control where singleton;
  if worker_owner is null or not exists (
    select 1 from public.users where auth_user_id=worker_owner and is_active=true and role='admin'
  ) then
    raise exception 'worker_owner_identity_unavailable' using errcode='42501';
  end if;

  -- We re-use the existing owner-authorized engine lease and v38 SQL validator.
  -- This is an explicitly logged *machine delegation*, not an employee approval.
  perform set_config('request.jwt.claim.sub',worker_owner::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',worker_owner::text,'role','authenticated'
  )::text,true);

  select enabled and autonomous_enabled into v_worker_enabled from public.scheduling_agent_worker_settings where singleton;
  if p_action='probe' then
    v_facts:=public.get_scheduling_planning_preflight('year','');
    return jsonb_build_object('ready',true,'enabled',v_worker_enabled,'atomicCompletion',true,
      'engine',v_engine,'sourceRevision',v_facts->>'sourceRevision',
      'workspaceRevision',v_facts->'workspace'->>'revision');
  end if;
  if v_worker_enabled is distinct from true then
    if p_action='claim' then return jsonb_build_object('claimed',false,'disabled',true); end if;
    raise exception 'worker_live_cutover_not_enabled' using errcode='42501';
  end if;

  if p_action = 'locations' then
    select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) into v_result
      from public.scheduling_authority_school_locations() s;
    return v_result;
  end if;
  if p_action = 'blockers' then
    return coalesce(public.get_scheduling_planning_external_blockers(),'[]'::jsonb);
  end if;

  if p_action = 'claim' then
    perform public.scheduling_agent_recover_jobs();
    if exists(select 1 from public.scheduling_agent_team_optimization_jobs where status='running')
      or exists(select 1 from public.scheduling_planning_run_leases
        where period_key='year' and district='' and expires_at>clock_timestamp())
    then return jsonb_build_object('claimed',false); end if;
    v_run:=coalesce((p_payload->>'runId')::uuid,gen_random_uuid());
    select * into j from public.scheduling_agent_team_optimization_jobs
      where status='queued' and attempt_count<3 and next_attempt_at<=clock_timestamp()
        and (mode='incremental' or created_by=worker_owner)
      order by created_at,id for update skip locked limit 1;
    if not found then return jsonb_build_object('claimed',false); end if;
    update public.scheduling_agent_team_optimization_jobs
      set status='running',claimed_by=null,claimed_at=clock_timestamp(),finished_at=null,
        worker_heartbeat_at=clock_timestamp(),worker_run_id=v_run,attempt_count=attempt_count+1,
        dispatch_token=null,dispatch_expires_at=null,failure_code=null
      where id=j.id returning * into j;
    insert into public.scheduling_agent_worker_audit(job_id,run_id,event_type)
      values(j.id,v_run,'claimed');
    return jsonb_build_object('claimed',true,'jobId',j.id,'runId',v_run,'mode',j.mode);
  end if;

  if coalesce(p_payload->>'jobId','') !~
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  then raise exception 'worker_invalid_job_id'; end if;
  v_job := (p_payload->>'jobId')::uuid;
  if coalesce(p_payload->>'runId','') !~
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  then raise exception 'worker_invalid_run_id'; end if;
  v_run := (p_payload->>'runId')::uuid;

  select * into j from public.scheduling_agent_team_optimization_jobs
    where id=v_job for update;
  if not found or j.claimed_by is not null or j.worker_run_id is distinct from v_run
  then raise exception 'worker_job_ownership_lost' using errcode='42501'; end if;
  -- Receipt replay is read-only and survives a lost successful HTTP response.
  if j.status='completed' and j.result_receipt is not null and p_action in ('persist','finish') then
    return j.result_receipt;
  end if;
  if j.status<>'running' and not (p_action='release' and j.status in ('failed','completed','queued'))
  then raise exception 'worker_job_ownership_lost' using errcode='42501'; end if;

  if p_action='lease' then
    v_ttl:=greatest(60,least(coalesce((p_payload->>'ttlSeconds')::integer,120),300));
    v_result:=public.acquire_scheduling_planning_run_lease('year','',v_run,v_ttl);
    if v_result->>'acquired'='true' then
      insert into public.scheduling_agent_worker_audit(job_id,run_id,event_type)
      values(v_job,v_run,'lease_acquired');
    end if;
    return v_result;
  end if;
  if j.worker_run_id is null or j.worker_run_id<>v_run then
    raise exception 'worker_run_unclaimed' using errcode='42501';
  end if;

  if p_action='heartbeat' then
    v_ttl:=greatest(60,least(coalesce((p_payload->>'ttlSeconds')::integer,120),300));
    v_result:=public.heartbeat_scheduling_planning_run_lease('year','',v_run,v_ttl);
    if v_result->>'ok'='true' then
      update public.scheduling_agent_team_optimization_jobs
      set worker_heartbeat_at=clock_timestamp() where id=v_job;
    end if;
    return v_result;
  end if;
  if p_action='preflight' then
    return public.get_scheduling_planning_preflight('year','');
  end if;
  if p_action='persist' then
    if not exists (
      select 1 from public.scheduling_planning_run_leases
      where period_key='year' and district='' and run_id=v_run
      and owner_id=worker_owner and expires_at>clock_timestamp()
    ) then raise exception 'worker_run_lease_invalid' using errcode='42501'; end if;
    v_rows:=p_payload->'rows';
    if jsonb_typeof(v_rows) is distinct from 'array' or
      jsonb_array_length(v_rows)>700
    then raise exception 'worker_planning_rows_invalid'; end if;
    if jsonb_array_length(v_rows)=0 or p_payload->>'validationOnly'='true' then
      v_facts:=public.get_scheduling_planning_preflight('year','');
      if p_payload->>'validationOnly' is distinct from 'true' or j.mode<>'incremental'
        or jsonb_array_length(v_rows)<>0
        or (v_facts->>'dirtyCount')::integer is distinct from 0
        or v_facts->'workspace'->>'engineVersion' is distinct from v_engine
      then raise exception 'worker_validation_only_not_allowed'; end if;
    end if;
    if coalesce(p_payload->>'engineVersion','')<>v_engine
    then raise exception 'worker_engine_version_untrusted'; end if;
    if p_payload->>'mode' is distinct from j.mode
    then raise exception 'worker_mode_changed'; end if;
    v_source:=(p_payload->>'sourceRevision')::bigint;
    v_expected:=(p_payload->>'workspaceRevision')::bigint;
    if not exists (
      select 1 from public.scheduling_planning_source_state
      where singleton and revision=v_source
    ) then raise exception 'planning_source_revision_conflict'; end if;
    if not exists (
      select 1 from public.scheduling_planning_workspaces
      where period_key='year' and district='' and revision=v_expected
    ) then raise exception 'planning_revision_conflict'; end if;
    if exists (
      select 1 from jsonb_array_elements(v_rows) item
      join public.scheduling_planning_workspaces w
        on w.period_key='year' and w.district=''
      join public.scheduling_planning_rows old
        on old.workspace_id=w.id and old.activity_id=item->>'activityId'
      where old.locked_option is not null
        and old.row_data is distinct from item->'row'
    ) then raise exception 'worker_protected_row_mutation_denied' using errcode='42501'; end if;
    if exists (
      select 1 from jsonb_array_elements(v_rows) item
      where item->>'activityId' is null
        or jsonb_typeof(item->'row') is distinct from 'object'
    ) then raise exception 'worker_row_payload_invalid'; end if;

    -- Existing stored-procedure enforces snapshots, dates, 30/45 km, lease,
    -- source and workspace freshness and immutable rows before commit.
    if j.mode='full' then
      v_result:=public.save_scheduling_planning_snapshot(
        'year','',v_engine,p_payload->>'dataFingerprint',
        p_payload->>'contextFingerprint',v_rows,v_expected,v_run,v_source);
    else
      v_result:=public.save_scheduling_planning_incremental_snapshot(
        'year','',v_engine,p_payload->>'dataFingerprint',
        p_payload->>'contextFingerprint',v_rows,'[]'::jsonb,
        v_expected,v_run,v_source);
    end if;
    insert into public.scheduling_agent_worker_audit(
      job_id,run_id,event_type,source_revision,workspace_revision
    ) values(v_job,v_run,'validated_plan_persisted',v_source,(v_result->>'revision')::bigint);
    v_facts:=public.get_scheduling_planning_preflight('year','');
    if v_facts->>'sourceRevision' is distinct from v_facts->'workspace'->>'validatedSourceRevision'
      or coalesce((v_facts->>'dirtyCount')::integer,0)<>0
      or v_facts->'workspace'->>'engineVersion' is distinct from v_engine
    then raise exception 'planning_saved_but_not_current'; end if;
    v_result:=jsonb_build_object('jobId',v_job,'runId',v_run,'status','completed',
      'revision',v_result->'revision','sourceRevision',v_source,'engineVersion',v_engine,
      'rowCount',jsonb_array_length(v_rows));
    update public.scheduling_agent_team_optimization_jobs set status='completed',
      result_receipt=v_result,finished_at=clock_timestamp(),failure_code=null where id=v_job;
    insert into public.scheduling_agent_worker_audit(job_id,run_id,event_type)
      values(v_job,v_run,'completed');
    return v_result;
  end if;

  if p_action='finish' then
    -- Completion is only possible inside persist. A caller cannot manufacture success.
    if coalesce((p_payload->>'success')::boolean,false) then raise exception 'worker_receipt_required'; end if;
    if not exists(select 1 from public.scheduling_planning_run_leases
      where period_key='year' and district='' and run_id=v_run
        and owner_id=worker_owner and expires_at>clock_timestamp())
    then raise exception 'worker_run_lease_invalid'; end if;
    v_success:=coalesce(p_payload->>'failureCode','') in (
      'worker_transport_failed','worker_api_unavailable','worker_database_retry',
      'worker_snapshot_revision_changed','planning_source_revision_conflict','planning_revision_conflict',
      'snapshot_stale_before_computation','snapshot_stale_before_commit');
    update public.scheduling_agent_team_optimization_jobs
      set status=case when v_success and attempt_count<3 then 'queued' else 'failed' end,
        finished_at=case when v_success and attempt_count<3 then null else clock_timestamp() end,
        failure_code=left(regexp_replace(coalesce(p_payload->>'failureCode','planning_server_run_failed'),
          '[^a-zA-Z0-9_]','','g'),120),
        next_attempt_at=clock_timestamp()+make_interval(secs=>least(600,30*(2^attempt_count)::integer)),
        dispatch_due_at=clock_timestamp()+make_interval(secs=>least(600,30*(2^attempt_count)::integer)),
        dispatch_attempts=0,dispatch_token=null,dispatch_expires_at=null
      where id=v_job returning * into j;
    insert into public.scheduling_agent_worker_audit(job_id,run_id,event_type)
      values(v_job,v_run,case when j.status='queued' then 'retry_scheduled' else 'failed' end);
    return jsonb_build_object('jobId',v_job,'status',j.status);
  end if;

  if p_action='release' then
    return public.release_scheduling_planning_run_lease('year','',v_run);
  end if;

  raise exception 'worker_action_not_supported';
end $$;
revoke all on function public.scheduling_agent_worker_command(text,jsonb) from public,anon,authenticated;
grant execute on function public.scheduling_agent_worker_command(text,jsonb) to service_role;
