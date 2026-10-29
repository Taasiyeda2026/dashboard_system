-- Only PRE and MID are weekly. Existing final dispatch remains daily.
-- Keep the same secured cron worker and validate the weekday per stage.
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
   case when x.stage='pre' then (s.start_date::timestamp at time zone 'Asia/Jerusalem')
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
   -- Weekly opening cohort: Friday through Thursday, never before the activity start.
   -- A rolling seven-day cohort avoids losing Friday/Saturday course starts.
   when e.stage in ('pre','mid')
     and extract(isodow from p_now at time zone 'Asia/Jerusalem')<>4
     then 'not_due'
   when e.stage='pre' and (
      e.start_date < ((p_now at time zone 'Asia/Jerusalem')::date - 6)
      or e.start_date > (p_now at time zone 'Asia/Jerusalem')::date
   ) then 'not_due'
   when e.stage='final' and (p_now at time zone 'Asia/Jerusalem')::date < date '2026-11-20'
     then 'not_due'
   when e.program_key is null then 'unresolved_program'
   when e.school_contact_id is null
     or not exists(select 1 from public.contacts_schools cs where cs.id=e.school_contact_id)
     then 'missing_selected_contact'
   when e.contact_email is null
     or e.contact_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+[.][A-Z]{2,}$'
     then 'missing_contact_email'
   when e.stage <> 'pre' and e.end_time is null then 'missing_end_time'
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

CREATE OR REPLACE FUNCTION public.feedback_staff_auto_prepare(p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c record; ctl public.feedback_staff_auto_control; existing public.feedback_staff_auto_outbox;
 due timestamptz; n integer:=0;
begin
 select * into ctl from public.feedback_staff_auto_control where singleton;
 if not coalesce(ctl.enabled,false) or ctl.activation_at is null then return '{"disabled":true,"prepared":0}'::jsonb; end if;
 if extract(hour from p_now at time zone 'Asia/Jerusalem')<>7
    or extract(minute from p_now at time zone 'Asia/Jerusalem')<>59 then return '{"outside_window":true}'::jsonb; end if;
 perform pg_advisory_xact_lock(2027,805);
 due:=(((p_now at time zone 'Asia/Jerusalem')::date + time '08:00') at time zone 'Asia/Jerusalem');
 for c in select * from public.feedback_staff_auto_candidates(p_now)
   where status='eligible' and (eligibility_at>=ctl.activation_at or stage='pre') loop
   -- Accepted / ambiguous / in-flight deliveries block the entire merged row,
   -- including later renamed/split/merged groups sharing any historical member.
   if exists(select 1 from public.feedback_staff_auto_outbox o where o.stage=c.stage
     and (o.group_key=c.group_key or o.member_row_ids && c.member_row_ids)
     and o.status in ('accepted','unknown','sending')) then continue; end if;
   select * into existing from public.feedback_staff_auto_outbox o
     where o.stage=c.stage and (o.group_key=c.group_key or o.member_row_ids && c.member_row_ids)
     order by (o.group_key=c.group_key) desc,o.created_at limit 1 for update;
   if existing.id is not null then
     -- Recheck recoverable pre-send failures when source details are corrected.
     -- Never retry a failed or ambiguous delivery after a Graph attempt.
     if existing.status in ('failed','needs_attention') and existing.graph_started_at is not null then continue; end if;
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
end $function$
;

CREATE OR REPLACE FUNCTION public.feedback_staff_auto_claim(p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
   if not found or c.status<>'eligible' or (c.eligibility_at<ctl.activation_at and o.stage<>'pre')
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
     'token',link->>'token','contact_name',
      coalesce((select cs.contact_name from public.contacts_schools cs where cs.id=o.contact_id),''),
      'program_title',
     (select title from public.feedback_programs where key=o.program_key));
 end loop;
 return '{}'::jsonb;
end $function$
;

select cron.alter_job(jobid, schedule => '59 4,5 * * *')
from cron.job where jobname = 'feedback-staff-prepare';
select cron.alter_job(jobid, schedule => '*/5 5,6 * * *')
from cron.job where jobname = 'feedback-staff-dispatch';