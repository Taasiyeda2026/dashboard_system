-- Keep existing student feedback campaigns attached to the live course assignment.
-- Unassigned/unapproved activity = campaign without a current instructor.
-- Do not recreate campaigns, rotate survey tokens, touch replies, or rewrite mail history.

CREATE OR REPLACE FUNCTION private.feedback_sync_student_campaign_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_emp text;
  v_name text := '';
BEGIN
  IF NEW.row_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_emp := CASE
    WHEN NEW.instructor_assignment_locked IS TRUE
      THEN coalesce(NEW.emp_id::text, nullif(btrim(NEW.emp_id_2), ''))
    ELSE NULL
  END;

  IF v_emp IS NOT NULL THEN
    SELECT nullif(btrim(ci.full_name), '')
      INTO v_name
    FROM public.contacts_instructors ci
    WHERE ci.emp_id::text = v_emp
    LIMIT 1;

    v_name := coalesce(
      v_name,
      CASE
        WHEN v_emp = NEW.emp_id::text THEN nullif(btrim(NEW.instructor_name), '')
        ELSE nullif(btrim(NEW.instructor_name_2), '')
      END,
      ''
    );
  ELSE
    v_name := '';
  END IF;

  UPDATE public.feedback_campaigns AS fc
  SET instructor_emp_id = v_emp,
      instructor_name = v_name,
      updated_at = now()
  WHERE fc.activity_row_id = NEW.row_id
    AND fc.audience = 'student'
    AND fc.status = 'active'
    AND (fc.instructor_emp_id IS DISTINCT FROM v_emp
      OR fc.instructor_name IS DISTINCT FROM v_name);

  RETURN NEW;
END;
$fn$;

-- The trigger runs under its database owner, not under the instructor's RLS grants.
-- It cannot be called directly by browser roles.
REVOKE ALL ON FUNCTION private.feedback_sync_student_campaign_assignment()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS feedback_student_campaign_assignment_sync
  ON public.activities;

CREATE TRIGGER feedback_student_campaign_assignment_sync
AFTER INSERT OR UPDATE OF
  emp_id, emp_id_2, instructor_name, instructor_name_2,
  instructor_assignment_locked
ON public.activities
FOR EACH ROW
EXECUTE FUNCTION private.feedback_sync_student_campaign_assignment();

-- One-time repair of already-stale ACTIVE student campaigns.
-- Uses the same identity-precedence rules as the trigger.
WITH activity_emp AS (
  SELECT a.row_id,
    CASE WHEN a.instructor_assignment_locked IS TRUE
      THEN coalesce(a.emp_id::text, nullif(btrim(a.emp_id_2), ''))
      ELSE NULL END AS current_emp,
    a.emp_id::text AS primary_emp,
    a.instructor_name,
    a.instructor_name_2
  FROM public.activities a
),
live_assignment AS (
  SELECT ae.row_id, ae.current_emp,
    CASE WHEN ae.current_emp IS NULL THEN ''
    ELSE coalesce(
      nullif(btrim(ci.full_name), ''),
      CASE WHEN ae.current_emp = ae.primary_emp
        THEN nullif(btrim(ae.instructor_name), '')
        ELSE nullif(btrim(ae.instructor_name_2), '') END,
      ''
    ) END AS current_name
  FROM activity_emp ae
  LEFT JOIN public.contacts_instructors ci
    ON ci.emp_id::text = ae.current_emp
)
UPDATE public.feedback_campaigns AS fc
SET instructor_emp_id = la.current_emp,
    instructor_name = la.current_name,
    updated_at = now()
FROM live_assignment la
WHERE fc.audience = 'student'
  AND fc.status = 'active'
  AND fc.activity_row_id = la.row_id
  AND (fc.instructor_emp_id IS DISTINCT FROM la.current_emp
    OR fc.instructor_name IS DISTINCT FROM la.current_name);

NOTIFY pgrst, 'reload schema';
