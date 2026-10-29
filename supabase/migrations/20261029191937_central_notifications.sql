-- Review-gated migration: do not apply to production before owner approval.
-- No source workflow or approval function is replaced. No historical backfill.
begin;
create schema if not exists private;

create table private.dashboard_notification_versions (
  domain text not null, entity_key text not null, revision bigint not null,
  primary key(domain,entity_key)
);
create table private.dashboard_notification_events (
  id uuid primary key default gen_random_uuid(), domain text not null,
  entity_key text not null, revision bigint not null, event_type text not null,
  old_status text, new_status text, actor_auth_user_id uuid,
  created_at timestamptz not null default now(),
  unique(domain,entity_key,revision)
);
create table private.dashboard_notification_assignments (
  domain text not null check(domain in ('personal_report','proposal','attendance')),
  entity_key text not null, stage text not null,
  recipient_auth_user_id uuid not null references auth.users(id) on delete cascade,
  primary key(domain,entity_key,stage,recipient_auth_user_id)
);
create table private.dashboard_notification_routing_issues (
  event_id uuid primary key references private.dashboard_notification_events(id),
  stage text not null, reason text not null, created_at timestamptz not null default now()
);
create table public.dashboard_notifications (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references private.dashboard_notification_events(id),
  recipient_auth_user_id uuid not null references auth.users(id) on delete cascade,
  domain text not null, entity_key text not null, event_type text not null,
  stage text not null, created_at timestamptz not null default now(), read_at timestamptz,
  unique(event_id,recipient_auth_user_id)
);
create index dashboard_notifications_recipient_history on public.dashboard_notifications(recipient_auth_user_id,created_at desc,id desc);
create index dashboard_notifications_unread on public.dashboard_notifications(recipient_auth_user_id) where read_at is null;
create table public.dashboard_notification_tasks (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references private.dashboard_notification_events(id),
  recipient_auth_user_id uuid not null references auth.users(id) on delete cascade,
  domain text not null, entity_key text not null, stage text not null,
  created_at timestamptz not null default now(), closed_at timestamptz,
  close_reason text,
  unique(event_id,recipient_auth_user_id,stage)
);
create unique index dashboard_notification_one_open_task on public.dashboard_notification_tasks(domain,entity_key,stage,recipient_auth_user_id) where closed_at is null;
create index dashboard_notification_tasks_recipient on public.dashboard_notification_tasks(recipient_auth_user_id,created_at desc) where closed_at is null;

-- A routing assignment is not an authorization grant. Require source capability too.
create function private.notification_capable(p_uid uuid,p_domain text,p_stage text)
returns boolean language sql stable security definer set search_path=public,private,pg_temp as $$
 select exists(select 1 from public.users u where u.auth_user_id=p_uid and u.is_active and case p_domain
 when 'personal_report' then exists(select 1 from public.profiles p where p.id=p_uid and p.is_active and p.can_access_personal_reports)
   and (p_stage='employee' or exists(select 1 from public.profiles p where p.id=p_uid and p.role='admin'))
 when 'proposal' then u.role='admin' or
   (case when p_stage='sign' then lower(coalesce(u.permissions->>'approve_proposals_agreements',u.approve_proposals_agreements::text,''))
    else lower(coalesce(u.permissions->>'manage_proposals_agreements',u.manage_proposals_agreements::text,'')) end in ('yes','true','1'))
 when 'attendance' then case
   when p_stage in ('final_review','dispatch') then u.role='admin'
   when p_stage='payroll' then u.role='admin' or (u.role='finance' and lower(coalesce(u.permissions->>'view_finance_payroll','')) in ('yes','true','1'))
   when p_stage='employee' then true
   else u.role in ('admin','operation_manager','activities_manager','manager','instructor_manager') and
     (u.role='admin' or lower(coalesce(u.permissions->>'view_attendance_control','')) in ('yes','true','1')) end
 else false end)
$$;

