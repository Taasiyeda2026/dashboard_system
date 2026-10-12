-- Phase B extends #2301. No jobs are installed and production delivery is OFF.
create table public.feedback_staff_auto_control (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 activation_at timestamptz,
 check(not enabled or activation_at is not null)
);
insert into public.feedback_staff_auto_control(singleton) values(true);
alter table public.feedback_staff_auto_control enable row level security;
revoke all on public.feedback_staff_auto_control from public,anon,authenticated;
grant select on public.feedback_staff_auto_control to service_role;

alter table public.feedback_staff_auto_outbox drop constraint feedback_staff_auto_outbox_status_check;
alter table public.feedback_staff_auto_outbox add constraint feedback_staff_auto_outbox_status_check
 check(status in ('pending','sending','accepted','failed','unknown','cancelled','needs_attention'));
alter table public.feedback_staff_auto_outbox add column snapshot jsonb not null default '{}';
alter table public.feedback_staff_auto_outbox add column claim_token uuid;
alter table public.feedback_staff_auto_outbox add column graph_started_at timestamptz;

create table public.feedback_staff_auto_attempts (
 id uuid primary key,
 outbox_id uuid not null references public.feedback_staff_auto_outbox(id),
 attempt_no integer not null,
 recipient_email text not null,
 contact_id bigint not null,
 activity_row_id text not null,
 started_at timestamptz not null,
 finished_at timestamptz,
 result text not null check(result in ('sending','accepted','failed','unknown','cancelled')),
 http_status integer,
 graph_request_id text,
 error text,
 unique(outbox_id,attempt_no)
);
alter table public.feedback_staff_auto_attempts enable row level security;
revoke all on public.feedback_staff_auto_attempts from public,anon,authenticated;
grant select on public.feedback_staff_auto_attempts to service_role;

-- Retain original member identities across representative / grouping changes.
-- All mutation RPCs share a short transaction-level lock. No lock spans Graph.
create function private.feedback_staff_auto_snapshot(p_candidate jsonb)
returns jsonb language sql immutable set search_path='' as $$
 select p_candidate - 'status' - 'scheduled_count' - 'total_meetings'
   - 'member_row_ids' || jsonb_build_object('member_row_ids',(
     select jsonb_agg(v order by v) from jsonb_array_elements_text(p_candidate->'member_row_ids') v
   ))
$$;
revoke all on function private.feedback_staff_auto_snapshot(jsonb) from public,anon,authenticated;

