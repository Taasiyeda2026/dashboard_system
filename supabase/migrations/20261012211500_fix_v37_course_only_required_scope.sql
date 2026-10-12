-- Match the authoritative v37 required-row gate to the course-only planning scope.
-- Tours/workshops remain source activities and instructor calendar blockers,
-- but do not need an unapproved row in scheduling_planning_rows.
-- All open courses (including newly created, undated courses) remain required.
-- Apply as a guarded body-only replacement: no other v37 validation or grants change.
DO $course_only_scope$
DECLARE
  validator regprocedure := to_regprocedure('public.scheduling_v37_workspace_validation(uuid,jsonb)');
  current_definition text;
  old_filter text := $old_scope$      and lower(coalesce(a.activity_type, '')) in (
        'course','program','קורס','קורסים','תוכנית','תכנית',
        'workshop','סדנה','סדנא','סדנאות','tour','סיור','סיורים'
      )$old_scope$;
  new_filter text := $new_scope$      and lower(coalesce(a.activity_type, '')) in (
        'course','program','קורס','קורסים','תוכנית','תכנית'
      )
      and coalesce(a.activity_no, '') <> '13990'
      and lower(coalesce(a.activity_name, '')) not like '%התנסות בתעשייה%'$new_scope$;
BEGIN
  IF validator IS NULL THEN
    RAISE EXCEPTION 'v37_course_only_validator_missing';
  END IF;

  SELECT pg_get_functiondef(validator) INTO current_definition;

  -- Safe to replay if the connector applied the same change before the git migration.
  IF strpos(current_definition, new_filter) > 0
     AND strpos(current_definition, old_filter) = 0 THEN
    RETURN;
  END IF;

  IF (length(current_definition) - length(replace(current_definition, old_filter, '')))
     <> length(old_filter) THEN
    RAISE EXCEPTION 'v37_course_only_validator_unexpected_source';
  END IF;

  EXECUTE replace(current_definition, old_filter, new_filter);
END
$course_only_scope$;
