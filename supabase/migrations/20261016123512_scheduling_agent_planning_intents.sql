-- Planning intent is durable, separately versioned, and never an assignment.
create table public.scheduling_instructor_baselines (
 emp_id bigint primary key references public.contacts_instructors(emp_id),
 plan_text text not null check (length(btrim(plan_text)) between 1 and 6000),
 version bigint not null default 1,
 updated_at timestamptz not null default now(),
 updated_by uuid not null references auth.users(id)
);
create table public.scheduling_instructor_intents (
 activity_id text primary key references public.activities(row_id) on delete cascade,
 emp_id bigint not null references public.contacts_instructors(emp_id),
 status text not null check(status in ('active','released')),
 reason text not null default '' check(length(reason)<=1000),
 version bigint not null default 1,
 updated_at timestamptz not null default now(),
 updated_by uuid not null references auth.users(id)
);
create index scheduling_instructor_intents_emp on public.scheduling_instructor_intents(emp_id);
create table public.scheduling_intent_audit (
 id bigint generated always as identity primary key,
 entity_type text not null, entity_id text not null,
 before_value jsonb, after_value jsonb,
 changed_at timestamptz not null default now(), changed_by uuid not null references auth.users(id)
);
alter table public.scheduling_instructor_baselines enable row level security;
alter table public.scheduling_instructor_intents enable row level security;
alter table public.scheduling_intent_audit enable row level security;
-- Only guarded RPCs can access these records; no direct client table writes.
revoke all on public.scheduling_instructor_baselines,public.scheduling_instructor_intents,public.scheduling_intent_audit from public,anon,authenticated;
create view public.scheduling_agent_worker_intents with(security_barrier=true) as
 select activity_id,emp_id,status,version from public.scheduling_instructor_intents;
revoke all on public.scheduling_agent_worker_intents from public,anon,authenticated;
grant select on public.scheduling_agent_worker_intents to service_role;

create function public.scheduling_agent_team_read_planning_intents(p_emp_id bigint default null)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 perform public.scheduling_agent_team_assert_member();
 return jsonb_build_object(
  'baselines',(select coalesce(jsonb_agg(jsonb_build_object('instructorId',emp_id,'planText',plan_text,'version',version::text,'updatedAt',updated_at) order by emp_id),'[]') from public.scheduling_instructor_baselines where p_emp_id is null or emp_id=p_emp_id),
  'intents',(select coalesce(jsonb_agg(jsonb_build_object('activityId',i.activity_id,'instructorId',i.emp_id,'status',i.status,'reason',i.reason,'version',i.version::text,'updatedAt',i.updated_at,'assignmentFinalized',a.emp_id=i.emp_id,'protectionActive',i.status='active' and a.emp_id is null and a.emp_id_2 is null) order by i.activity_id),'[]') from public.scheduling_instructor_intents i join public.activities a on a.row_id=i.activity_id where p_emp_id is null or i.emp_id=p_emp_id));
end $$;

create function public.scheduling_agent_team_save_planning_baseline(p_emp_id bigint,p_plan_text text,p_expected_version bigint)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare prior public.scheduling_instructor_baselines; saved public.scheduling_instructor_baselines;
begin
 perform public.scheduling_agent_team_assert_member();
 if p_expected_version is null or p_expected_version<0 or p_plan_text is null or length(btrim(p_plan_text)) not between 1 and 6000 then raise exception 'planning_intent_invalid'; end if;
 -- The instructor row serializes first creation as well as later updates.
 perform 1 from public.contacts_instructors where emp_id=p_emp_id for update;
 if not found then raise exception 'instructor_not_found'; end if;
 select * into prior from public.scheduling_instructor_baselines where emp_id=p_emp_id for update;
 if coalesce(prior.version,0)<>p_expected_version then raise exception 'planning_intent_version_conflict' using errcode='PT409'; end if;
 insert into public.scheduling_instructor_baselines(emp_id,plan_text,updated_by) values(p_emp_id,btrim(p_plan_text),auth.uid())
 on conflict(emp_id) do update set plan_text=excluded.plan_text,version=scheduling_instructor_baselines.version+1,updated_at=clock_timestamp(),updated_by=auth.uid() returning * into saved;
 insert into public.scheduling_intent_audit(entity_type,entity_id,before_value,after_value,changed_by) values('baseline',p_emp_id::text,to_jsonb(prior),to_jsonb(saved),auth.uid());
 return jsonb_build_object('saved',true,'instructorId',p_emp_id,'version',saved.version::text,'planText',saved.plan_text,'assignmentFinalized',false,'optimizerConstraint',false);
end $$;

