-- Read-only expansion of the submitted version, opt-in for raw questionnaire views.
-- The default facts contract, access guard, scope predicates and grants stay intact.
DO $patch$
DECLARE
  src text;
  old_from text := 'from public.feedback_answers an
  join public.feedback_responses r on r.id = an.response_id';
  new_from text := 'from public.feedback_responses r
  join public.feedback_template_questions tq on tq.version_id = r.template_version_id
  left join public.feedback_answers an on an.response_id = r.id and an.template_question_id = tq.id';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'feedback_admin_answer_facts';
  IF src IS NULL OR position(old_from in src) = 0
     OR position('private.feedback_can_view_results()' in src) = 0
     OR position('left join public.activities a on a.row_id = c.activity_row_id' in src) = 0
     OR position('__page_limit' in src) = 0
     OR position('join public.feedback_template_questions tq on tq.id = an.template_question_id' in src) = 0
     OR position('order by r.submitted_at, r.id, tq.sort_order, an.id' in src) = 0 THEN
    RAISE EXCEPTION 'feedback_complete_questionnaires_anchor_mismatch';
  END IF;
  src := replace(src, old_from, new_from);
  src := replace(src, 'join public.feedback_template_questions tq on tq.id = an.template_question_id', '');
  src := replace(src, 'join public.feedback_template_versions v on v.id = c.template_version_id',
                       'join public.feedback_template_versions v on v.id = r.template_version_id');
  src := replace(src, 'join public.feedback_questions q on q.id = an.question_id',
                       'join public.feedback_questions q on q.id = tq.question_id');
  src := replace(src, 'c.template_version_id, v.version_no', 'r.template_version_id, v.version_no');
  src := replace(src, 'an.question_id, q.question_key', 'tq.question_id, q.question_key');
  src := replace(src, 'an.metric_key, an.question_type',
                       'coalesce(an.metric_key, tq.metric_key), coalesce(an.question_type, tq.question_type)');
  src := replace(src, 'tq.is_comparison, tq.scoring, tq.options',
    'tq.is_comparison, case when f->>''__complete_questionnaires'' = ''true''
      then tq.scoring || jsonb_build_object(''__template_question_id'', tq.id)
      else tq.scoring end, tq.options');
  src := replace(src, 'where (c.activity_row_id is null',
    'where (an.id is not null or f->>''__complete_questionnaires'' = ''true'')
    and (c.activity_row_id is null');
  IF position('where (an.id is not null' in src) = 0 THEN
    RAISE EXCEPTION 'feedback_complete_questionnaires_scope_anchor_mismatch';
  END IF;
  src := replace(src, 'order by r.submitted_at, r.id, tq.sort_order, an.id',
                       'order by r.submitted_at, r.id, tq.sort_order, tq.id, an.id');
  EXECUTE src;
END
$patch$;
NOTIFY pgrst, 'reload schema';
