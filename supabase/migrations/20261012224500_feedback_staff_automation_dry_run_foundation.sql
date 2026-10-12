-- Dry-run foundation for school-year 2027 educational-staff automatic feedback.
-- This migration intentionally installs NO cron and sends NO email.
-- Exact population: visible, unfiltered staff rows from feedback_admin_groups
-- (school_2027, start within year, non-excluded, consolidated by course/contact/school).
create table if not exists public.feedback_staff_auto_outbox (
 id uuid primary key default gen_random_uuid(),
 group_key text not null,
 stage text not null check (stage in ('pre','final')),
 activity_row_id text not null,
 member_row_ids text[] not null default '{}',
 program_key text not null,
 contact_id bigint not null,
 recipient_email text not null,
 campaign_id uuid references public.feedback_campaigns(id),
 recipient_id uuid references public.feedback_recipients(id),
 eligibility_at timestamptz not null,
 send_after timestamptz not null,
 status text not null default 'pending' check(status in ('pending','sending','accepted','failed','unknown','cancelled')),
 attempts integer not null default 0,
 last_http_status integer,
 graph_request_id text,
 last_error text,
 claimed_at timestamptz,
 accepted_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(group_key,stage)
);
alter table public.feedback_staff_auto_outbox enable row level security;
revoke all on public.feedback_staff_auto_outbox from public, anon, authenticated;
grant select,insert,update on public.feedback_staff_auto_outbox to service_role;
create index if not exists feedback_staff_auto_outbox_due_idx
 on public.feedback_staff_auto_outbox(status,send_after);
comment on table public.feedback_staff_auto_outbox is
 'Disabled until explicit production approval; one dispatch per unfiltered staff row and stage.';

-- Read-only preview. No RPC may send mail or create feedback campaigns.
-- Do not call feedback_admin_groups with a service JWT: its authenticated viewer
-- gate rejects service role. Instead replicate its activity source and the exact
-- grouping/tie-breaking rules of groupsTableHtml(...,'staff').
create or replace function public.feedback_staff_auto_candidates(
 p_now timestamptz default now()
)
returns table(
 group_key text,
 cohort text,
 representative_row_id text,
 member_row_ids text[],
 program_key text,
 school text,
 contact_name text,
 contact_id bigint,
 contact_email text,
 stage text,
 eligibility_at timestamptz,
 status text,
 scheduled_count integer,
 total_meetings integer
)
language sql stable security definer set search_path = '' as $fn$
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
       and c.stage in ('pre','final')
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
   and (
     r.program_key is not null or r.source is not null
     or private.feedback_is_course_activity(to_jsonb(a))
   )
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
    (select max(os.ends_at) from ordered_slots os where os.row_key=s.row_key) as after_last,
    case when s.sessions ~ '^[0-9]{1,2}$' then s.sessions::int end as expected_count
 from selected s
),
expanded as (
 select s.*,x.stage,
   case when x.stage='pre' then c.after_second
        when c.expected_count is not null and c.expected_count>0
          and c.total_scheduled>=c.expected_count then c.after_last end as due_at,
   c.active_scheduled,c.expected_count
 from selected s
 join counts c on c.row_key=s.row_key
 cross join (values('pre'),('final')) x(stage)
)
select
 e.row_key,e.cohort,e.row_id,e.members,e.program_key,e.school,
 e.contact_name,e.school_contact_id,e.contact_email,e.stage,e.due_at,
 case
   when e.program_key is null then 'unresolved_program'
   when e.school_contact_id is null
     or not exists(select 1 from public.contacts_schools cs where cs.id=e.school_contact_id)
     then 'missing_selected_contact'
   when e.contact_email is null
     or e.contact_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+[.][A-Z]{2,}$'
     then 'missing_contact_email'
   when e.end_time is null then 'missing_end_time'
   when e.due_at is null then 'unscheduled'
   when e.due_at > p_now then 'not_due'
   else 'eligible'
 end as status,
 e.active_scheduled,e.expected_count
from expanded e
order by e.cohort,e.row_id,e.stage
$fn$;
revoke all on function public.feedback_staff_auto_candidates(timestamptz) from public, anon, authenticated;
grant execute on function public.feedback_staff_auto_candidates(timestamptz) to service_role;
comment on function public.feedback_staff_auto_candidates(timestamptz) is
 'Read-only, service-role preview only; does not queue, open campaigns, or email.';

-- A safe, read-only report for the existing admin during simulation, without
-- exposing contact addresses to unauthenticated users.
create or replace function public.feedback_staff_auto_dry_run_summary(
 p_now timestamptz default now()
)
returns table(stage text,status text,group_count bigint)
language plpgsql stable security definer set search_path = '' as $fn$
begin
 if not private.feedback_is_admin() then
    raise exception 'feedback_forbidden' using errcode='42501';
 end if;
 return query select c.stage,c.status,count(*) from
    public.feedback_staff_auto_candidates(p_now) c
    group by c.stage,c.status order by c.stage,c.status;
end
$fn$;
revoke all on function public.feedback_staff_auto_dry_run_summary(timestamptz) from public, anon;
grant execute on function public.feedback_staff_auto_dry_run_summary(timestamptz) to authenticated;
