-- Scheduling planning: preferred_work_days is now an operational planning input.
-- Any change must invalidate only the affected instructor's planning rows.

create or replace function public.scheduling_invalidate_planning_after_scheduling_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
    and old.gender is not distinct from new.gender
    and old.instruction_languages is not distinct from new.instruction_languages
    and old.course_restriction_mode is not distinct from new.course_restriction_mode
    and old.course_ids is not distinct from new.course_ids
    and old.blocked_authorities is not distinct from new.blocked_authorities
    and old.blocked_schools is not distinct from new.blocked_schools
    and old.preferred_work_days is not distinct from new.preferred_work_days
  then
    return new;
  end if;

  perform public.mark_scheduling_planning_needs_recalc_for_instructor(new.emp_id, null, false);
  return new;
end
$$;

drop trigger if exists instructor_scheduling_profiles_invalidate_planning
  on public.instructor_scheduling_profiles;

create trigger instructor_scheduling_profiles_invalidate_planning
  after insert or update of
    gender,
    instruction_languages,
    course_restriction_mode,
    course_ids,
    blocked_authorities,
    blocked_schools,
    preferred_work_days
  on public.instructor_scheduling_profiles
  for each row
  execute function public.scheduling_invalidate_planning_after_scheduling_profile();
