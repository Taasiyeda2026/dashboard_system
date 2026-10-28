-- Hotfix: the activity eligibility predicate uses alias "a". The preceding
-- UI cohort migration added that predicate to feedback_admin_answer_facts
-- but omitted the JOIN. Preserve all existing security checks and query filters.
DO $fix$
DECLARE source_sql text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO source_sql
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='feedback_admin_answer_facts';

  IF source_sql IS NULL THEN
    RAISE EXCEPTION 'feedback_admin_answer_facts_missing';
  END IF;

  IF position('left join public.activities a on a.row_id = c.activity_row_id' IN source_sql) = 0 THEN
    IF position('left join public.feedback_recipients rc on rc.id = r.recipient_id' IN source_sql) = 0
      OR position('a.start_date is not null' IN source_sql) = 0 THEN
      RAISE EXCEPTION 'Unexpected feedback facts function; refusing hotfix';
    END IF;

    source_sql := replace(
      source_sql,
      'left join public.feedback_recipients rc on rc.id = r.recipient_id',
      'left join public.feedback_recipients rc on rc.id = r.recipient_id' || chr(10) ||
      '  left join public.activities a on a.row_id = c.activity_row_id'
    );
    EXECUTE source_sql;
  END IF;
END
$fix$;
NOTIFY pgrst, 'reload schema';
