-- STAGED ONLY. No historical backfill or production execution is authorized.
-- Approved rule: delete the complete daily chain; preserve other attendance.
-- Replace the previous 'mark for correction' behavior with atomic deletion.
-- Deleting any physical attendance activity deletes its day-level travel,
-- time cancellation and generated payroll compensation for that day.
CREATE OR REPLACE FUNCTION public.av2_mark_daily_travel_after_attendance_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.generation_kind IS NOT NULL
     OR OLD.report_date < DATE '2026-11-01'
     OR OLD.activity_type IN ('זום','ביטול זמן')
     OR COALESCE(OLD.training_mode::text,'physical')='online'
     OR COALESCE(OLD.operation_meeting_mode,'physical')='online'
  THEN
    RETURN OLD;
  END IF;

  -- The existing attendance-change trigger first retracts approved travel.
  -- Keep an audit trace of deletion, but never keep the obsolete trip in reports.
  INSERT INTO public.attendance_daily_travel_audit (
    emp_id,travel_date,previous_status,previous_approved_km,
    previous_approved_cancellation_minutes,
    previous_approved_public_transport_cost,reason,actor
  )
  SELECT d.emp_id,d.travel_date,d.review_status,d.approved_km,
    d.approved_cancellation_minutes,d.approved_public_transport_cost,
    'attendance_deleted_travel_removed',auth.uid()
  FROM public.attendance_daily_travel_reports d
  WHERE d.emp_id=OLD.emp_id AND d.travel_date=OLD.report_date;

  DELETE FROM public.attendance_daily_travel_reports d
  WHERE d.emp_id=OLD.emp_id AND d.travel_date=OLD.report_date;

  PERFORM set_config('app.av2_compensation_write','1',true);

  -- Prevent an orphaned day-level approved payable from being counted in wages.
  DELETE FROM public.attendance_records a
  WHERE a.emp_id=OLD.emp_id AND a.report_date=OLD.report_date
    AND a.generation_kind='daily_travel_cancellation';

  -- Independent/manual attendance is not linked to this daily chain.
  -- Source-linked legacy compensation is removed by the existing FK cascade.
  -- Do not delete another attendance record merely because its date matches.

  RETURN OLD;
END;
$function$
;
REVOKE ALL ON FUNCTION public.av2_mark_daily_travel_after_attendance_delete() FROM PUBLIC, anon, authenticated;
