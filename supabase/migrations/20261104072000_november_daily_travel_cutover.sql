-- Cutover is aligned with the first day of the open November payroll period.
-- This migration does not modify existing attendance, travel compensation, or payroll rows.
-- Historical September/October periods retain their existing review and payroll state.
DO $cutover$
DECLARE v_proc record; v_definition text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.attendance_records
    WHERE report_date >= DATE '2026-11-01' AND report_date < DATE '2026-11-04'
      AND generation_kind IN ('travel_time_cancellation','daily_travel_cancellation')
  ) THEN
    RAISE EXCEPTION 'november_cutover_existing_payable_requires_reconciliation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.attendance_travel_compensations c
    JOIN public.attendance_records a ON a.id=c.source_attendance_record_id
    WHERE a.report_date >= DATE '2026-11-01' AND a.report_date < DATE '2026-11-04'
      AND c.review_status IN ('approved','corrected')
  ) THEN
    RAISE EXCEPTION 'november_cutover_legacy_approval_requires_reconciliation';
  END IF;

  FOR v_proc IN
    SELECT oid, proname FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname = ANY (ARRAY[
        'av2_assert_payroll_travel_review_ready',
        'av2_invalidate_daily_travel_after_activity_change',
        'av2_list_instructor_travel_days',
        'av2_month_open_travel_reviews',
        'av2_review_attendance_travel_compensation',
        'av2_save_daily_travel',
        'av2_save_expense',
        'av2_submit_attendance_month',
        'av2_sync_daily_travel_payable',
        'av2_sync_travel_cancellation_payable',
        'get_payroll_attendance_records',
        'manager_finalize_attendance_month_review'
      ])
  LOOP
    v_definition := pg_get_functiondef(v_proc.oid);
    IF position('2026-11-04' IN v_definition)=0 THEN
      RAISE EXCEPTION 'missing_expected_cutover_in_%',v_proc.proname;
    END IF;
    EXECUTE replace(v_definition,'2026-11-04','2026-11-01');
  END LOOP;
END $cutover$;

-- A positive legacy approval must never be paid again by the daily engine,
-- even if an old compensation approval is written through a different path.
CREATE OR REPLACE FUNCTION public.av2_november_travel_legacy_conflict(p_emp_id bigint,p_date date)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $guard$
  SELECT EXISTS (
    SELECT 1 FROM public.attendance_travel_compensations c
    JOIN public.attendance_records a ON a.id=c.source_attendance_record_id
    WHERE a.emp_id=p_emp_id AND a.report_date=p_date
      AND c.review_status IN ('approved','corrected')
      AND coalesce(c.approved_cancellation_minutes,0)>0
  );
$guard$;
REVOKE ALL ON FUNCTION public.av2_november_travel_legacy_conflict(bigint,date) FROM PUBLIC,anon,authenticated;

DO $sync_guard$
DECLARE v_oid oid; v_def text;
BEGIN
  SELECT oid INTO v_oid FROM pg_proc
   WHERE pronamespace='public'::regnamespace
     AND proname='av2_sync_daily_travel_payable'
   LIMIT 1;
  v_def:=pg_get_functiondef(v_oid);
  IF position('select * into d from public.attendance_daily_travel_reports' IN lower(v_def))=0 THEN
    RAISE EXCEPTION 'sync_function_structure_changed';
  END IF;
  v_def:=replace(v_def,
    'select * into d from public.attendance_daily_travel_reports',
    'if public.av2_november_travel_legacy_conflict(p_emp_id,p_date) then
       raise exception ''attendance_existing_legacy_approved_travel_conflict'' using errcode=''22023'';
     end if;
     select * into d from public.attendance_daily_travel_reports');
  EXECUTE v_def;
END $sync_guard$;
