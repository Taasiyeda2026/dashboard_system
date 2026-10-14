-- Missing course feedback delivery data must be revisited on each daily
-- preparation cycle. Never retry accepted, in-flight or ambiguous Graph sends.
-- A missing grade is informational only; student feedback is program-based.
-- Staff opening feedback predating activation was approved for backfill.
DO $fix$
DECLARE
  patch record;
  definition text;
BEGIN
  FOR patch IN
    SELECT * FROM (VALUES
      ('feedback_auto_begin',
       $old$c.cc_email is null or c.age_band is null or c.activity_row_id<>d.activity_row_id$old$,
       $new$c.cc_email is null or c.activity_row_id<>d.activity_row_id$new$),
      ('feedback_staff_auto_prepare',
       $old$if existing.status in ('failed','needs_attention') then continue; end if;$old$,
       $new$if existing.status in ('failed','needs_attention') and existing.graph_started_at is not null then continue; end if;$new$),
      ('feedback_staff_auto_claim',
       $old$c.eligibility_at<ctl.activation_at$old$,
       $new$(c.eligibility_at<ctl.activation_at and o.stage<>'pre')$new$),
      ('feedback_auto_schedule_instructor_pre',
       $old$if not exists (select 1 from public.contacts_instructors i where i.emp_id::text=p_instructor_emp_id and
    i.email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+[.][A-Z]{2,}$')
 then raise exception 'feedback_instructor_invalid_email'; end if;$old$,
       $new$if not exists (select 1 from public.contacts_instructors i where i.emp_id::text=p_instructor_emp_id)
 then raise exception 'feedback_instructor_not_found'; end if;$new$)
    ) AS v(function_name, before_text, after_text)
  LOOP
    SELECT pg_get_functiondef(p.oid) INTO definition
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname=patch.function_name;
    IF definition IS NULL THEN
      RAISE EXCEPTION 'feedback_retry_missing_function: %', patch.function_name;
    END IF;
    IF position(patch.after_text IN definition)>0 THEN CONTINUE; END IF;
    IF position(patch.before_text IN definition)=0 THEN
      RAISE EXCEPTION 'feedback_retry_anchor_missing: %', patch.function_name;
    END IF;
    definition:=replace(definition, patch.before_text, patch.after_text);
    EXECUTE definition;
  END LOOP;
END
$fix$;
