-- Repair legacy activities only where the textual authority already agrees with
-- the authority of the referenced school. This fills the missing foreign key
-- without guessing or changing historical text snapshots.
update public.activities activity
set authority_id = school.authority_id
from public.schools school
join public.authorities authority on authority.id = school.authority_id
where activity.school_id = school.id
  and activity.authority_id is null
  and nullif(btrim(activity.authority), '') is not null
  and btrim(activity.authority) = btrim(authority.authority_name);

-- The guard should protect authority/school and second-instructor changes,
-- not block unrelated edits (notes, dates, contacts, etc.) on legacy rows.
drop trigger if exists activities_school_and_instructor_guard on public.activities;

create trigger activities_school_and_instructor_guard
before insert or update of school_id, authority_id, emp_id_2, instructor_name_2
on public.activities
for each row execute function public.guard_activity_school_and_instructors();