create function private.notification_recipients(p_domain text,p_key text,p_stage text)
returns table(recipient uuid) language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare v_owner uuid; v_label text; v_reference text; v_candidates uuid[]; v_self_report boolean:=false; v_assignment_key text;
begin
 if p_domain='personal_report' and p_stage='employee' then
  select r.employee_id into v_owner from public.personal_reports r where r.id::text=p_key;
  return query select v_owner where private.notification_capable(v_owner,p_domain,p_stage); return;
 end if;
 if p_domain='attendance' and p_stage='employee' then
  select array_agg(distinct u.auth_user_id) into v_candidates from public.users u
    where u.is_active and u.emp_id=split_part(p_key,'|',1) and u.auth_user_id is not null;
  if cardinality(v_candidates)=1 then
   return query select v_candidates[1] where private.notification_capable(v_candidates[1],p_domain,p_stage);
  end if; return;
 end if;
 v_self_report:=p_domain='personal_report' and p_stage='review' and exists(
   select 1 from public.personal_reports pr join public.users u on u.auth_user_id=pr.employee_id
   where pr.id::text=p_key and u.username='idann');
 -- Document-specific appointment overrides the named process-wide appointment.
 -- An ambiguous explicit assignment is a routing issue, never a fan-out.
 v_assignment_key:=case when v_self_report or exists(select 1 from private.dashboard_notification_assignments
  where domain=p_domain and entity_key=p_key and stage=p_stage) then p_key else '*' end;
 select array_agg(distinct a.recipient_auth_user_id) into v_candidates
 from private.dashboard_notification_assignments a
 where a.domain=p_domain and a.stage=p_stage and a.entity_key=v_assignment_key
 and not (p_domain='personal_report' and p_stage='review' and exists(
   select 1 from public.personal_reports pr where pr.id::text=p_key and pr.employee_id=a.recipient_auth_user_id));
 if exists(select 1 from private.dashboard_notification_assignments where domain=p_domain and entity_key=v_assignment_key and stage=p_stage) then
   if cardinality(v_candidates)=1 then
    return query select v_candidates[1] where private.notification_capable(v_candidates[1],p_domain,p_stage);
   end if;
   return;
 end if;
 if v_self_report then return;end if;
 if p_domain='personal_report' then
   select r.employee_id into v_owner from public.personal_reports r where r.id::text=p_key;
   if p_stage='employee' then
     return query select v_owner where private.notification_capable(v_owner,p_domain,p_stage); return;
   end if;
   select ep.direct_manager into v_label from public.employee_profiles ep join public.users u on u.user_id=ep.user_id
    where u.auth_user_id=v_owner and u.is_active;
 elsif p_domain='attendance' then
   if p_stage='employee' then
     select array_agg(distinct u.auth_user_id) into v_candidates from public.users u
       where u.is_active and u.emp_id=split_part(p_key,'|',1) and u.auth_user_id is not null;
   elsif p_stage='manager_review' then
     if exists(select 1 from public.employee_profiles ep join public.users owner on owner.user_id=ep.user_id
       where owner.is_active and split_part(p_key,'|',1) in (ep.emp_id,owner.emp_id)
         and nullif(btrim(ep.emp_id),'') is not null and nullif(btrim(owner.emp_id),'') is not null
         and btrim(ep.emp_id)<>btrim(owner.emp_id)) then return; end if;
     -- Both canonical rosters can describe an employee. Combine them before
     -- resolving the manager: contradictory sources must not silently win.
     select case when count(distinct lower(btrim(label)))=1 then min(btrim(label)) end
       into v_label
     from (
       select ci.direct_manager label from public.contacts_instructors ci
         where ci.emp_id::text=split_part(p_key,'|',1)
       union all
       select ep.direct_manager from public.employee_profiles ep
         join public.users owner on owner.user_id=ep.user_id
         where coalesce(nullif(btrim(ep.emp_id),''),nullif(btrim(owner.emp_id),''))=split_part(p_key,'|',1)
           and owner.is_active=true
     ) roster
     where nullif(btrim(label),'') is not null;

   else return; end if;
 elsif p_domain='proposal' and p_stage='responsible' then
   select pr.created_by into v_reference from public.proposals_agreements pr where pr.id::text=p_key;
   select array_agg(distinct u.auth_user_id) into v_candidates from public.users u
    where u.is_active and u.auth_user_id is not null and (u.user_id=v_reference or u.auth_user_id::text=v_reference);
 else return; end if;
 if nullif(btrim(v_label),'') is not null then
   select array_agg(distinct u.auth_user_id) into v_candidates from public.users u
    where u.is_active and u.auth_user_id is not null and lower(btrim(coalesce(nullif(u.full_name,''),u.name,'')))=lower(btrim(v_label));
 end if;
 -- Ambiguous names/employee links must never fan out.
 if cardinality(v_candidates)=1 then
   return query select v_candidates[1] where private.notification_capable(v_candidates[1],p_domain,p_stage);
 end if;
