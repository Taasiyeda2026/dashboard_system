
-- Four missing recurring routes: student pre/post, instructor final/final_b;
-- and admin-scheduled instructor pre. Staff pre/final continue on the existing jobs.
-- This migration installs NO active dispatch jobs until end-to-end checks pass.

create table if not exists public.feedback_auto_control (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  activated_at timestamptz,
  created_at timestamptz not null default now()
);
insert into public.feedback_auto_control(singleton,enabled) values(true,false) on conflict do nothing;
alter table public.feedback_auto_control enable row level security;
revoke all on public.feedback_auto_control from public,anon,authenticated;
grant select on public.feedback_auto_control to service_role;

create table if not exists public.feedback_auto_pre_requests (
  instructor_emp_id text not null,
  program_key text not null references public.feedback_programs(key),
  academic_year text not null default 'school_2027',
  send_at timestamptz not null,
  status text not null default 'scheduled' check(status in ('scheduled','cancelled')),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key(instructor_emp_id,program_key,academic_year)
);
alter table public.feedback_auto_pre_requests enable row level security;
revoke all on public.feedback_auto_pre_requests from public,anon,authenticated;
grant select,insert,update,delete on public.feedback_auto_pre_requests to service_role;

create table if not exists public.feedback_auto_delivery (
  id uuid primary key default gen_random_uuid(),
  delivery_key text not null unique,
  audience text not null check(audience in ('student','instructor')),
  stage text not null check(stage in ('pre','post','final','final_b')),
  academic_year text not null default 'school_2027',
  activity_row_id text,
  program_key text not null references public.feedback_programs(key),
  instructor_emp_id text not null,
  campaign_id uuid references public.feedback_campaigns(id),
  recipient_id uuid references public.feedback_recipients(id),
  recipient_email text,
  cc_email text,
  eligible_at timestamptz not null,
  send_after timestamptz not null,
  status text not null default 'pending'
    check(status in ('pending','claimed','sending','accepted','failed','unknown','needs_attention','invalidated','cancelled')),
  error_code text,
  attempts integer not null default 0,
  claim_token uuid,
  claimed_at timestamptz,
  graph_started_at timestamptz,
  accepted_at timestamptz,
  graph_status integer,
  graph_request_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.feedback_auto_delivery enable row level security;
revoke all on public.feedback_auto_delivery from public,anon,authenticated;
grant select,insert,update on public.feedback_auto_delivery to service_role;
create index if not exists feedback_auto_delivery_due_idx
  on public.feedback_auto_delivery(send_after,status);

create or replace function public.feedback_auto_schedule_instructor_pre(
  p_instructor_emp_id text,p_program_key text,p_send_at timestamptz,
  p_academic_year text default 'school_2027'
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_campaign uuid; v_row public.feedback_auto_pre_requests;
begin
 if not private.feedback_is_admin() then raise exception 'feedback_forbidden' using errcode='42501'; end if;
 if p_academic_year <> 'school_2027' or p_send_at <= now() + interval '2 minutes'
 then raise exception 'feedback_invalid_schedule'; end if;
 if p_send_at >= timestamptz '2027-08-01 00:00:00+00' then raise exception 'feedback_invalid_schedule'; end if;
 if not exists (select 1 from public.contacts_instructors i where i.emp_id::text=p_instructor_emp_id and
    i.email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+[.][A-Z]{2,}$')
 then raise exception 'feedback_instructor_invalid_email'; end if;
 if not exists(select 1 from public.feedback_templates t where t.program_key=p_program_key and
    t.audience='instructor' and t.stage='pre' and t.current_version_id is not null)
 then raise exception 'feedback_template_not_published'; end if;
 if not exists(
  select 1 from public.activities a
  cross join lateral private.feedback_activity_program(to_jsonb(a)) r
  where a.activity_season=p_academic_year and a.instructor_assignment_locked
    and private.feedback_is_course_activity(to_jsonb(a))
    and (a.emp_id::text=p_instructor_emp_id or a.emp_id_2=p_instructor_emp_id)
    and r.program_key=p_program_key and not r.excluded
 ) then raise exception 'feedback_instructor_not_assigned'; end if;
 select c.id into v_campaign from public.feedback_campaigns c
 where c.audience='instructor' and c.stage='pre' and c.instructor_emp_id=p_instructor_emp_id
 and c.program_key=p_program_key and c.academic_year=p_academic_year;
 if v_campaign is not null and exists(
  select 1 from public.feedback_recipients r where r.campaign_id=v_campaign
   and (r.last_shared_at is not null or r.completed_at is not null)
 ) then raise exception 'feedback_already_shared'; end if;
 if exists(select 1 from public.feedback_auto_delivery d where d.audience='instructor' and d.stage='pre'
 and d.instructor_emp_id=p_instructor_emp_id and d.program_key=p_program_key and
 d.academic_year=p_academic_year and d.status in ('claimed','sending','accepted','unknown'))
 then raise exception 'feedback_already_sending'; end if;
 insert into public.feedback_auto_pre_requests(instructor_emp_id,program_key,academic_year,send_at,status)
 values(p_instructor_emp_id,p_program_key,p_academic_year,p_send_at,'scheduled')
 on conflict(instructor_emp_id,program_key,academic_year)
 do update set send_at=excluded.send_at,status='scheduled',updated_at=now()
 returning * into v_row;
 return jsonb_build_object('scheduled',true,'instructor_emp_id',v_row.instructor_emp_id,
   'program_key',v_row.program_key,'send_at',v_row.send_at);
end $$;
revoke all on function public.feedback_auto_schedule_instructor_pre(text,text,timestamptz,text)
 from public,anon,authenticated;
grant execute on function public.feedback_auto_schedule_instructor_pre(text,text,timestamptz,text) to authenticated;

-- Every candidate below has a durable business key, and is recomputed immediately
-- before sending. Never assume that a past date alone proves a lesson happened.
create or replace function public.feedback_auto_candidates(p_now timestamptz default now())
returns table (
 delivery_key text,audience text,stage text,academic_year text,
 activity_row_id text,program_key text,instructor_emp_id text,
 eligible_at timestamptz,recipient_email text,cc_email text,
 recipient_name text,school_name text,authority_name text,
 grade text,class_group text,activity_name text,
 activity_start_date date,activity_end_date date,age_band text
)
language sql stable security definer set search_path=''
as $fn$
with shaped as materialized (
 select a.*,r.program_key,p.default_age_band,
   coalesce(r.excluded,false) excluded
 from public.activities a
 cross join lateral (select * from private.feedback_activity_program(to_jsonb(a)) limit 1) r
 join public.feedback_programs p on p.key=r.program_key and p.is_active
 where a.activity_season='school_2027'
   and private.feedback_is_course_activity(to_jsonb(a))
   and a.instructor_assignment_locked
   and a.start_date between date '2026-09-01' and date '2027-06-30'
   and not r.excluded
),
slots as (
 select a.row_id,n as slot,(to_jsonb(a)->>('date_'||n))::date as dt,
   a.end_time
 from shaped a cross join generate_series(1,35) n
 where (to_jsonb(a)->>('date_'||n)) is not null
),
active_slots as (
 select s.*,
   row_number() over(partition by s.row_id order by s.dt,s.slot) ordinal,
   count(*) over(partition by s.row_id) active_count
 from slots s where not exists(
   select 1 from public.course_meeting_cancellations x
   where x.activity_id=s.row_id and x.meeting_date=s.dt
 )
),
student_trigger as (
 select a.*,first_s.dt first_meeting, last_s.dt third_last_meeting,
   first_s.slot first_slot,last_s.slot third_last_slot, last_s.active_count,
   (case when a.sessions ~ '^[0-9]{1,2}$' then a.sessions::int end) expected_sessions
 from shaped a
 left join active_slots first_s on first_s.row_id=a.row_id and first_s.ordinal=1
 left join active_slots last_s on last_s.row_id=a.row_id and last_s.ordinal=last_s.active_count-2
),
student as (
 select
  'student:'||a.row_id||':'||v.stage||':'||i.emp_id::text delivery_key,
  'student'::text audience,v.stage,'school_2027'::text academic_year,
  a.row_id activity_row_id,a.program_key,i.emp_id::text instructor_emp_id,
  (v.dt + coalesce(public.scheduling_effective_end_time(a.row_id,v.dt,a.end_time),
     a.end_time,time '23:59:59')) at time zone 'Asia/Jerusalem' eligible_at,
  ci.email recipient_email,
  (select max(u.email) from public.users u where btrim(u.full_name)=btrim(a.activity_manager)
    and u.role='activities_manager' and u.is_active=true) cc_email,
  ci.full_name recipient_name,a.school school_name,a.authority authority_name,
  a.grade,a.class_group,a.activity_name,a.start_date activity_start_date,
  a.end_date activity_end_date,
  coalesce(private.feedback_age_band(a.grade),a.default_age_band) age_band
 from student_trigger a
 cross join lateral (values (a.emp_id),(case when a.emp_id_2 ~ '^[0-9]+$' then a.emp_id_2::bigint end)) i(emp_id)
 join public.contacts_instructors ci on ci.emp_id=i.emp_id
 cross join lateral (values ('pre'::text,a.first_meeting,a.first_slot),('post'::text,a.third_last_meeting,a.third_last_slot))
    v(stage,dt,slot)
 where a.start_date < date '2027-01-31'
 and i.emp_id is not null and v.dt is not null
 and v.dt < (p_now at time zone 'Asia/Jerusalem')::date
 and (v.stage='pre' or (a.active_count >= 3 and a.expected_sessions is not null
     and a.active_count >= a.expected_sessions))
 and exists(
  select 1 from public.attendance_records ar
  where ar.activity_row_id=a.row_id
    and ar.report_date=v.dt
    and ar.generation_kind is null
    and ar.total_hours>0
    and (ar.meeting_no=v.slot or ar.meeting_no is null)
    and ar.activity_type in ('קורס','course','חוג','תוכנית')
 )
),
instructor_assignment as (
 select sh.row_id,sh.program_key,sh.start_date,sh.end_date,i.emp_id::text emp_id
 from shaped sh
 cross join lateral (values (sh.emp_id),(case when sh.emp_id_2 ~ '^[0-9]+$'
   then sh.emp_id_2::bigint end)) i(emp_id)
 where i.emp_id is not null and sh.end_date is not null
),
personal_final as (
 select
 'instructor:'||v.stage||':'||a.program_key||':'||a.emp_id delivery_key,
 'instructor'::text audience,v.stage,'school_2027'::text academic_year,
 null::text activity_row_id,a.program_key,a.emp_id instructor_emp_id,
 (max(a.end_date)+1)::timestamp at time zone 'Asia/Jerusalem' eligible_at,
 ci.email recipient_email,null::text cc_email,ci.full_name recipient_name,
 ''::text school_name,''::text authority_name,''::text grade,''::text class_group,
 ''::text activity_name,min(a.start_date) activity_start_date,
 max(a.end_date) activity_end_date,null::text age_band
 from instructor_assignment a
 join public.contacts_instructors ci on ci.emp_id::text=a.emp_id
 cross join lateral (values
  ('final'::text,a.start_date < date '2027-01-31'),
  ('final_b'::text,a.start_date >= date '2027-01-31')
 ) v(stage,selected)
 where v.selected and a.start_date <= date '2027-06-30'
 group by v.stage,a.program_key,a.emp_id,ci.email,ci.full_name
),
personal_pre as (
 select 'instructor:pre:'||req.program_key||':'||req.instructor_emp_id delivery_key,
 'instructor'::text audience,'pre'::text stage,req.academic_year,
 null::text activity_row_id,req.program_key,req.instructor_emp_id,req.send_at eligible_at,
 ci.email recipient_email,null::text cc_email,ci.full_name recipient_name,
 ''::text school_name,''::text authority_name,''::text grade,''::text class_group,
 ''::text activity_name,null::date activity_start_date,null::date activity_end_date,
 null::text age_band
 from public.feedback_auto_pre_requests req
 join public.contacts_instructors ci on ci.emp_id::text=req.instructor_emp_id
 where req.status='scheduled' and req.academic_year='school_2027'
 and exists (select 1 from instructor_assignment a
    where a.emp_id=req.instructor_emp_id and a.program_key=req.program_key)
)
select * from student
union all select * from personal_final
union all select * from personal_pre;
$fn$;
revoke all on function public.feedback_auto_candidates(timestamptz) from public,anon,authenticated;
grant execute on function public.feedback_auto_candidates(timestamptz) to service_role;
notify pgrst,'reload schema';
