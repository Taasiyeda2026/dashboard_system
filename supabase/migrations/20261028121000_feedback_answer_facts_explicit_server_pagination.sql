-- PostgREST RPC builders do not reliably expose order()/range() for this
-- PL/pgSQL table-returning function. Page at the database query itself.
-- Existing callers without paging keys retain their original behavior.
-- Stable tie-breaker by answer ID prevents loss or duplication at page boundaries.
DO $patch$
DECLARE
  src text;
  old_sort text := 'order by r.submitted_at, r.id, tq.sort_order;';
  new_sort text := $replacement$
  order by r.submitted_at, r.id, tq.sort_order, an.id
  limit case
    when (f->>'__page_limit') ~ '^[0-9]{1,3}$'
    then least(greatest((f->>'__page_limit')::int, 1), 500)
    else null
  end
  offset case
    when (f->>'__page_offset') ~ '^[0-9]{1,9}$'
    then (f->>'__page_offset')::int
    else 0
  end;$replacement$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='feedback_admin_answer_facts';
  IF src IS NULL OR position(old_sort in src)=0 THEN
    RAISE EXCEPTION 'feedback_answer_facts_order_anchor_mismatch';
  END IF;
  IF position('private.feedback_can_view_results()' in src)=0
     OR position('left join public.activities a on a.row_id = c.activity_row_id' in src)=0 THEN
    RAISE EXCEPTION 'feedback_answer_facts_security_or_cohort_guard_missing';
  END IF;
  EXECUTE replace(src, old_sort, new_sort);
END
$patch$;
NOTIFY pgrst,'reload schema';
