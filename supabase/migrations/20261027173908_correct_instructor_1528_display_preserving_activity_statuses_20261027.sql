-- One-time administrative correction: name only; no assignment, date or approval changes.
-- Keep calendar, canonical instructor and scheduling validation triggers enabled.
-- Temporarily suspend only the draft-clear-on-manual-reassignment trigger in this transaction.
alter table public.activities disable trigger aaa_activities_clear_draft_on_manual_assignment;

create temp table instructor_1528_rename_preimage on commit drop as
select a.row_id, a.instructor_assignment_status as prior_assignment_status,
  to_jsonb(a)-array['instructor_name','draft_instructor_name','updated_at']::text[] as protected_fields
from public.activities a
where (a.emp_id=1528 and a.instructor_name='רינת דהן')
   or (a.draft_emp_id='1528' and a.draft_instructor_name='רינת דהן');

do $$
begin
 if (select count(*) from instructor_1528_rename_preimage) <> 11 then
  raise exception 'instructor_1528_activity_expected_11_rows';
 end if;
end $$;

update public.activities a
set instructor_name=case when a.emp_id=1528 and a.instructor_name='רינת דהן' then 'רוני דהן' else a.instructor_name end,
    draft_instructor_name=case when a.draft_emp_id='1528' and a.draft_instructor_name='רינת דהן' then 'רוני דהן' else a.draft_instructor_name end
where a.row_id in (select row_id from instructor_1528_rename_preimage);

alter table public.activities enable trigger aaa_activities_clear_draft_on_manual_assignment;

-- Calendar guard normalizes one preexisting legacy status when only its name changes.
-- Restore that original status without touching instructor identity/assignment.
update public.activities a set instructor_assignment_status=p.prior_assignment_status
from instructor_1528_rename_preimage p
where a.row_id=p.row_id
  and a.instructor_assignment_status is distinct from p.prior_assignment_status;

do $$
begin
 if exists (
  select 1 from public.activities a
  join instructor_1528_rename_preimage p using(row_id)
  where (to_jsonb(a)-array['instructor_name','draft_instructor_name','updated_at']::text[]) is distinct from p.protected_fields
 ) then raise exception 'rename_changed_protected_activity_fields'; end if;
 if (select count(*) from public.activities a
     join instructor_1528_rename_preimage p using(row_id)
     where (a.emp_id=1528 and a.instructor_name='רוני דהן')
       or (a.draft_emp_id='1528' and a.draft_instructor_name='רוני דהן')) <> 11
 then raise exception 'rename_activity_incomplete'; end if;
 if (select tgenabled from pg_trigger
   where tgrelid='public.activities'::regclass
   and tgname='aaa_activities_clear_draft_on_manual_assignment') <> 'O'
 then raise exception 'draft_clear_trigger_not_enabled'; end if;
end $$;