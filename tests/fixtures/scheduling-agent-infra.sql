-- Synthetic dependencies for orchestration tests; NO production data or network.
do $$begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end$$;
create schema auth; create schema cron; create schema vault; create schema net;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.role() returns text language sql as $$select current_setting('request.jwt.claim.role',true)$$;
create function public.app_has_permission(text) returns boolean language sql as $$select auth.uid() is not null$$;
create table public.users(auth_user_id uuid,is_active boolean,role text);
create table public.scheduling_agent_control(singleton boolean,approver_id uuid);
create function public.scheduling_agent_team_assert_member() returns void language plpgsql as $$begin
 if auth.uid() is null then raise exception 'member_required'; end if;
end$$;
create table public.scheduling_planning_run_leases(period_key text,district text,run_id uuid,owner_id uuid,expires_at timestamptz);
create table public.scheduling_planning_source_state(singleton boolean,revision bigint);
create table public.scheduling_planning_workspaces(id uuid,period_key text,district text,revision bigint);
create table public.scheduling_planning_rows(workspace_id uuid,activity_id text,row_data jsonb,locked_option jsonb);
create table public.fixture_saves(id bigint generated always as identity,run_id uuid);
create function public.get_scheduling_planning_preflight(text,text) returns jsonb language sql as $$
 select jsonb_build_object('sourceRevision',revision,'dirtyCount',0,'workspace',jsonb_build_object(
 'revision',(select revision from scheduling_planning_workspaces limit 1),'validatedSourceRevision',revision,
 'engineVersion','planning-v38-20261015-transition-30-45')) from scheduling_planning_source_state limit 1
$$;
create function public.acquire_scheduling_planning_run_lease(text,text,uuid,integer) returns jsonb language plpgsql as $$begin
 if exists(select 1 from scheduling_planning_run_leases where expires_at>now() and run_id<>$3) then return '{"acquired":false}'; end if;
 delete from scheduling_planning_run_leases;
 insert into scheduling_planning_run_leases values($1,$2,$3,auth.uid(),clock_timestamp()+make_interval(secs=>$4));
 return '{"acquired":true}'; end$$;
create function public.heartbeat_scheduling_planning_run_lease(text,text,uuid,integer) returns jsonb language sql as $$
 select jsonb_build_object('ok',exists(select 1 from scheduling_planning_run_leases where run_id=$3 and expires_at>clock_timestamp()))$$;
create function public.release_scheduling_planning_run_lease(text,text,uuid) returns jsonb language plpgsql as $$begin
 delete from scheduling_planning_run_leases where run_id=$3;return '{"released":true}';end$$;
create function public.scheduling_authority_school_locations() returns table(school_id bigint) language sql as $$select 1::bigint$$;
create function public.get_scheduling_planning_external_blockers() returns jsonb language sql as $$select '[]'::jsonb$$;
-- Stub only the existing DOMAIN validator: tests exercise the real new SQL wrapper.
create function public.save_scheduling_planning_snapshot(text,text,text,text,text,jsonb,bigint,uuid,bigint)
 returns jsonb language plpgsql as $$begin
 insert into fixture_saves(run_id) values($8);
 update scheduling_planning_workspaces set revision=revision+1;
 if $6->0->'row'->>'invalid'='true' then raise exception 'fixture_domain_rejected';end if;
 return jsonb_build_object('revision',(select revision from scheduling_planning_workspaces limit 1));
end$$;
create function public.save_scheduling_planning_incremental_snapshot(text,text,text,text,text,jsonb,jsonb,bigint,uuid,bigint)
 returns jsonb language sql as $$select save_scheduling_planning_snapshot($1,$2,$3,$4,$5,$6,$8,$9,$10)$$;
create table cron.job(jobid bigint,schedule text,active boolean,command text);
create function cron.schedule(text,text,text) returns bigint language plpgsql as $$begin
 insert into cron.job values(1,$2,true,$3);return 1;end$$;
create function cron.alter_job(job_id bigint,active boolean) returns void language sql as $$update cron.job set active=$2 where jobid=$1$$;
create table vault.decrypted_secrets(name text,decrypted_secret text);
create table net.fixture_requests(id bigint generated always as identity,url text);
create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language plpgsql as $$declare n bigint;begin
 insert into net.fixture_requests(url) values($1) returning id into n;return n;end$$;