end $$;

create function private.notification_visible(p_uid uuid,p_domain text,p_key text,p_stage text)
returns boolean language sql stable security definer set search_path=public,private,pg_temp as $$
 select p_uid=auth.uid() and private.notification_capable(p_uid,p_domain,p_stage) and (
  exists(select 1 from private.notification_recipients(p_domain,p_key,p_stage) r where r.recipient=p_uid)
  or (p_domain='personal_report' and not exists(select 1 from public.personal_reports where id::text=p_key))
  or (p_domain='proposal' and not exists(select 1 from public.proposals_agreements where id::text=p_key))
  or (p_domain='attendance' and not exists(select 1 from public.attendance_month_approvals where emp_id::text=split_part(p_key,'|',1) and month_key=split_part(p_key,'|',2)))
 )
$$;
alter table public.dashboard_notifications enable row level security;
alter table public.dashboard_notification_tasks enable row level security;
create policy dashboard_notifications_own on public.dashboard_notifications for select to authenticated
 using(recipient_auth_user_id=(select auth.uid()) and private.notification_visible(recipient_auth_user_id,domain,entity_key,stage));
create policy dashboard_notification_tasks_own on public.dashboard_notification_tasks for select to authenticated
 using(recipient_auth_user_id=(select auth.uid()) and private.notification_visible(recipient_auth_user_id,domain,entity_key,stage));
revoke all on public.dashboard_notifications,public.dashboard_notification_tasks from public,anon,authenticated;
grant select on public.dashboard_notifications,public.dashboard_notification_tasks to authenticated;
revoke all on private.dashboard_notification_events,private.dashboard_notification_versions,private.dashboard_notification_assignments,private.dashboard_notification_routing_issues from public,anon,authenticated;

create function public.mark_dashboard_notification_read(p_notification_id uuid)
returns boolean language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
 if auth.uid() is null then raise exception 'unauthorized' using errcode='42501'; end if;
 update public.dashboard_notifications n set read_at=coalesce(n.read_at,now())
 where n.id=p_notification_id and n.recipient_auth_user_id=auth.uid()
 and private.notification_visible(n.recipient_auth_user_id,n.domain,n.entity_key,n.stage);
 return found;
end $$;
revoke all on function public.mark_dashboard_notification_read(uuid) from public,anon;
grant execute on function public.mark_dashboard_notification_read(uuid) to authenticated;

create function public.dashboard_notification_history(p_before_time timestamptz default null,p_before_id uuid default null,p_domain text default null,p_from_date date default null,p_to_date date default null)
returns setof public.dashboard_notifications language sql stable security invoker set search_path=public,pg_temp as $$
 select n.* from public.dashboard_notifications n
 where n.recipient_auth_user_id=(select auth.uid())
 and (p_before_time is null or (n.created_at,n.id)<(p_before_time,p_before_id))
 and (p_domain is null or n.domain=p_domain)
 and (p_from_date is null or n.created_at >= (p_from_date::timestamp at time zone 'Asia/Jerusalem'))
 and (p_to_date is null or n.created_at < ((p_to_date+1)::timestamp at time zone 'Asia/Jerusalem'))
 order by n.created_at desc,n.id desc limit 31
