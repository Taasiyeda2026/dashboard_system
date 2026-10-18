-- Scoped permanent-course approvals. A blocked lesson is NOT an instructor assignment.
-- These records grant no availability, no calendar override, and no exemption from other hard gates.

create table if not exists public.scheduling_permanent_availability_approvals (
  id uuid primary key default gen_random_uuid(),
  activity_id text not null references public.activities(row_id) on delete cascade,
  emp_id bigint not null references public.contacts_instructors(emp_id),
  scope_start date not null,
  scope_end date not null,
  reason text not null check (length(btrim(reason)) >= 12),
  approved_by uuid not null,
  approved_at timestamptz not null default clock_timestamp(),
  revoked_by uuid,
  revoked_at timestamptz,
  constraint scheduling_permanent_availability_scope_dates check (scope_start <= scope_end),
  constraint scheduling_permanent_availability_revocation check ((revoked_at is null) = (revoked_by is null))
);
create index if not exists scheduling_permanent_availability_lookup_idx
  on public.scheduling_permanent_availability_approvals(activity_id,emp_id,scope_start,scope_end)
  where revoked_at is null;
alter table public.scheduling_permanent_availability_approvals enable row level security;
revoke all on public.scheduling_permanent_availability_approvals from public,anon,authenticated;

alter table public.course_meeting_instructor_history
  add column if not exists availability_approval_id uuid
    references public.scheduling_permanent_availability_approvals(id);
alter table public.course_meeting_instructor_history
  drop constraint if exists course_meeting_instructor_history_assignment_kind_check;
alter table public.course_meeting_instructor_history
  add constraint course_meeting_instructor_history_assignment_kind_check
  check (assignment_kind in ('history','single_meeting_substitution','availability_blocked_pending'));