create function public.feedback_staff_auto_prepare(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path='' as $$
declare c record; ctl public.feedback_staff_auto_control; existing public.feedback_staff_auto_outbox;
 due timestamptz; n integer:=0;
begin
 select * into ctl from public.feedback_staff_auto_control where singleton;
 if not coalesce(ctl.enabled,false) or ctl.activation_at is null then return '{"disabled":true,"prepared":0}'::jsonb; end if;
 if extract(hour from p_now at time zone 'Asia/Jerusalem')<>5 then return '{"outside_window":true}'::jsonb; end if;
 perform pg_advisory_xact_lock(2027,805);
 due:=(((p_now at time zone 'Asia/Jerusalem')::date + time '08:00') at time zone 'Asia/Jerusalem');
 for c in select * from public.feedback_staff_auto_candidates(p_now)
   where status='eligible' and eligibility_at>=ctl.activation_at loop
   -- Accepted / ambiguous / in-flight deliveries block the entire merged row,
   -- including later renamed/split/merged groups sharing any historical member.
   if exists(select 1 from public.feedback_staff_auto_outbox o where o.stage=c.stage
     and (o.group_key=c.group_key or o.member_row_ids && c.member_row_ids)
     and o.status in ('accepted','unknown','sending')) then continue; end if;
   select * into existing from public.feedback_staff_auto_outbox o
     where o.stage=c.stage and (o.group_key=c.group_key or o.member_row_ids && c.member_row_ids)
     order by (o.group_key=c.group_key) desc,o.created_at limit 1 for update;
   if existing.id is not null then
     -- A new daily preparation may refresh a cancelled stale snapshot. Failed
     -- attempts are retained for explicit review, never silently retried.
     if existing.status in ('failed','needs_attention') then continue; end if;
     update public.feedback_staff_auto_outbox set
       group_key=c.group_key,activity_row_id=c.representative_row_id,
       member_row_ids=array(select distinct unnest(existing.member_row_ids||c.member_row_ids)),
       program_key=c.program_key,contact_id=c.contact_id,recipient_email=c.contact_email,
       eligibility_at=c.eligibility_at,send_after=due,status='pending',last_error=null,
       snapshot=private.feedback_staff_auto_snapshot(to_jsonb(c)),updated_at=p_now
     where id=existing.id;
   else
     insert into public.feedback_staff_auto_outbox(group_key,stage,activity_row_id,member_row_ids,
       program_key,contact_id,recipient_email,eligibility_at,send_after,snapshot)
     values(c.group_key,c.stage,c.representative_row_id,c.member_row_ids,c.program_key,c.contact_id,
       c.contact_email,c.eligibility_at,due,private.feedback_staff_auto_snapshot(to_jsonb(c)));
   end if;
   n:=n+1;
 end loop;
 return jsonb_build_object('prepared',n,'send_after',due);
end $$;

-- Create/reuse existing templates and token flow, without touching student or
-- instructor management RPCs. Stale personal links with responses are immutable.
create function private.feedback_staff_auto_link(p_outbox public.feedback_staff_auto_outbox,p_now timestamptz)
returns jsonb language plpgsql set search_path='' as $$
declare a public.activities; c public.feedback_campaigns; r public.feedback_recipients;
 v_version uuid; v_contact public.contacts_schools;
begin
 select * into a from public.activities where row_id=p_outbox.activity_row_id for share;
 select * into v_contact from public.contacts_schools where id=a.school_contact_id for share;
 if a.school_contact_id is distinct from p_outbox.contact_id or
   nullif(btrim(v_contact.email),'') is distinct from p_outbox.recipient_email then
   return '{"error":"selected_contact_changed"}'::jsonb;
 end if;
 select * into c from public.feedback_campaigns where activity_row_id=a.row_id
   and audience='educational_staff' and stage=p_outbox.stage for update;
 if c.id is null then
   select t.current_version_id into v_version from public.feedback_templates t
     join public.feedback_template_versions v on v.id=t.current_version_id and v.status='published'
     where t.program_key=p_outbox.program_key and t.audience='educational_staff' and t.stage=p_outbox.stage;
   if v_version is null then return '{"error":"template_not_published"}'::jsonb; end if;
   insert into public.feedback_campaigns(activity_row_id,program_key,template_version_id,audience,stage,
     academic_year,activity_name,school_id,school_name,authority_id,authority_name,grade,class_group,
     contact_id,contact_name,activity_start_date,activity_end_date,opens_at)
   values(a.row_id,p_outbox.program_key,v_version,'educational_staff',p_outbox.stage,
     'school_2027',coalesce(a.activity_name,''),a.school_id,coalesce(a.school,''),a.authority_id,
     coalesce(a.authority,''),coalesce(a.grade,''),coalesce(a.class_group,''),v_contact.id,
     coalesce(v_contact.contact_name,''),a.start_date::date,nullif(a.end_date::text,'')::date,p_now)
   on conflict(activity_row_id,audience,stage) where activity_row_id is not null do nothing;
   select * into c from public.feedback_campaigns where activity_row_id=a.row_id
     and audience='educational_staff' and stage=p_outbox.stage for update;
 end if;
 if c.program_key<>p_outbox.program_key or c.status<>'active' or c.opens_at>p_now
   or c.expires_at<=p_now then return '{"error":"campaign_not_live"}'::jsonb; end if;
 select * into r from public.feedback_recipients where campaign_id=c.id for update;
 if r.status='completed' or exists(select 1 from public.feedback_responses where campaign_id=c.id) then
   return '{"error":"campaign_already_answered"}'::jsonb;
 end if;
 if r.id is null then
   insert into public.feedback_recipients(campaign_id,recipient_type,contact_id,display_name,email,token)
   values(c.id,'educational_staff',v_contact.id,coalesce(v_contact.contact_name,''),p_outbox.recipient_email,
     private.feedback_new_token()) returning * into r;
 elsif r.contact_id is distinct from v_contact.id then
   -- No answers exist. Invalidate the old person's token before issuing a new one.
   update public.feedback_recipients set contact_id=v_contact.id,display_name=coalesce(v_contact.contact_name,''),
     email=p_outbox.recipient_email,phone='',token=private.feedback_new_token(),last_shared_at=null,last_shared_channel=null
     where id=r.id returning * into r;
 else
   update public.feedback_recipients set email=p_outbox.recipient_email where id=r.id returning * into r;
 end if;
 update public.feedback_campaigns set contact_id=v_contact.id,contact_name=coalesce(v_contact.contact_name,'') where id=c.id;
 return jsonb_build_object('campaign_id',c.id,'recipient_id',r.id,'token',r.token);
end $$;
revoke all on function private.feedback_staff_auto_link(public.feedback_staff_auto_outbox,timestamptz) from public,anon,authenticated;

create function public.feedback_staff_auto_claim(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.feedback_staff_auto_outbox; c record; ctl public.feedback_staff_auto_control;
 link jsonb; claim uuid; result_status text;
begin
 select * into ctl from public.feedback_staff_auto_control where singleton;
 if not coalesce(ctl.enabled,false) or ctl.activation_at is null then return '{"disabled":true}'::jsonb; end if;
 if extract(hour from p_now at time zone 'Asia/Jerusalem')<>8 then return '{"outside_window":true}'::jsonb; end if;
 perform pg_advisory_xact_lock(2027,805);
 -- A worker crash is never interpreted as permission to resend.
 for o in select * from public.feedback_staff_auto_outbox where status='sending'
   and claimed_at<p_now-interval '15 minutes' for update loop
   result_status:=case when o.graph_started_at is null then 'failed' else 'unknown' end;
   update public.feedback_staff_auto_outbox set status=result_status,last_error='worker_lost',updated_at=p_now where id=o.id;
   update public.feedback_staff_auto_attempts set result=result_status,error='worker_lost',finished_at=p_now where id=o.claim_token;
 end loop;
 for o in select * from public.feedback_staff_auto_outbox where status='pending' and send_after<=p_now
   order by send_after,id for update skip locked loop
   select * into c from public.feedback_staff_auto_candidates(p_now) where group_key=o.group_key and stage=o.stage;
   if not found or c.status<>'eligible' or c.eligibility_at<ctl.activation_at
     or private.feedback_staff_auto_snapshot(to_jsonb(c))<>o.snapshot then
     update public.feedback_staff_auto_outbox set status='cancelled',last_error='source_changed',updated_at=p_now where id=o.id;
     continue;
   end if;
   if exists(select 1 from public.feedback_staff_auto_outbox x where x.id<>o.id and x.stage=o.stage
     and x.member_row_ids && o.member_row_ids and x.status in ('accepted','sending','unknown')) then
     update public.feedback_staff_auto_outbox set status='needs_attention',last_error='overlapping_delivery',updated_at=p_now where id=o.id;
     continue;
   end if;
   link:=private.feedback_staff_auto_link(o,p_now);
   if link ? 'error' then
     update public.feedback_staff_auto_outbox set status='needs_attention',last_error=link->>'error',updated_at=p_now where id=o.id;
     continue;
   end if;
   claim:=gen_random_uuid();
   update public.feedback_staff_auto_outbox set status='sending',claim_token=claim,claimed_at=p_now,
     graph_started_at=null,attempts=attempts+1,campaign_id=(link->>'campaign_id')::uuid,
     recipient_id=(link->>'recipient_id')::uuid,updated_at=p_now where id=o.id;
   insert into public.feedback_staff_auto_attempts(id,outbox_id,attempt_no,recipient_email,contact_id,
     activity_row_id,started_at,result) values(claim,o.id,o.attempts+1,o.recipient_email,o.contact_id,o.activity_row_id,p_now,'sending');
   return jsonb_build_object('id',o.id,'claim_token',claim,'recipient_email',o.recipient_email,'stage',o.stage,
     'token',link->>'token','school',c.school,'program_title',
     (select title from public.feedback_programs where key=o.program_key));
 end loop;
 return '{}'::jsonb;
end $$;

create function public.feedback_staff_auto_begin_send(p_id uuid,p_claim uuid,p_token text,p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.feedback_staff_auto_outbox; c record; ctl public.feedback_staff_auto_control;
begin
 perform pg_advisory_xact_lock(2027,805);
 select * into o from public.feedback_staff_auto_outbox where id=p_id for update;
 if o.status is distinct from 'sending' or o.claim_token is distinct from p_claim or o.graph_started_at is not null then
   return '{"ready":false}'::jsonb;
 end if;
 select * into ctl from public.feedback_staff_auto_control where singleton;
 select * into c from public.feedback_staff_auto_candidates(p_now) where group_key=o.group_key and stage=o.stage;
 if not found or not ctl.enabled or ctl.activation_at is null or c.eligibility_at<ctl.activation_at
   or extract(hour from p_now at time zone 'Asia/Jerusalem')<>8 or c.status<>'eligible'
   or private.feedback_staff_auto_snapshot(to_jsonb(c))<>o.snapshot
   or not exists(select 1 from public.feedback_campaigns fc join public.feedback_recipients r on r.campaign_id=fc.id
     where fc.id=o.campaign_id and r.id=o.recipient_id and fc.status='active' and fc.opens_at<=p_now
       and (fc.expires_at is null or fc.expires_at>p_now) and r.status='pending'
       and r.contact_id=o.contact_id and r.email=o.recipient_email and r.token=p_token) then
   update public.feedback_staff_auto_outbox set status='cancelled',last_error='source_changed_before_graph',updated_at=p_now where id=o.id;
   update public.feedback_staff_auto_attempts set result='cancelled',error='source_changed_before_graph',finished_at=p_now where id=p_claim;
   return '{"ready":false}'::jsonb;
 end if;
 update public.feedback_staff_auto_outbox set graph_started_at=p_now,updated_at=p_now where id=o.id;
 return '{"ready":true}'::jsonb;
end $$;

create function public.feedback_staff_auto_finish(p_id uuid,p_claim uuid,p_result text,
 p_http_status integer default null,p_graph_request_id text default null,p_error text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.feedback_staff_auto_outbox;
begin
 if p_result not in ('accepted','failed','unknown') or (p_result='accepted' and p_http_status is distinct from 202) then
   raise exception 'invalid_delivery_result'; end if;
 select * into o from public.feedback_staff_auto_outbox where id=p_id for update;
 if o.status=p_result and o.claim_token=p_claim then return '{"recorded":true}'::jsonb; end if;
 if o.status is distinct from 'sending' or o.claim_token is distinct from p_claim then return '{"recorded":false}'::jsonb; end if;
 if p_result='accepted' and o.graph_started_at is null then raise exception 'graph_not_started'; end if;
 update public.feedback_staff_auto_outbox set status=p_result,last_http_status=p_http_status,
   graph_request_id=left(p_graph_request_id,200),last_error=left(p_error,500),updated_at=now(),
   accepted_at=case when p_result='accepted' then now() end where id=o.id;
 update public.feedback_staff_auto_attempts set result=p_result,http_status=p_http_status,
   graph_request_id=left(p_graph_request_id,200),error=left(p_error,500),finished_at=now() where id=p_claim;
 if p_result='accepted' then
   update public.feedback_recipients set last_shared_at=now(),last_shared_channel='email' where id=o.recipient_id;
 end if;
 return '{"recorded":true}'::jsonb;
end $$;

revoke all on function public.feedback_staff_auto_prepare(timestamptz),
 public.feedback_staff_auto_claim(timestamptz),public.feedback_staff_auto_begin_send(uuid,uuid,text,timestamptz),
 public.feedback_staff_auto_finish(uuid,uuid,text,integer,text,text) from public,anon,authenticated;
grant execute on function public.feedback_staff_auto_prepare(timestamptz),
 public.feedback_staff_auto_claim(timestamptz),public.feedback_staff_auto_begin_send(uuid,uuid,text,timestamptz),
 public.feedback_staff_auto_finish(uuid,uuid,text,integer,text,text) to service_role;

-- Minimal status payload: no tokens, emails, contacts or new viewer roles.
create function public.feedback_staff_auto_status()
returns table(activity_row_id text,stage text,status text,reason text)
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.feedback_can_view() then raise exception 'feedback_forbidden' using errcode='42501'; end if;
 return query select c.representative_row_id,c.stage,
   case when o.status='accepted' then 'sent'
     when o.status='failed' then 'failed'
     when o.status in ('unknown','cancelled','needs_attention') then 'needs_attention'
     when c.status not in ('eligible','not_due','unscheduled') then 'needs_attention'
     when o.status in ('pending','sending') then 'pending'
     when c.status='eligible' then 'needs_attention' else 'not_due' end,
   case when o.id is not null then coalesce(o.last_error,o.status)
     when c.status='eligible' then 'automation_disabled_or_not_prepared' else c.status end
 from public.feedback_staff_auto_candidates(now()) c
 left join lateral(select x.* from public.feedback_staff_auto_outbox x where x.stage=c.stage
   and (x.group_key=c.group_key or x.member_row_ids && c.member_row_ids)
   order by case x.status when 'accepted' then 0 when 'unknown' then 1 when 'sending' then 2 else 3 end,x.updated_at desc limit 1) o on true;
end $$;
revoke all on function public.feedback_staff_auto_status() from public,anon;
grant execute on function public.feedback_staff_auto_status() to authenticated;

-- Future deployment helper ONLY. This migration never calls it. It creates two
-- INACTIVE hourly jobs; local-hour gates handle DST without modifying cron.timezone.
-- Secret stays in Vault; no secret value is passed or embedded in cron.job.
create function public.feedback_staff_auto_install_inactive_cron()
returns void language plpgsql security definer set search_path='' as $fn$
declare job bigint; action text; target_hour integer;
begin
 foreach action in array array['prepare','dispatch'] loop
   target_hour:=case when action='prepare' then 5 else 8 end;
   execute format($sql$select cron.schedule(%L,'0 * * * *',%L)$sql$,
     'feedback-staff-'||action,
     format($cmd$select net.http_post(
       url:='https://szinlhjuwyiyszdpsdop.supabase.co/functions/v1/feedback-staff-automation',
       headers:=jsonb_build_object('Content-Type','application/json','x-staff-dry-run-secret',
         (select decrypted_secret from vault.decrypted_secrets where name='feedback_staff_automation_secret')),
       body:=jsonb_build_object('action',%L),timeout_milliseconds:=10000)
       where extract(hour from now() at time zone 'Asia/Jerusalem')=%s
         and exists(select 1 from public.feedback_staff_auto_control where enabled and activation_at is not null)$cmd$,
       action,target_hour)) into job;
   execute format('select cron.alter_job(%s,active:=false)',job);
 end loop;
end $fn$;
revoke all on function public.feedback_staff_auto_install_inactive_cron() from public,anon,authenticated,service_role;
comment on function public.feedback_staff_auto_install_inactive_cron() is
 'Deployment-owner only, manual after separate approval. Installs inactive jobs; NEVER invoked by migration.';
