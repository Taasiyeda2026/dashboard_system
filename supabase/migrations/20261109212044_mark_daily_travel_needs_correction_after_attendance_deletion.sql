-- Keep saved travel when attendance is deleted; require route correction before approval.
-- The existing review-invalidation trigger retracts previously approved payroll values first.
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

  UPDATE public.attendance_daily_travel_reports d
  SET review_status='rejected',
      approved_km=NULL,
      approved_cancellation_minutes=NULL,
      approved_public_transport_cost=NULL,
      review_by=NULL,
      review_at=NULL,
      review_note=NULL,
      updated_at=now()
  WHERE d.emp_id=OLD.emp_id
    AND d.travel_date=OLD.report_date
    AND (d.no_travel OR NOT public.av2_daily_travel_route_matches(d.emp_id,d.travel_date,d.legs))
    AND (d.review_status <> 'rejected'
      OR d.approved_km IS NOT NULL
      OR d.approved_cancellation_minutes IS NOT NULL
      OR d.approved_public_transport_cost IS NOT NULL);

  RETURN OLD;
END;
$function$
;

REVOKE ALL ON FUNCTION public.av2_mark_daily_travel_after_attendance_delete()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS av2_mark_daily_travel_after_attendance_delete
  ON public.attendance_records;
CREATE TRIGGER av2_mark_daily_travel_after_attendance_delete
AFTER DELETE ON public.attendance_records
FOR EACH ROW
EXECUTE FUNCTION public.av2_mark_daily_travel_after_attendance_delete();

-- Reconcile already-invalid saved reports without changing entered legs or totals.
UPDATE public.attendance_daily_travel_reports d
SET review_status='rejected',
    approved_km=NULL,
    approved_cancellation_minutes=NULL,
    approved_public_transport_cost=NULL,
    review_by=NULL,
    review_at=NULL,
    review_note=NULL,
    updated_at=now()
WHERE d.review_status='pending_review'
  AND (
    (d.no_travel AND (
      SELECT COUNT(*) FROM public.attendance_records a
      WHERE a.emp_id=d.emp_id AND a.report_date=d.travel_date
        AND a.generation_kind IS NULL AND a.activity_type NOT IN ('זום','ביטול זמן')
        AND COALESCE(a.training_mode::text,'physical')<>'online'
        AND COALESCE(a.operation_meeting_mode,'physical')<>'online'
    ) <> 1)
    OR (NOT d.no_travel
      AND NOT public.av2_daily_travel_route_matches(d.emp_id,d.travel_date,d.legs))
  );
