-- UI-only eligibility: hide unscheduled or unstaffed activity-backed feedback.
-- Keep existing campaigns, responses, tokens and mail audit in the database.
-- Instructor personal feedback is intentionally independent of a specific activity.
-- A null activity_row_id is not an activity; leave global staff/personal surveys intact.
DO $migration$
DECLARE
  item record;
  original text;
  revised text;
BEGIN
  FOR item IN
    SELECT * FROM (VALUES
    ($x$public$x$, $x$feedback_admin_groups$x$, $x$where (p_activity_row_id is null or x.row_id = p_activity_row_id)$x$, $x$where x.start_date is not null and x.instructor_assignment_locked is true and (x.emp_id is not null or nullif(btrim(x.emp_id_2), '') is not null)
      and (p_activity_row_id is null or x.row_id = p_activity_row_id)$x$),
    ($x$public$x$, $x$feedback_admin_instructor_assignments$x$, $x$where coalesce(a.instructor_assignment_locked, false)$x$, $x$where a.start_date is not null and coalesce(a.instructor_assignment_locked, false)$x$),
    ($x$private$x$, $x$feedback_instructor_cohort_starts$x$, $x$where coalesce(a.instructor_assignment_locked, false)$x$, $x$where a.start_date is not null and coalesce(a.instructor_assignment_locked, false)$x$),
    ($x$public$x$, $x$feedback_instructor_portal_items$x$, $x$and (a.emp_id::text = v_emp_id or a.emp_id_2 = v_emp_id)$x$, $x$and a.start_date is not null and a.instructor_assignment_locked is true and (a.emp_id is not null or nullif(btrim(a.emp_id_2), '') is not null)
        and (a.emp_id::text = v_emp_id or a.emp_id_2 = v_emp_id)$x$),
    ($x$public$x$, $x$feedback_admin_course_summary_for_half$x$, $x$where (p_academic_year is null or c.academic_year = p_academic_year)$x$, $x$where (c.activity_row_id is null or (a.start_date is not null and a.instructor_assignment_locked is true and (a.emp_id is not null or nullif(btrim(a.emp_id_2), '') is not null)))
      and (p_academic_year is null or c.academic_year = p_academic_year)$x$),
    ($x$public$x$, $x$feedback_admin_course_summary$x$, $x$where p_academic_year is null or c.academic_year = p_academic_year$x$, $x$where (c.activity_row_id is null or (a.start_date is not null and a.instructor_assignment_locked is true and (a.emp_id is not null or nullif(btrim(a.emp_id_2), '') is not null)))
      and (p_academic_year is null or c.academic_year = p_academic_year)$x$),
    ($x$public$x$, $x$feedback_admin_answer_facts$x$, $x$where (f->>'academic_year' is null or c.academic_year = f->>'academic_year')$x$, $x$where (c.activity_row_id is null or (a.start_date is not null and a.instructor_assignment_locked is true and (a.emp_id is not null or nullif(btrim(a.emp_id_2), '') is not null)))
    and (f->>'academic_year' is null or c.academic_year = f->>'academic_year')$x$)
    ) AS patch(schema_name, function_name, match_text, replacement_text)
  LOOP
    SELECT pg_get_functiondef(p.oid) INTO original
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = item.schema_name AND p.proname = item.function_name;
    IF original IS NULL THEN
      RAISE EXCEPTION 'Missing feedback function: %.%', item.schema_name, item.function_name;
    END IF;
    IF strpos(original, item.replacement_text) > 0 THEN
      CONTINUE; -- Idempotent if a deployment is repeated.
    END IF;
    IF strpos(original, item.match_text) = 0 THEN
      RAISE EXCEPTION 'Unexpected feedback function layout: %.%', item.schema_name, item.function_name;
    END IF;
    revised := replace(original, item.match_text, item.replacement_text);
    EXECUTE revised;
  END LOOP;
END
$migration$;
NOTIFY pgrst, 'reload schema';
