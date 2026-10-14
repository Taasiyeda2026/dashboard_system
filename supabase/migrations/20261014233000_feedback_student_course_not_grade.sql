-- Student feedback is selected by published course/program template, not grade.
-- Grade remains optional metadata; lack of grade must not prevent dispatch.
-- Retain existing eligibility, recipient checks, publication checks and deduplication.
DO $migration$
DECLARE
  def text;
  old_clause text := $old$if c.audience='student' and c.age_band is null
   then v_status:='needs_attention';v_error:='unresolved_grade_age_band'; end if;$old$;
  new_clause text := E'-- Student questionnaires are course-based; grade and age_band are optional metadata.';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='feedback_auto_prepare';
  IF def IS NULL THEN RAISE EXCEPTION 'feedback_auto_prepare_not_found'; END IF;
  IF position(new_clause IN def)=0 THEN
    IF position(old_clause IN def)=0 THEN RAISE EXCEPTION 'student_age_band_gate_not_found'; END IF;
    def:=replace(def,old_clause,new_clause);
    EXECUTE def;
  END IF;
END
$migration$;
