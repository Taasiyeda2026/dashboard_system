
-- Scheduling is an admin-owned postponement of staff feedback, not an alternate mail sender.
-- No stored survey tokens, personal mail addresses, or direct public table access.
create table if not exists public.feedback_staff_send_schedules (
  group_key text not null,
  stage text not null check (stage in ('pre','mid','final')),
  send_on date not null,
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (group_key,stage)
);
alter table public.feedback_staff_send_schedules enable row level security;
revoke all on public.feedback_staff_send_schedules from anon,authenticated;

create or replace function public.feedback_staff_admin_schedule(
  p_activity_row_id text,p_stage text,p_send_on date default null)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare c record; v_today date := (now() at time zone 'Asia/Jerusalem')::date;
begin
 if not private.feedback_is_admin() then
   raise exception 'feedback_forbidden' using errcode='42501';
 end if;
 if p_stage not in ('pre','mid','final') then
   raise exception 'feedback_invalid_stage' using errcode='22023';
 end if;
 -- Serialize with the existing 08:00 delivery claim.
 perform pg_advisory_xact_lock(2027,805);
 select * into c from public.feedback_staff_auto_candidates(now()) k
 where p_activity_row_id=any(k.member_row_ids) and k.stage=p_stage limit 1;
 if not found then raise exception 'feedback_staff_group_not_found' using errcode='22023'; end if;
 if exists(select 1 from public.feedback_staff_auto_outbox o
   where o.stage=p_stage and (o.group_key=c.group_key or o.member_row_ids && c.member_row_ids)
   and o.status in ('accepted','sending','unknown')) then
   raise exception 'feedback_staff_already_dispatched' using errcode='22023';
 end if;
 if p_send_on is null then
   delete from public.feedback_staff_send_schedules where group_key=c.group_key and stage=p_stage;
   return jsonb_build_object('group_key',c.group_key,'stage',p_stage,'mode','automatic');
 end if;
 if p_send_on <= v_today or p_send_on > v_today+365 then
   raise exception 'feedback_invalid_future_date' using errcode='22023';
 end if;
 if p_stage='pre' and exists (
   select 1 from public.activities a where a.row_id=c.representative_row_id and a.start_date<=p_send_on
 ) then
   raise exception 'feedback_pre_must_be_before_course' using errcode='22023';
 end if;
 insert into public.feedback_staff_send_schedules(group_key,stage,send_on,created_by)
 values(c.group_key,p_stage,p_send_on,auth.uid())
 on conflict (group_key,stage) do update set send_on=excluded.send_on, updated_at=now(), created_by=auth.uid();
 -- An already prepared but not dispatched row must not bypass a postponement.
 update public.feedback_staff_auto_outbox o
 set send_after=greatest(o.send_after,(p_send_on + time '08:00') at time zone 'Asia/Jerusalem'),
     updated_at=now()
 where o.stage=p_stage
   and (o.group_key=c.group_key or o.member_row_ids && c.member_row_ids)
   and o.status='pending';
 return jsonb_build_object('group_key',c.group_key,'stage',p_stage,'send_on',p_send_on,'mode','scheduled');
end $fn$;
revoke all on function public.feedback_staff_admin_schedule(text,text,date) from public,anon;
grant execute on function public.feedback_staff_admin_schedule(text,text,date) to authenticated;

create or replace function public.feedback_staff_send_plan()
returns table(activity_row_ids text[],stage text,automatic_due_at timestamptz,send_on date,eligibility_status text)
language plpgsql stable security definer set search_path='' as $fn$
begin
 if not private.feedback_can_view_results() then
   raise exception 'feedback_forbidden' using errcode='42501';
 end if;
 return query
 select c.member_row_ids,c.stage,c.eligibility_at,s.send_on,c.status
 from public.feedback_staff_auto_candidates(now()) c
 left join public.feedback_staff_send_schedules s
   on s.group_key=c.group_key and s.stage=c.stage;
end $fn$;
revoke all on function public.feedback_staff_send_plan() from public,anon;
grant execute on function public.feedback_staff_send_plan() to authenticated;