$$;
create function public.dashboard_notification_task_history(p_before_time timestamptz default null,p_before_id uuid default null,p_domain text default null,p_from_date date default null,p_to_date date default null)
returns setof public.dashboard_notification_tasks language sql stable security invoker set search_path=public,pg_temp as $$
 select n.* from public.dashboard_notification_tasks n
 where n.recipient_auth_user_id=(select auth.uid()) and n.closed_at is not null
 and (p_before_time is null or (n.created_at,n.id)<(p_before_time,p_before_id))
 and (p_domain is null or n.domain=p_domain)
 and (p_from_date is null or n.created_at >= (p_from_date::timestamp at time zone 'Asia/Jerusalem'))
 and (p_to_date is null or n.created_at < ((p_to_date+1)::timestamp at time zone 'Asia/Jerusalem'))
 order by n.created_at desc,n.id desc limit 31
$$;
revoke all on function public.dashboard_notification_history(timestamptz,uuid,text,date,date),public.dashboard_notification_task_history(timestamptz,uuid,text,date,date) from public,anon;
grant execute on function public.dashboard_notification_history(timestamptz,uuid,text,date,date),public.dashboard_notification_task_history(timestamptz,uuid,text,date,date) to authenticated;

-- Labels are resolved from canonical records only after checking the exact delivery recipient.
create function public.dashboard_notification_labels(p_ids uuid[])
returns jsonb language sql stable security definer set search_path=public,private,pg_temp as $$
 with visible as (
  select n.id,n.domain,n.entity_key from public.dashboard_notifications n where n.id=any(p_ids[1:100])
   and n.recipient_auth_user_id=auth.uid() and private.notification_visible(n.recipient_auth_user_id,n.domain,n.entity_key,n.stage)
  union all
  select n.id,n.domain,n.entity_key from public.dashboard_notification_tasks n where n.id=any(p_ids[1:100])
   and n.recipient_auth_user_id=auth.uid() and private.notification_visible(n.recipient_auth_user_id,n.domain,n.entity_key,n.stage)
 ), labels as (
  select v.id,case v.domain
  when 'personal_report' then jsonb_build_object('subject_label',coalesce((select p.full_name from public.profiles p where p.id=pr.employee_id),'דוח אישי'),
    'month_key',pr.report_year::text||'-'||lpad(pr.report_month::text,2,'0'))
  when 'proposal' then jsonb_build_object('subject_label','הצעת מחיר'||coalesce(' מס׳ '||nullif(pa.quote_number,''),'')||coalesce(' — '||nullif(pa.client_authority,''),''))
  when 'attendance' then jsonb_build_object('subject_label',coalesce(ci.full_name,staff.full_name,'נוכחות'),'month_key',split_part(v.entity_key,'|',2)) end label
  from visible v
  left join public.personal_reports pr on v.domain='personal_report' and pr.id::text=v.entity_key
  left join public.proposals_agreements pa on v.domain='proposal' and pa.id::text=v.entity_key
  left join public.contacts_instructors ci on v.domain='attendance' and ci.emp_id::text=split_part(v.entity_key,'|',1)
 left join lateral (
   select max(coalesce(nullif(ep.full_name,''),nullif(u.full_name,''),u.name)) full_name
   from public.users u left join public.employee_profiles ep on ep.user_id=u.user_id
   where u.is_active and coalesce(nullif(btrim(ep.emp_id),''),u.emp_id)=split_part(v.entity_key,'|',1)
 ) staff on v.domain='attendance'
 ) select coalesce(jsonb_object_agg(id::text,label),'{}'::jsonb) from labels
$$;
revoke all on function public.dashboard_notification_labels(uuid[]) from public,anon;
grant execute on function public.dashboard_notification_labels(uuid[]) to authenticated;

