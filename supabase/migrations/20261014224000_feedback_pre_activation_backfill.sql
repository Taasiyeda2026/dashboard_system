-- Recover eligible course feedback that predates the activation of automation.
-- Preserve eligibility, attendance checks, e-mail validation, and duplicate protection.
-- Delivers only at existing scheduled 08:00 (educational staff) and 09:15 (students).
-- Historical manually-opened student campaigns remain excluded from automated re-mail.
DO $migration$
DECLARE
  fn text;
  before_sql text := E'and a.eligible_at>=ctl.activated_at';
  after_sql text := E'and (a.eligible_at>=ctl.activated_at or (a.audience=\'student\' and a.stage in (\'pre\',\'post\')))';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO fn
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='feedback_auto_prepare';
  IF fn IS NULL THEN RAISE EXCEPTION 'feedback_auto_prepare_missing'; END IF;
  IF position(after_sql in fn)=0 THEN
    IF position(before_sql in fn)=0 THEN RAISE EXCEPTION 'student_activation_anchor_not_found'; END IF;
    fn:=replace(fn,before_sql,after_sql);
    EXECUTE fn;
  END IF;
END
$migration$;

DO $migration$
DECLARE
  fn text;
  before_sql text := E'where status=\'eligible\' and eligibility_at>=ctl.activation_at loop';
  after_sql text := E'where status=\'eligible\' and (eligibility_at>=ctl.activation_at or stage=\'pre\') loop';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO fn
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='feedback_staff_auto_prepare';
  IF fn IS NULL THEN RAISE EXCEPTION 'feedback_staff_auto_prepare_missing'; END IF;
  IF position(after_sql in fn)=0 THEN
    IF position(before_sql in fn)=0 THEN RAISE EXCEPTION 'staff_activation_anchor_not_found'; END IF;
    fn:=replace(fn,before_sql,after_sql);
    EXECUTE fn;
  END IF;
END
$migration$;