CREATE OR REPLACE FUNCTION public.feedback_staff_auto_candidates(p_now timestamp with time zone DEFAULT now())
 RETURNS TABLE(group_key text, cohort text, representative_row_id text, member_row_ids text[], program_key text, school text, contact_name text, contact_id bigint, contact_email text, stage text, eligibility_at timestamp with time zone, status text, scheduled_count integer, total_meetings integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
with base as (
 select
   a.row_id,
   a.start_date,
   a.end_date,
   a.school,
   a.sessions,
   a.end_time,
   a.school_contact_id,
   coalesce(cs.contact_name,a.contact_name,'') as contact_name,
   nullif(btrim(cs.email),'') as contact_email,
   r.program_key,
   coalesce(r.excluded,false) as excluded,
   case when a.start_date >= date '2027-01-01' then 'second' else 'first' end as cohort,
   (
     select count(distinct c.stage)::int
     from public.feedback_campaigns c
     where c.activity_row_id = a.row_id
       and c.audience = 'educational_staff'
       and c.stage in ('pre','mid','final')
   ) as staff_coverage,
   exists(select 1 from public.feedback_campaigns c where c.activity_row_id=a.row_id) as has_campaign
 from public.activities a
 left join public.contacts_schools cs on cs.id=a.school_contact_id
 left join lateral (
   select program_key, excluded, source
   from private.feedback_activity_program(to_jsonb(a)) limit 1
 ) r on true
 where a.activity_season = 'school_2027'
   and a.start_date between date '2026-09-01' and date '2027-06-30'
   -- Educational-staff end feedback belongs to courses only (never tours
   -- or workshops), regardless of administrative activity.status.
   and private.feedback_is_course_activity(to_jsonb(a))
),
keyed as (
 select b.*,
   case when b.contact_name <> '' and b.school <> '' and b.program_key is not null
      then md5(jsonb_build_array(b.cohort,b.program_key,
        lower(btrim(regexp_replace(b.contact_name,'[[:space:]]+',' ','g'))),
        lower(btrim(regexp_replace(b.school,'[[:space:]]+',' ','g'))))::text)
      else md5(jsonb_build_array('unidentified',b.row_id)::text)
   end as row_key
 from base b where not b.excluded
),
ranked as (
 select k.*,
  row_number() over(partition by k.row_key
    order by k.staff_coverage desc,k.has_campaign desc,
             k.end_date desc nulls last,k.start_date asc,k.school asc,k.row_id asc) as representative_rank,
  array_agg(k.row_id) over(partition by k.row_key) as members
 from keyed k
),
selected as (select * from ranked where representative_rank=1),
source_slots as (
 select s.row_key, n as slot,
   (to_jsonb(a)->>('date_'||n))::date as meeting_date
 from selected s
 join public.activities a on a.row_id=s.row_id
 cross join generate_series(1,35) n
 where (to_jsonb(a)->>('date_'||n)) is not null
),
valid_slots as (
 select sl.row_key,sl.slot,sl.meeting_date,
  (sl.meeting_date +
    public.scheduling_effective_end_time(a.row_id,sl.meeting_date,a.end_time))
      at time zone 'Asia/Jerusalem' as ends_at
 from source_slots sl
 join selected s on s.row_key=sl.row_key
 join public.activities a on a.row_id=s.row_id
 where not exists (
   select 1 from public.course_meeting_cancellations x
   where x.activity_id=s.row_id and x.meeting_date=sl.meeting_date
 )
),
ordered_slots as (
 select v.*,row_number() over(partition by v.row_key order by v.meeting_date,v.slot) as ordinal
 from valid_slots v
),
counts as (
 select s.row_key,
    (select count(*)::int from source_slots sl where sl.row_key=s.row_key) as total_scheduled,
    (select count(*)::int from ordered_slots os where os.row_key=s.row_key) as active_scheduled,
    (select os.ends_at from ordered_slots os where os.row_key=s.row_key and os.ordinal=2) as after_second,
    (select os.ends_at from ordered_slots os where os.row_key=s.row_key and os.ordinal =
      greatest(1,ceil((case when s.sessions ~ '^[0-9]{1,2}$' then s.sessions::int
       else (select count(*) from ordered_slots os2 where os2.row_key=s.row_key) end)/2.0)::int)) as after_half,
    (select max(os.ends_at) from ordered_slots os where os.row_key=s.row_key) as after_last,
    case when s.sessions ~ '^[0-9]{1,2}$' then s.sessions::int end as expected_count
 from selected s
),
expanded as (
 select s.*,x.stage,
   case when x.stage='pre' then ((s.start_date - interval '2 days')::timestamp at time zone 'Asia/Jerusalem')
        when x.stage='mid' then c.after_half
        -- Only an actually finished course is final-feedback eligible:
        -- its official end date is past, all expected ACTIVE meetings have
        -- happened (cancelled sessions need a replacement), and neither the
        -- final meeting nor the declared end date lies in the future.
        -- Waiting until midnight after end_date avoids premature 05:00 sends.
        when c.expected_count is not null and c.expected_count>0
          and c.active_scheduled>=c.expected_count
          and s.end_date is not null and c.after_last is not null
          then greatest(c.after_last,
            (s.end_date + 1)::timestamp at time zone 'Asia/Jerusalem')
   end as due_at,
   c.active_scheduled,c.expected_count
 from selected s
 join counts c on c.row_key=s.row_key
 cross join (values('pre'),('mid'),('final')) x(stage)
)
select
 e.row_key,e.cohort,e.row_id,e.members,e.program_key,e.school,
 e.contact_name,e.school_contact_id,e.contact_email,e.stage,e.due_at,
 case
   -- The supplemental completed-course final check starts on Nov 20, 2026.
   -- The pre-feedback channel is unchanged. The status of the activity
   -- ('פתוח'/'סגור') is deliberately NOT a filter.
   when e.stage='pre' and e.start_date <= (p_now at time zone 'Asia/Jerusalem')::date
     then 'not_due'
   when e.stage='final' and (p_now at time zone 'Asia/Jerusalem')::date < date '2026-11-20'
     then 'not_due'
   when e.program_key is null then 'unresolved_program'
   when e.school_contact_id is null
     or not exists(select 1 from public.contacts_schools cs where cs.id=e.school_contact_id)
     then 'missing_selected_contact'
   when e.contact_email is null
     or e.contact_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+[.][A-Z]{2,}$'
     then 'missing_contact_email'
   when e.end_time is null then 'missing_end_time'
   when e.due_at is null then 'unscheduled'
   when greatest(e.due_at,coalesce((
     select sc.send_on::timestamp at time zone 'Asia/Jerusalem'
     from public.feedback_staff_send_schedules sc
     where sc.group_key=e.row_key and sc.stage=e.stage
   ),e.due_at)) > p_now then 'not_due'
   else 'eligible'
 end as status,
 e.active_scheduled,e.expected_count
from expanded e
order by e.cohort,e.row_id,e.stage
$function$
;