-- Routing exceptions are visible only to the named process owner, never as another user's task.
create function public.dashboard_notification_routing_issues()
returns table(domain text,subject_label text,stage text) language sql stable security definer set search_path=public,private,pg_temp as $$
 select e.domain,case e.domain when 'personal_report' then coalesce(p.full_name,'דוח אישי')||' — דוח אישי'
 when 'proposal' then 'הצעת מחיר'||coalesce(' מס׳ '||pa.quote_number,'') else coalesce(ci.full_name,staff.full_name,'עובד')||' — נוכחות' end, i.stage
 from private.dashboard_notification_routing_issues i join private.dashboard_notification_events e on e.id=i.event_id
 join private.dashboard_notification_versions v on v.domain=e.domain and v.entity_key=e.entity_key and v.revision=e.revision
 left join public.personal_reports pr on e.domain='personal_report' and pr.id::text=e.entity_key
 left join public.profiles p on p.id=pr.employee_id
 left join public.proposals_agreements pa on e.domain='proposal' and pa.id::text=e.entity_key
 left join public.contacts_instructors ci on e.domain='attendance' and ci.emp_id::text=split_part(e.entity_key,'|',1)
 left join lateral (
   select max(coalesce(nullif(ep.full_name,''),nullif(u.full_name,''),u.name)) full_name
   from public.users u left join public.employee_profiles ep on ep.user_id=u.user_id
   where u.is_active and coalesce(nullif(btrim(ep.emp_id),''),u.emp_id)=split_part(e.entity_key,'|',1)
 ) staff on e.domain='attendance'
 where exists(select 1 from public.users u where u.auth_user_id=auth.uid() and u.is_active and u.role='admin' and u.username='idann')
 order by i.created_at desc limit 100
$$;
revoke all on function public.dashboard_notification_routing_issues() from public,anon;
grant execute on function public.dashboard_notification_routing_issues() to authenticated;

create function private.emit_dashboard_notification(p_domain text,p_key text,p_event text,p_old text,p_new text,p_stage text,p_task boolean)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_revision bigint; v_event uuid; v_uid uuid; v_count int:=0;
begin
 insert into private.dashboard_notification_versions values(p_domain,p_key,1)
 on conflict(domain,entity_key) do update set revision=dashboard_notification_versions.revision+1 returning revision into v_revision;
 insert into private.dashboard_notification_events(domain,entity_key,revision,event_type,old_status,new_status,actor_auth_user_id)
 values(p_domain,p_key,v_revision,p_event,p_old,p_new,auth.uid()) returning id into v_event;
 update public.dashboard_notification_tasks set closed_at=now(),close_reason=p_event
 where domain=p_domain and entity_key=p_key and closed_at is null;
 if p_stage is null then return; end if;
 for v_uid in select recipient from private.notification_recipients(p_domain,p_key,p_stage) loop
   insert into public.dashboard_notifications(event_id,recipient_auth_user_id,domain,entity_key,event_type,stage)
    values(v_event,v_uid,p_domain,p_key,p_event,p_stage) on conflict do nothing;
   if p_task then
    insert into public.dashboard_notification_tasks(event_id,recipient_auth_user_id,domain,entity_key,stage)
     values(v_event,v_uid,p_domain,p_key,p_stage) on conflict do nothing;
   end if;
   v_count:=v_count+1;
 end loop;
 if v_count=0 then insert into private.dashboard_notification_routing_issues(event_id,stage,reason)
 values(v_event,p_stage,'missing_ambiguous_or_unauthorized_assignment'); end if;
end $$;

create function private.capture_dashboard_notification()
returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_domain text:=TG_ARGV[0]; v_old jsonb:=case when TG_OP='INSERT' then '{}'::jsonb else to_jsonb(OLD) end;
 v_new jsonb:=case when TG_OP='DELETE' then '{}'::jsonb else to_jsonb(NEW) end;
 v_key text; v_status text:=v_new->>'status'; v_previous text:=v_old->>'status'; v_event text; v_stage text; v_task boolean:=false;
