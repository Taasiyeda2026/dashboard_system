-- Remove "השמיים אינם הגבול" (Gefen 57646) from the feedback module only.
-- Master activity/program data outside feedback is untouched.

update public.feedback_programs
set is_active = false,
    updated_at = now()
where key = 'sky_limit';

create or replace function private.feedback_is_course_activity(p_activity jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    not (
      private.feedback_canonical_program_number(p_activity->>'gefen_number') = '57646'
      or private.feedback_canonical_program_number(p_activity->>'activity_no') = '57646'
      or coalesce(p_activity->>'activity_name', '') ilike '%השמיים אינם הגבול%'
    )
    and (
      coalesce(p_activity->>'activity_type', '') in ('course', 'after_school', 'קורס', 'חוג', 'תוכנית')
      or coalesce(p_activity->>'activity_family', '') = 'program'
    );
$$;

revoke all on function private.feedback_is_course_activity(jsonb) from public, anon, authenticated;

notify pgrst, 'reload schema';
