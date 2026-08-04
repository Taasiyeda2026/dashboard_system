create temporary table _purged_2027_course_ids on commit drop as
select id, row_id
from public.activities
where activity_season = 'school_2027'
  and lower(trim(coalesce(activity_type, ''))) in ('קורס', 'course', 'program')
  and lower(trim(coalesce(status, ''))) in ('נמחק', 'deleted');

-- Remove scheduling records linked by the textual activity identifier.
delete from public.course_meeting_cancellations c
using _purged_2027_course_ids d
where c.activity_id = d.row_id;

delete from public.course_meeting_instructor_history h
using _purged_2027_course_ids d
where h.activity_id = d.row_id;

delete from public.instructor_assignment_audit a
using _purged_2027_course_ids d
where a.activity_id = d.row_id;

-- Permanently remove erroneous activities. activity_schools children cascade.
delete from public.activities a
using _purged_2027_course_ids d
where a.id = d.id;

-- The activities delete trigger writes an audit event, so remove all audit history
-- for rows that were intentionally purged.
delete from public.activities_audit_log l
using _purged_2027_course_ids d
where l.activity_id = d.id;

-- Every remaining 2027 course is currently active and must start as open.
update public.activities
set status = 'פתוח'
where activity_season = 'school_2027'
  and lower(trim(coalesce(activity_type, ''))) in ('קורס', 'course', 'program')
  and trim(coalesce(status, '')) <> 'פתוח';

-- Final business rule: 2027 courses may only be open or closed.
alter table public.activities
  drop constraint if exists activities_school_2027_course_status_check;

alter table public.activities
  add constraint activities_school_2027_course_status_check
  check (
    not (
      activity_season = 'school_2027'
      and lower(trim(coalesce(activity_type, ''))) in ('קורס', 'course', 'program')
    )
    or trim(coalesce(status, '')) in ('פתוח', 'סגור')
  );
