-- Student questionnaires follow live activity dates, not payroll attendance.
-- A moved date changes eligibility automatically; cancelled meetings do not count.
-- Never send mail in this migration. Scheduled delivery still rechecks eligibility.
DO $migration$
DECLARE
  fn text;
  old_attendance text := $old$
 and exists(
  select 1 from public.attendance_records ar
  where ar.activity_row_id=a.row_id
    and ar.report_date=v.dt
    and ar.generation_kind is null
    and ar.total_hours>0
    and (ar.meeting_no=v.slot or ar.meeting_no is null)
    and ar.activity_type in ('קורס','course','חוג','תוכנית')
 )$old$;
  old_count_gate text := $old$and (v.stage='pre' or (a.active_count >= 3 and a.expected_sessions is not null
     and a.active_count >= a.expected_sessions))$old$;
  new_count_gate text := $new$and (v.stage='pre' or a.active_count >= 3)$new$;
  old_year_gate text := $old$where a.start_date < date '2027-01-31'$old$;
  new_year_gate text := $new$where a.start_date between date '2026-09-01' and date '2027-06-30'$new$;
  old_portal_clause text := $old$        and (a.emp_id::text = v_emp_id or a.emp_id_2 = v_emp_id)$old$;
  new_portal_clause text := $new$        and (a.emp_id::text = v_emp_id or a.emp_id_2 = v_emp_id)
        -- The current activity schedule decides whether the questionnaire is due.
        -- This also hides an already-created campaign if its meeting is postponed.
        and exists (
          select 1 from public.feedback_auto_candidates(now()) eligibility
          where eligibility.audience = 'student'
            and eligibility.activity_row_id = c.activity_row_id
            and eligibility.program_key = c.program_key
            and eligibility.stage = c.stage
            and eligibility.instructor_emp_id = v_emp_id
            and eligibility.eligible_at <= now()
        )$new$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO fn
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'feedback_auto_candidates';

  IF fn IS NULL THEN RAISE EXCEPTION 'feedback_auto_candidates not found'; END IF;
  IF position(old_attendance IN fn) = 0 THEN
    IF position('public.attendance_records ar' IN fn) > 0 THEN
      RAISE EXCEPTION 'Unexpected attendance prerequisite: refusing unsafe replacement';
    END IF;
  ELSE
    fn := replace(fn, old_attendance, '');
  END IF;

  IF position(old_count_gate IN fn) > 0 THEN
    fn := replace(fn, old_count_gate, new_count_gate);
  ELSIF position(new_count_gate IN fn) = 0 THEN
    RAISE EXCEPTION 'Unexpected student final-stage gate';
  END IF;

  IF position(old_year_gate IN fn) > 0 THEN
    fn := replace(fn, old_year_gate, new_year_gate);
  ELSIF position(new_year_gate IN fn) = 0 THEN
    RAISE EXCEPTION 'Unexpected first-half-only student gate';
  END IF;
  EXECUTE fn;

  SELECT pg_get_functiondef(p.oid) INTO fn
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'feedback_instructor_portal_items';
  IF fn IS NULL THEN RAISE EXCEPTION 'feedback_instructor_portal_items not found'; END IF;
  IF position(new_portal_clause IN fn) = 0 THEN
    IF position(old_portal_clause IN fn) = 0 THEN
      RAISE EXCEPTION 'Unexpected instructor portal activity-scope clause';
    END IF;
    fn := replace(fn, old_portal_clause, new_portal_clause);
    EXECUTE fn;
  END IF;
END
$migration$;

-- Keep the existing identity-scoped RPC grants and all delivery audit records intact.
NOTIFY pgrst, 'reload schema';