create function public.scheduling_agent_team_save_intended_instructor(p_activity_id text,p_emp_id bigint,p_reason text,p_status text,p_expected_version bigint)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.activities; prior public.scheduling_instructor_intents; saved public.scheduling_instructor_intents;
begin
 perform public.scheduling_agent_team_assert_member();
 if p_expected_version is null or p_expected_version<0 or p_status is null or p_status not in ('active','released') or p_reason is null or length(p_reason)>1000 then raise exception 'planning_intent_invalid'; end if;
 select * into a from public.activities where row_id=p_activity_id for update;
 if not found or a.activity_season is distinct from 'school_2027' or a.activity_type is distinct from 'course' or a.status is distinct from 'פתוח' then raise exception 'scheduling_activity_not_open'; end if;
 select * into prior from public.scheduling_instructor_intents where activity_id=p_activity_id for update;
 if coalesce(prior.version,0)<>p_expected_version then raise exception 'planning_intent_version_conflict' using errcode='PT409'; end if;
 if p_status='released' and (prior.activity_id is null or prior.emp_id is distinct from p_emp_id) then raise exception 'planning_intent_invalid'; end if;
 if p_status='active' then
  if a.emp_id is not null or a.emp_id_2 is not null or a.instructor_assignment_locked is true or a.draft_emp_id is not null
    or exists(select 1 from public.scheduling_planning_rows where activity_id=p_activity_id and locked_option is not null) then raise exception 'scheduling_assignment_locked'; end if;
  if not exists(select 1 from public.contacts_instructors where emp_id=p_emp_id) then raise exception 'instructor_not_found'; end if;
  if exists(select 1 from public.contacts_instructors where emp_id=p_emp_id and lower(coalesce(active::text,'yes')) in ('no','false','0','לא פעיל')) then raise exception 'instructor_inactive'; end if;
 end if;
 insert into public.scheduling_instructor_intents(activity_id,emp_id,status,reason,updated_by) values(p_activity_id,p_emp_id,p_status,p_reason,auth.uid())
 on conflict(activity_id) do update set emp_id=excluded.emp_id,status=excluded.status,reason=excluded.reason,version=scheduling_instructor_intents.version+1,updated_at=clock_timestamp(),updated_by=auth.uid() returning * into saved;
 insert into public.scheduling_intent_audit(entity_type,entity_id,before_value,after_value,changed_by) values('instructor',p_activity_id,to_jsonb(prior),to_jsonb(saved),auth.uid());
 -- Fence snapshots already in flight and mark the affected row for refresh.
 update public.scheduling_planning_source_state set revision=revision+1,updated_at=clock_timestamp() where singleton;
 update public.scheduling_planning_rows set needs_recalc=true,
 row_data=case when p_status='active' then row_data || jsonb_build_object('kind','exception','instructorEmpId',null,'instructorName','','options','[]'::jsonb,'packingOptions','[]'::jsonb,'scheduleOptions','[]'::jsonb,'meetings',(select coalesce(jsonb_agg(m.value || jsonb_build_object('start_time',a.start_time,'end_time',a.end_time) order by m.ordinality),'[]'::jsonb) from jsonb_array_elements(public.scheduling_activity_official_meetings(a)) with ordinality m(value,ordinality) where not exists(select 1 from public.course_meeting_cancellations c where c.activity_id=a.row_id and c.meeting_date=(m.value->>'date')::date)),'planningIntent',jsonb_build_object('instructorId',p_emp_id,'version',saved.version,'protected',true,'status','awaiting_schedule_validation'),'reason','מדריך מיועד שמור; ממתין למועדים ולאימות') else row_data-'planningIntent' end
 where activity_id=p_activity_id and a.emp_id is null and a.emp_id_2 is null;
 return jsonb_build_object('saved',true,'activityId',p_activity_id,'instructorId',p_emp_id,'status',p_status,'version',saved.version::text,'assignmentFinalized',false,'protectionActive',p_status='active','calendarReserved',false);
end $$;

-- A stale worker or a manual confirmation must not replace a protected choice.
create function public.scheduling_guard_intended_instructor() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare chosen bigint;
begin
 select emp_id into chosen from public.scheduling_instructor_intents where activity_id=new.row_id and status='active';
 if chosen is not null and ((new.emp_id is distinct from old.emp_id and new.emp_id is not null and new.emp_id<>chosen) or (new.emp_id_2 is distinct from old.emp_id_2 and new.emp_id_2 is not null and new.emp_id is null)) then raise exception 'planning_intent_protected'; end if;
 return new;
end $$;
create trigger activities_guard_intended_instructor before update of emp_id,emp_id_2 on public.activities for each row execute function public.scheduling_guard_intended_instructor();
create function public.scheduling_guard_intended_planning_row() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if exists(select 1 from public.scheduling_instructor_intents i join public.activities a on a.row_id=i.activity_id where i.activity_id=new.activity_id and i.status='active' and a.emp_id is null and a.emp_id_2 is null)
 and (nullif(new.row_data->>'instructorEmpId','') is not null or new.locked_option is not null or coalesce(jsonb_array_length(new.row_data->'options'),0)>0 or coalesce(jsonb_array_length(new.row_data->'packingOptions'),0)>0 or coalesce(jsonb_array_length(new.row_data->'scheduleOptions'),0)>0)
 then raise exception 'planning_intent_protected'; end if;
 return new;
end $$;
create trigger planning_rows_guard_intended before insert or update on public.scheduling_planning_rows for each row execute function public.scheduling_guard_intended_planning_row();

revoke all on function public.scheduling_agent_team_read_planning_intents(bigint),public.scheduling_agent_team_save_planning_baseline(bigint,text,bigint),public.scheduling_agent_team_save_intended_instructor(text,bigint,text,text,bigint),public.scheduling_guard_intended_instructor(),public.scheduling_guard_intended_planning_row() from public,anon;
grant execute on function public.scheduling_agent_team_read_planning_intents(bigint),public.scheduling_agent_team_save_planning_baseline(bigint,text,bigint),public.scheduling_agent_team_save_intended_instructor(text,bigint,text,text,bigint) to authenticated;
notify pgrst,'reload schema';
