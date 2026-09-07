-- Expand the existing scheduling contract to courses, workshops and tours.
-- Rebuild each active public function containing the legacy course-only predicate;
-- pg_get_functiondef preserves its signature, security mode, body and validation logic.
do $migration$
declare
  fn record;
  definition text;
  expanded_types constant text := $$('course', 'program', 'קורס', 'קורסים', 'תוכנית', 'תכנית', 'workshop', 'סדנה', 'סדנא', 'סדנאות', 'tour', 'סיור', 'סיורים')$$;
begin
  for fn in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and pg_get_functiondef(p.oid) ~ $$\(\s*'קורס'\s*,\s*'course'\s*,\s*'program'\s*\)$$
      and (p.proname like 'scheduling_%'
        or p.proname like '%course_assignment%'
        or p.proname in ('assign_activity_instructor', 'assign_activity_instructor_with_dates',
                          'reject_activity_instructor_suggestion', 'validate_course_instructor_assignment',
                          'enforce_school_calendar_on_activity'))
  loop
    definition := pg_get_functiondef(fn.oid);
    definition := regexp_replace(
      definition,
      $$\(\s*'קורס'\s*,\s*'course'\s*,\s*'program'\s*\)$$,
      expanded_types,
      'g'
    );
    execute definition;
  end loop;
end
$migration$;