-- Nobody may forge a pending-unassigned history row through ordinary table writes.
-- The historical table already has RLS. The new status is created only by a
-- security-definer confirmation RPC and not by a browser-issued INSERT.
create or replace function public.scheduling_approve_permanent_unavailability(
  p_activity_id text,p_emp_id bigint,p_from date,p_to date,p_reason text
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare approved uuid; a public.activities;
begin
  if auth.uid() is null or public.app_current_role() <> 'admin'
    or not exists (select 1 from public.users u where u.auth_user_id=auth.uid() and u.is_active is true)
    or not exists (select 1 from public.scheduling_agent_control c where c.approver_id=auth.uid())
  then raise exception 'scheduling_manager_approval_required' using errcode='42501'; end if;
  if p_emp_id is null or p_from is null or p_to is null or p_from>p_to
    or p_to-p_from>400 or length(btrim(coalesce(p_reason,'')))<12
  then raise exception 'scheduling_approval_scope_invalid'; end if;
  select * into a from public.activities where row_id=p_activity_id for update;
  if not found then raise exception 'activity_not_found'; end if;
  if a.activity_season <> 'school_2027'
    or lower(btrim(coalesce(a.activity_type,''))) not in ('course','program','קורס','קורסים','תוכנית','תכנית')
    or lower(btrim(coalesce(a.status,''))) not in ('open','פתוח')
  then raise exception 'scheduling_activity_not_course'; end if;
  if a.emp_id is not null and a.emp_id<>p_emp_id then
    raise exception 'scheduling_assignment_locked'; end if;
  if not exists(select 1 from public.contacts_instructors ci where ci.emp_id=p_emp_id and lower(coalesce(ci.active,''))='yes')
  then raise exception 'instructor_inactive'; end if;
  insert into public.scheduling_permanent_availability_approvals
     (activity_id,emp_id,scope_start,scope_end,reason,approved_by)
  values (a.row_id,p_emp_id,p_from,p_to,btrim(p_reason),auth.uid())
  returning id into approved;
  return approved;
end $$;
revoke all on function public.scheduling_approve_permanent_unavailability(text,bigint,date,date,text) from public,anon;
grant execute on function public.scheduling_approve_permanent_unavailability(text,bigint,date,date,text) to authenticated;

create or replace function public.scheduling_revoke_permanent_unavailability(p_approval_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null or public.app_current_role()<>'admin'
    or not exists(select 1 from public.users where auth_user_id=auth.uid() and is_active is true)
    or not exists(select 1 from public.scheduling_agent_control c where c.approver_id=auth.uid())
  then raise exception 'scheduling_manager_approval_required' using errcode='42501'; end if;
  if exists (select 1 from public.course_meeting_instructor_history
             where availability_approval_id=p_approval_id and assignment_kind='availability_blocked_pending')
  then raise exception 'scheduling_approval_has_unresolved_meetings'; end if;
  update public.scheduling_permanent_availability_approvals
  set revoked_at=clock_timestamp(),revoked_by=auth.uid()
  where id=p_approval_id and revoked_at is null;
  if not found then raise exception 'scheduling_approval_not_active'; end if;
end $$;
revoke all on function public.scheduling_revoke_permanent_unavailability(uuid) from public,anon;
grant execute on function public.scheduling_revoke_permanent_unavailability(uuid) to authenticated;

-- Returns exactly those explicit exception dates covered by a current manager approval.
-- A matching_note, planned intent, or informal email is not sufficient authorization.
create or replace function public.scheduling_approved_blocked_dates(
  p_activity_id text,p_emp_id bigint,p_meetings jsonb default null
) returns date[] language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(array_agg(distinct x.d order by x.d),'{}'::date[])
  from public.activities a
  cross join lateral jsonb_array_elements(coalesce(
    p_meetings,public.scheduling_activity_official_meetings(a),'[]'::jsonb
  )) proposed(meeting)
  cross join lateral (select nullif(proposed.meeting->>'date','')::date d) x
  join public.instructor_availability_exceptions e
    on e.emp_id=p_emp_id and e.exception_date=x.d and e.available is false
  where a.row_id=p_activity_id
    and exists (select 1 from public.scheduling_permanent_availability_approvals p
                where p.activity_id=a.row_id and p.emp_id=p_emp_id
                  and p.revoked_at is null and x.d between p.scope_start and p.scope_end)
$$;
revoke all on function public.scheduling_approved_blocked_dates(text,bigint,jsonb) from public,anon,authenticated;

-- The canonical resolved instructor for each date: an empty history emp_id means
-- the blocked lesson is UNSTAFFED, never a shift for the permanent instructor.
create or replace function public.scheduling_course_meeting_instructors(p_activity_id text)
returns table(meeting_date date,emp_id text,instructor_name text)
language sql stable security definer set search_path=public as $$
  with target as (select a.* from public.activities a where a.row_id=p_activity_id),
  dates as (
    select distinct nullif(to_jsonb(t)->>('date_'||n),'')::date meeting_date
    from target t,generate_series(1,35) n
  )
  select d.meeting_date,
         nullif(coalesce(h.emp_id,t.emp_id::text),'') emp_id,
         nullif(coalesce(h.instructor_name,t.instructor_name),'') instructor_name
  from dates d cross join target t
  left join public.course_meeting_instructor_history h
    on h.activity_id=p_activity_id and h.meeting_date=d.meeting_date
  where d.meeting_date is not null order by d.meeting_date
$$;

-- Existing collision and travel gates use effective meetings. A pending blocked
-- lesson must not appear to be a staffed shift for the permanent instructor.
create or replace function public.scheduling_effective_meetings(
  p_activity public.activities,p_emp_id bigint
) returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce(jsonb_agg(item order by item->>'date'),'[]'::jsonb)
  from (
    select jsonb_build_object(
      'date',(value->>'date')::date,
      'start_time',p_activity.start_time,
      'end_time',public.scheduling_effective_end_time(
        p_activity.row_id,(value->>'date')::date,p_activity.end_time)
    ) item
    from jsonb_array_elements(
      case when p_activity.draft_emp_id=p_emp_id::text and p_activity.draft_proposed_meetings is not null
        then p_activity.draft_proposed_meetings
        else public.scheduling_activity_official_meetings(p_activity)
      end
    ) proposed(value)
    where nullif(value->>'date','') is not null
      and not exists(select 1 from public.course_meeting_cancellations c
        where c.activity_id=p_activity.row_id and c.meeting_date=(value->>'date')::date)
      and not exists(select 1 from public.course_meeting_instructor_history h
        where h.activity_id=p_activity.row_id
          and h.meeting_date=(value->>'date')::date
          and h.assignment_kind='availability_blocked_pending'
          and h.emp_id='' and p_activity.emp_id=p_emp_id)
  ) effective
$$;

-- Eden and the scheduling agent read the same persisted per-meeting reality.
create or replace function public.scheduling_permanent_unavailability_state(
  p_activity_id text,p_emp_id bigint
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare a public.activities; blocked date[]; covered date[]; pending jsonb;
begin
  if auth.uid() is null or not public.app_has_permission('view_operations_scheduling')
    or not exists(select 1 from public.users where auth_user_id=auth.uid() and is_active is true)
  then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
  select * into a from public.activities where row_id=p_activity_id;
  if not found then raise exception 'activity_not_found'; end if;
  select coalesce(array_agg(e.exception_date order by e.exception_date),'{}'::date[])
    into blocked
  from public.instructor_availability_exceptions e
  where e.emp_id=p_emp_id and e.available is false
    and exists (
      select 1 from jsonb_array_elements(public.scheduling_activity_official_meetings(a)) m
      where nullif(m->>'date','')::date=e.exception_date
    );
  covered:=public.scheduling_approved_blocked_dates(p_activity_id,p_emp_id);
  select coalesce(jsonb_agg(jsonb_build_object(
    'date',h.meeting_date,'status','נדרש טיפול – מפגש חסום',
    'empId',null,'approvalId',h.availability_approval_id
  ) order by h.meeting_date),'[]'::jsonb) into pending
  from public.course_meeting_instructor_history h
  where h.activity_id=p_activity_id and h.assignment_kind='availability_blocked_pending';
  return jsonb_build_object(
    'activityId',a.row_id,'instructorId',p_emp_id,
    'approved',cardinality(blocked)>0 and blocked<@covered,
    'blockedDates',to_jsonb(blocked),'approvedBlockedDates',to_jsonb(covered),
    'unresolvedMeetings',pending,
    'courseStatus',case when jsonb_array_length(pending)>0
      then 'שיבוץ אושר – קיימים מפגשים לטיפול'
      else coalesce(a.instructor_assignment_status,'') end
  );
end $$;
revoke all on function public.scheduling_permanent_unavailability_state(text,bigint) from public,anon;
grant execute on function public.scheduling_permanent_unavailability_state(text,bigint) to authenticated;
