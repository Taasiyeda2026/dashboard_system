-- Remove the last duplicated school_2027 validation path and an obsolete draft RPC.
-- This migration is intentionally data-free and safe to reapply.

-- Revalidation keeps its public contract because triggers and audit flows call it,
-- but delegates every eligibility decision to the same validator used by draft,
-- assignment, and replacement operations.
create or replace function public.scheduling_locked_course_validation_reason(
  p_activity_id text
) returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target public.activities;
  violations text[];
begin
  select * into target from public.activities where row_id = p_activity_id;
  if not found then return 'activity_not_found'; end if;

  if coalesce(target.activity_season, '') <> 'school_2027'
    or lower(btrim(coalesce(target.activity_type::text, ''))) not in ('קורס', 'course', 'program')
    or lower(btrim(coalesce(target.status::text, ''))) not in ('פתוח', 'open')
  then
    return null;
  end if;

  if target.instructor_assignment_locked is not true then return null; end if;
  if target.emp_id is null then
    if nullif(btrim(coalesce(target.emp_id_2::text, '')), '') is not null then
      return 'scheduling_secondary_assignment_requires_review';
    end if;
    return 'scheduling_assignment_missing';
  end if;

  violations := public.scheduling_course_instructor_violations(p_activity_id, target.emp_id, false);
  if coalesce(array_length(violations, 1), 0) = 0 then return null; end if;
  return violations[1];
exception
  when others then
    return 'scheduling_revalidation_error:' || sqlstate || ':' || sqlerrm;
end
$$;

revoke all on function public.scheduling_locked_course_validation_reason(text) from public;

-- The canonical cancellation RPC now clears proposed dates itself. No frontend,
-- trigger, RPC, or function calls this former compatibility wrapper.
drop function if exists public.cancel_course_assignment_draft_with_dates(text);
