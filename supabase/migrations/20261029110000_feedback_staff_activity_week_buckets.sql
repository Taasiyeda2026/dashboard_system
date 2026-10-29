-- Per-activity stage eligibility, batched only after the same weekly or daily
-- dispatch period; retain merged dashboard and legacy accepted outbox history.
-- Week ending Thursday for pre/mid, eligible local day for final.
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
   -- Match feedback_admin_groups: do not send staff surveys for unassigned,
   -- unlocked activities that are intentionally hidden from feedback UI.
   and a.instructor_assignment_locked is true
   and (a.emp_id is not null or nullif(btrim(a.emp_id_2),'') is not null)
),
keyed as (
 select b.*,md5(jsonb_build_array(b.cohort,b.program_key,
   lower(btrim(regexp_replace(b.contact_name,'[[:space:]]+',' ','g'))),
   lower(btrim(regexp_replace(b.school,'[[:space:]]+',' ','g'))),
   b.school_contact_id)::text) as base_key
 from base b where not b.excluded
),
source_slots as (
 select s.row_id, n as slot,
   (to_jsonb(a)->>('date_'||n))::date as meeting_date
 from keyed s
 join public.activities a on a.row_id=s.row_id
 cross join generate_series(1,35) n
 where (to_jsonb(a)->>('date_'||n)) is not null
),
valid_slots as (
 select sl.row_id,sl.slot,sl.meeting_date,
  (sl.meeting_date +
    public.scheduling_effective_end_time(a.row_id,sl.meeting_date,a.end_time))
      at time zone 'Asia/Jerusalem' as ends_at
 from source_slots sl
 join keyed s on s.row_id=sl.row_id
 join public.activities a on a.row_id=s.row_id
 where not exists (
   select 1 from public.course_meeting_cancellations x
   where x.activity_id=s.row_id and x.meeting_date=sl.meeting_date
 )
),
ordered_slots as (
 select v.*,row_number() over(partition by v.row_id order by v.meeting_date,v.slot) as ordinal
 from valid_slots v
),
counts as (
 select s.row_id,
    (select count(*)::int from source_slots sl where sl.row_id=s.row_id) as total_scheduled,
    (select count(*)::int from ordered_slots os where os.row_id=s.row_id) as active_scheduled,
    (select os.ends_at from ordered_slots os where os.row_id=s.row_id and os.ordinal=2) as after_second,
    (select os.ends_at from ordered_slots os where os.row_id=s.row_id and os.ordinal =
      greatest(1,ceil((case when s.sessions ~ '^[0-9]{1,2}$' then s.sessions::int
       else (select count(*) from ordered_slots os2 where os2.row_id=s.row_id) end)/2.0)::int)) as after_half,
    (select max(os.ends_at) from ordered_slots os where os.row_id=s.row_id) as after_last,
    case when s.sessions ~ '^[0-9]{1,2}$' then s.sessions::int end as expected_count
 from keyed s
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
 from keyed s
 join counts c on c.row_id=s.row_id
 cross join (values('pre'),('mid'),('final')) x(stage)

),
stage_batches as (
 select e.*,
   md5(jsonb_build_array(e.base_key,e.stage,
    coalesce(
     (case
       when e.stage='pre' then e.start_date+((4-extract(dow from e.start_date)::int+7)%7)
       when e.stage='mid' and e.due_at is not null then
          (e.due_at at time zone 'Asia/Jerusalem')::date+
          ((4-extract(dow from (e.due_at at time zone 'Asia/Jerusalem')::date)::int+7)%7)
       when e.stage='final' and e.due_at is not null then
          (e.due_at at time zone 'Asia/Jerusalem')::date
      end)::text,
      'unscheduled:'||e.row_id))::text) as batch_key,
   exists(select 1 from public.feedback_responses r
     join public.feedback_campaigns fc on fc.id=r.campaign_id
     where fc.activity_row_id=e.row_id and fc.audience='educational_staff'
       and fc.stage=e.stage) as already_answered
 from expanded e
),
ranked_batches as (
 select b.*,row_number() over(partition by b.batch_key
   order by b.already_answered asc,b.staff_coverage desc,b.has_campaign desc,
   b.end_date desc nulls last,b.start_date,b.row_id) as batch_rank
 from stage_batches b
),
summarized as (
 select batch_key,array_agg(row_id order by row_id) member_row_ids,
   case when bool_and(due_at is not null) then max(due_at) end eligibility_at,
   max(active_scheduled) active_scheduled,max(expected_count) expected_count
 from stage_batches group by batch_key
),
selected_batches as (
 select r.*,s.member_row_ids,s.eligibility_at,s.active_scheduled group_active,
    s.expected_count group_expected
 from ranked_batches r join summarized s on s.batch_key=r.batch_key
 where r.batch_rank=1
)
select
 e.batch_key,e.cohort,e.row_id,e.member_row_ids,e.program_key,e.school,
 e.contact_name,e.school_contact_id,e.contact_email,e.stage,e.eligibility_at,
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
   when e.eligibility_at is null then 'unscheduled'
   when greatest(e.eligibility_at,coalesce((
     select (sc.send_on+time '08:00') at time zone 'Asia/Jerusalem'
     from public.feedback_staff_send_schedules sc
     where sc.group_key=e.batch_key and sc.stage=e.stage
   ),e.eligibility_at)) > p_now then 'not_due'
   else 'eligible'
 end as status,
 e.group_active,e.group_expected
from selected_batches e
order by e.cohort,e.row_id,e.stage
$function$;