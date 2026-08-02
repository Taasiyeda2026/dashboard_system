-- Course scheduling interface (school_2027): schema additions only.
-- Non-destructive: adds nullable columns and one new table. No existing data is changed.

-- 1. Instructor load profile: optional personal targets (section 16). Nullable/backward
--    compatible — when absent, load calculations keep falling back to weekly availability.
alter table public.instructor_scheduling_profiles
  add column if not exists weekly_target_hours numeric,
  add column if not exists weekly_max_hours numeric,
  add column if not exists preferred_work_days integer,
  add column if not exists max_fixed_courses integer;
alter table public.instructor_scheduling_profiles drop constraint if exists instructor_scheduling_profiles_weekly_max_hours_check;
alter table public.instructor_scheduling_profiles add constraint instructor_scheduling_profiles_weekly_max_hours_check
  check (weekly_max_hours is null or weekly_max_hours >= 0);
alter table public.instructor_scheduling_profiles drop constraint if exists instructor_scheduling_profiles_weekly_target_hours_check;
alter table public.instructor_scheduling_profiles add constraint instructor_scheduling_profiles_weekly_target_hours_check
  check (weekly_target_hours is null or weekly_target_hours >= 0);
alter table public.instructor_scheduling_profiles drop constraint if exists instructor_scheduling_profiles_preferred_work_days_check;
alter table public.instructor_scheduling_profiles add constraint instructor_scheduling_profiles_preferred_work_days_check
  check (preferred_work_days is null or (preferred_work_days between 1 and 7));
alter table public.instructor_scheduling_profiles drop constraint if exists instructor_scheduling_profiles_max_fixed_courses_check;
alter table public.instructor_scheduling_profiles add constraint instructor_scheduling_profiles_max_fixed_courses_check
  check (max_fixed_courses is null or max_fixed_courses >= 0);

-- 2. Travel cache: identify pairs by school/authority so the batch update button can scope
--    itself to one authority and detect address changes (section 17.3).
alter table public.scheduling_travel_cache
  add column if not exists authority_id bigint,
  add column if not exists origin_school_id bigint,
  add column if not exists destination_school_id bigint,
  add column if not exists origin_address text,
  add column if not exists destination_address text;
create index if not exists scheduling_travel_cache_authority_idx on public.scheduling_travel_cache(authority_id);
create index if not exists scheduling_travel_cache_schools_idx on public.scheduling_travel_cache(origin_school_id, destination_school_id);

-- 3. Draft assignment slot on the activity itself (section 21/33): holds a calendar slot
--    without finalizing emp_id/instructor_name until the draft is approved.
alter table public.activities
  add column if not exists draft_emp_id text,
  add column if not exists draft_instructor_name text,
  add column if not exists draft_created_at timestamptz,
  add column if not exists draft_created_by uuid;

-- 4. Manual "meeting did not occur" marker (section 10, priority 3). Existence of a row
--    means that specific meeting date is excluded from the meetings-completed count.
--    Writes go through set_course_meeting_cancelled() only — no direct client policy.
create table if not exists public.course_meeting_cancellations (
  id uuid primary key default gen_random_uuid(),
  activity_id text not null,
  meeting_date date not null,
  reason text,
  cancelled_by uuid,
  created_at timestamptz not null default now(),
  unique (activity_id, meeting_date)
);
create index if not exists course_meeting_cancellations_activity_idx on public.course_meeting_cancellations(activity_id);
alter table public.course_meeting_cancellations enable row level security;
drop policy if exists course_meeting_cancellations_authorized_read on public.course_meeting_cancellations;
create policy course_meeting_cancellations_authorized_read
  on public.course_meeting_cancellations for select to authenticated
  using (public.app_current_role() = any (array['admin'::text, 'operation_manager'::text]));

-- 5. Audit trail extensions (section 29): what was bypassed, meetings completed at
--    decision time, and instructor-replacement provenance.
alter table public.instructor_assignment_audit
  add column if not exists bypassed_constraints text[] not null default '{}',
  add column if not exists meetings_completed_at_decision integer,
  add column if not exists previous_emp_id text,
  add column if not exists previous_instructor_name text,
  add column if not exists effective_from date;
alter table public.instructor_assignment_audit
  drop constraint if exists instructor_assignment_audit_decision_type_check;
alter table public.instructor_assignment_audit
  add constraint instructor_assignment_audit_decision_type_check
  check (decision_type in ('draft','draft_cancelled','approved','overridden','exception_approved','rejected','revalidated','operational_replacement'));

-- 6. Meetings-completed count (section 10): approved completion upload, else a past
--    meeting date not marked cancelled. Reuses existing completion-approval data —
--    no parallel bookkeeping is introduced.
create or replace function public.scheduling_course_meetings_completed(p_activity_id text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with target as (
    select a.* from public.activities a where a.row_id = p_activity_id
  ),
  distinct_dates as (
    select distinct nullif(to_jsonb(t)->>('date_' || n), '')::date as meeting_date
    from target t, generate_series(1, 35) n
  ),
  cancelled as (
    select meeting_date from public.course_meeting_cancellations where activity_id = p_activity_id
  ),
  approved as (
    select distinct activity_date as meeting_date
    from public.activity_completion_approval_uploads
    where status = 'approved'
      and activity_date is not null
      and (
        activity_row_id = p_activity_id
        or (',' || activity_row_id || ',') like ('%,' || p_activity_id || ',%')
      )
  )
  select count(*)::integer
  from distinct_dates d
  where d.meeting_date is not null
    and d.meeting_date not in (select meeting_date from cancelled)
    and (
      d.meeting_date in (select meeting_date from approved)
      or d.meeting_date < current_date
    )
$$;
revoke all on function public.scheduling_course_meetings_completed(text) from public;
grant execute on function public.scheduling_course_meetings_completed(text) to authenticated;

-- 7. Distinct schools with school_2027 course activity, grouped by authority, with a
--    resolved address (reuses the existing scheduling_school_location resolver — no
--    duplicate address logic). Used only by the batch distance-update flow.
create or replace function public.scheduling_authority_school_locations()
returns table(authority_id bigint, authority_name text, school_id bigint, school_name text, address text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (coalesce(a.authority_id::text, lower(btrim(coalesce(a.authority, '')))), coalesce(a.school_id::text, lower(btrim(a.school))))
    a.authority_id,
    a.authority as authority_name,
    a.school_id,
    a.school as school_name,
    public.scheduling_school_location(a.school_id, a.school, a.authority_id, a.authority) as address
  from public.activities a
  where a.activity_season = 'school_2027'
    and lower(btrim(coalesce(a.activity_type::text, ''))) in ('קורס', 'course', 'program')
    and lower(btrim(coalesce(a.status::text, ''))) not in ('סגור', 'נמחק', 'בוטל', 'closed', 'deleted', 'cancelled', 'canceled')
    and nullif(btrim(coalesce(a.school, '')), '') is not null
    and nullif(btrim(coalesce(a.authority, '')), '') is not null
  order by coalesce(a.authority_id::text, lower(btrim(coalesce(a.authority, '')))), coalesce(a.school_id::text, lower(btrim(a.school))), a.row_id desc
$$;
revoke all on function public.scheduling_authority_school_locations() from public;
grant execute on function public.scheduling_authority_school_locations() to authenticated;