begin
 if v_domain='attendance' then v_key:=coalesce(v_new->>'emp_id',v_new->>'employee_id',v_old->>'emp_id',v_old->>'employee_id')||'|'||coalesce(v_new->>'month_key',v_old->>'month_key');
 else v_key:=coalesce(v_new->>'id',v_old->>'id'); end if;
 if TG_OP='DELETE' then v_event:='deleted';
 elsif v_domain='proposal' and v_new->>'archived_at' is not null and v_old->>'archived_at' is null then v_event:='archived';
 elsif v_status is not distinct from v_previous then return NEW;
 elsif v_domain='personal_report' then
   case v_status
   when 'submitted' then v_event:=case when v_previous='needs_correction' then 'resubmitted' else 'submitted' end; v_stage:='review'; v_task:=true;
   when 'needs_correction' then v_event:='returned';v_stage:='employee';v_task:=true;
   when 'approved' then v_event:='approved';v_stage:='employee';
   when 'paid' then v_event:='sent_to_payment';v_stage:='employee';
   else v_event:=v_status; end case;
 elsif v_domain='proposal' then
   case v_status
   when 'pending_approval' then v_event:='awaiting_signature';v_stage:='sign';v_task:=true;
   when 'approved' then v_event:='approved';v_stage:='responsible';v_task:=true;
   when 'returned_for_changes' then v_event:='returned';v_stage:='responsible';v_task:=true;
   else v_event:=v_status;end case;
 elsif TG_TABLE_NAME='attendance_month_approvals' then
   case when v_status='submitted' then v_event:='employee_submitted';v_stage:='manager_review';v_task:=true;
   when v_status='locked' and v_new->>'manager_approved_at' is not null then v_event:='manager_approved';v_stage:='final_review';v_task:=true;
   when v_previous in ('submitted','locked') and v_status in ('open','reopened') then v_event:='reopened';v_stage:='employee';v_task:=true;
   else v_event:=v_status;end case;
 else
   case v_status when 'admin_approved' then v_event:='admin_approved';v_stage:='dispatch';v_task:=true;
   when 'approved_for_payroll' then v_event:='dispatched_to_payroll';v_stage:='payroll';
   else v_event:=v_status;end case;
 end if;
 -- Draft creation is not an actionable event.
 if TG_OP='INSERT' and (v_status in ('draft','open') or v_status is null) then return NEW;end if;
 perform private.emit_dashboard_notification(v_domain,v_key,v_event,v_previous,v_status,v_stage,v_task);
 if TG_OP='DELETE' then return OLD; else return NEW;end if;
end $$;
create trigger capture_personal_report_notifications after insert or update or delete on public.personal_reports for each row execute function private.capture_dashboard_notification('personal_report');
create trigger capture_proposal_notifications after insert or update or delete on public.proposals_agreements for each row execute function private.capture_dashboard_notification('proposal');
create trigger capture_attendance_notifications after insert or update or delete on public.attendance_month_approvals for each row execute function private.capture_dashboard_notification('attendance');
create trigger capture_payroll_notifications after insert or update or delete on public.payroll_control_approvals for each row execute function private.capture_dashboard_notification('attendance');

