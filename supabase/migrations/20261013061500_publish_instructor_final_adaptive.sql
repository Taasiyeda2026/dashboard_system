-- Release the ten previously reviewed instructor-final adaptive questionnaires.
-- Deploy UI and adaptive backend before applying this migration.
-- All existing questionnaire submissions are permanently bound to their original template_version_id.
DO $release$
DECLARE
  v_count integer;
  v_template record;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.feedback_templates t
  JOIN public.feedback_programs p ON p.key=t.program_key AND p.is_active
  JOIN public.feedback_template_versions v ON v.template_id=t.id AND v.status='draft'
  WHERE t.audience='instructor' AND t.stage='final';

  IF v_count <> 10 THEN
    RAISE EXCEPTION 'feedback_release_expected_ten_drafts, found %', v_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.feedback_templates t
    JOIN public.feedback_programs p ON p.key=t.program_key AND p.is_active
    JOIN public.feedback_template_versions v ON v.template_id=t.id AND v.status='draft'
    LEFT JOIN public.feedback_template_questions tq ON tq.version_id=v.id
    WHERE t.audience='instructor' AND t.stage='final'
    GROUP BY t.id,v.id
    HAVING count(tq.id)<>35
       OR count(tq.id) FILTER (WHERE tq.scoring ? 'visible_when')<>5
       OR count(tq.id) FILTER (WHERE nullif(tq.wording->>'ar','') IS NULL)>0
       OR count(tq.id) FILTER (
         WHERE tq.question_type IN ('single_select','multi_select')
         AND EXISTS (
           SELECT 1 FROM jsonb_array_elements(tq.options) o
           WHERE nullif(o->>'label_ar','') IS NULL
         )
       )>0
  ) THEN RAISE EXCEPTION 'feedback_release_invalid_template_content'; END IF;

  IF EXISTS (
    SELECT 1
    FROM public.feedback_templates t
    JOIN public.feedback_programs p ON p.key=t.program_key AND p.is_active
    JOIN public.feedback_template_versions v ON v.template_id=t.id AND v.status='draft'
    JOIN public.feedback_template_questions child ON child.version_id=v.id
    WHERE t.audience='instructor' AND t.stage='final'
      AND child.scoring ? 'visible_when'
      AND NOT EXISTS (
        SELECT 1 FROM public.feedback_template_questions parent
        WHERE parent.version_id=child.version_id
          AND parent.id::text = child.scoring #>> '{visible_when,parent_id}'
          AND parent.sort_order < child.sort_order
      )
  ) THEN RAISE EXCEPTION 'feedback_release_invalid_branch'; END IF;

  FOR v_template IN
    SELECT t.program_key,v.id AS version_id
    FROM public.feedback_templates t
    JOIN public.feedback_programs p ON p.key=t.program_key AND p.is_active
    JOIN public.feedback_template_versions v ON v.template_id=t.id AND v.status='draft'
    WHERE t.audience='instructor' AND t.stage='final'
    ORDER BY t.program_key
  LOOP
    PERFORM private.feedback_publish_version(v_template.version_id);
  END LOOP;

  IF (
    SELECT count(*) FROM public.feedback_templates t
    JOIN public.feedback_programs p ON p.key=t.program_key AND p.is_active
    JOIN public.feedback_template_versions v ON v.id=t.current_version_id
    WHERE t.audience='instructor' AND t.stage='final'
      AND v.status='published'
      AND (SELECT count(*) FROM public.feedback_template_questions q WHERE q.version_id=v.id) = 35
  ) <> 10 THEN RAISE EXCEPTION 'feedback_release_failed_to_activate_all'; END IF;
END $release$;