-- Optional reviewed activation step. Never synthesizes old transition dates or finance deliveries.
-- Call once from the owner SQL console after validating routing issues, not from clients.
create function private.initialize_dashboard_notifications()
returns integer language plpgsql security definer set search_path=public,private,pg_temp as $$
declare r record; v_count integer:=0;
begin
 for r in
  select 'personal_report' domain,id::text entity_key,status,
    case when status='submitted' then 'review' else 'employee' end stage
   from public.personal_reports where status in ('submitted','needs_correction')
  union all
  select 'proposal',id::text,status,case when status='pending_approval' then 'sign' else 'responsible' end
   from public.proposals_agreements where status in ('pending_approval','returned_for_changes','approved') and archived_at is null
  union all
  select 'attendance',m.emp_id::text||'|'||m.month_key,m.status,
   case when p.status='admin_approved' then 'dispatch' when m.status='submitted' then 'manager_review' else 'final_review' end
   from public.attendance_month_approvals m left join public.payroll_control_approvals p on p.employee_id=m.emp_id::text and p.month_key=m.month_key
   where (p.id is null or p.status='admin_approved') and (m.status='submitted' or (m.status='locked' and m.manager_approved_at is not null))
 loop
  -- Serialize with source triggers and repeat calls; unchanged current state gets only one snapshot.
  insert into private.dashboard_notification_versions(domain,entity_key,revision) values(r.domain,r.entity_key,0)
   on conflict do nothing;
  perform 1 from private.dashboard_notification_versions v where v.domain=r.domain and v.entity_key=r.entity_key and v.revision=0 for update;
  if found then
   perform private.emit_dashboard_notification(r.domain,r.entity_key,'current_pending',null,r.status,r.stage,true);
   v_count:=v_count+1;
  end if;
 end loop;
 return v_count;
end $$;
revoke all on function private.initialize_dashboard_notifications() from public,anon,authenticated;

-- Explicit appointments supplied by the owner; do not infer from capability flags.
insert into private.dashboard_notification_assignments(domain,entity_key,stage,recipient_auth_user_id)
 select a.domain,'*',a.stage,u.auth_user_id from (values
 ('proposal','sign','idann'),('personal_report','review','idann'),
 ('attendance','final_review','idann'),('attendance','dispatch','idann'),('attendance','payroll','tonin')
 ) a(domain,stage,username) join public.users u on u.username=a.username
 where u.is_active and u.auth_user_id is not null
 and (select count(*) from public.users x where x.username=a.username and x.is_active)=1;

-- Block self-escalation while preserving app-admin profile management.
create function private.guard_profile_security_fields()
returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
 if auth.uid() is not null and not exists(select 1 from public.users u where u.auth_user_id=auth.uid() and u.is_active and u.role='admin') then
   if TG_OP='INSERT' then
    if NEW.id is distinct from auth.uid() or NEW.role<>'employee' or NEW.is_active or NEW.can_access_personal_reports then
     raise exception 'profile_security_fields_forbidden' using errcode='42501';end if;
   elsif NEW.id is distinct from OLD.id or NEW.role is distinct from OLD.role or NEW.is_active is distinct from OLD.is_active or NEW.can_access_personal_reports is distinct from OLD.can_access_personal_reports then
    raise exception 'profile_security_fields_forbidden' using errcode='42501';
   end if;
 elsif auth.uid() is null and current_setting('role',true) in ('anon','authenticated') then
   raise exception 'profile_auth_required' using errcode='42501';
 end if;
 return NEW;
end $$;
create trigger guard_profile_security_fields before insert or update on public.profiles for each row execute function private.guard_profile_security_fields();

-- Internal functions are not client APIs; only the RLS predicate needs execution.
revoke all on function private.notification_capable(uuid,text,text),private.notification_recipients(text,text,text),private.emit_dashboard_notification(text,text,text,text,text,text,boolean),private.capture_dashboard_notification(),private.guard_profile_security_fields() from public,anon,authenticated;
revoke all on function private.notification_visible(uuid,text,text,text) from public,anon;
grant usage on schema private to authenticated;
grant execute on function private.notification_visible(uuid,text,text,text) to authenticated;
-- Private metadata is defense-in-depth RLS/default deny.
alter table private.dashboard_notification_events enable row level security;
alter table private.dashboard_notification_versions enable row level security;
alter table private.dashboard_notification_assignments enable row level security;
alter table private.dashboard_notification_routing_issues enable row level security;
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.dashboard_notifications,public.dashboard_notification_tasks;
 end if;
end $$;
commit;
