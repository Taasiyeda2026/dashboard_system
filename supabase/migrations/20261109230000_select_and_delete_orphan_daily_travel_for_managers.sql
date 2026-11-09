-- List only authorized managers' daily travel reports with no physical attendance.
-- Delete requires explicit action, an open month and a repeat no-attendance check.
CREATE OR REPLACE FUNCTION public.av2_list_orphan_daily_travel_for_review(p_from_date date, p_to_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_role text;v_name text;v_result jsonb;
BEGIN
 SELECT lower(coalesce(u.role,'')),coalesce(u.full_name,u.name,u.username)
 INTO v_role,v_name FROM public.users u
 WHERE u.auth_user_id=auth.uid() AND u.is_active=true LIMIT 1;

 IF v_role NOT IN ('admin','operation_manager','manager','instructor_manager','activities_manager') THEN
   RAISE EXCEPTION 'attendance_travel_read_denied' USING errcode='42501';
 END IF;
 IF p_from_date IS NULL OR p_to_date IS NULL OR p_to_date<p_from_date
    OR p_to_date>p_from_date+interval '62 days' THEN
   RAISE EXCEPTION 'attendance_travel_query_invalid' USING errcode='22023';
 END IF;

 SELECT COALESCE(jsonb_agg(jsonb_build_object(
   'emp_id',d.emp_id,'employee_name',coalesce(ci.full_name,d.emp_id::text),
   'travel_date',d.travel_date,'total_km',d.total_km,
   'cancellation_minutes',d.cancellation_minutes,
   'public_transport_cost',d.public_transport_cost,
   'review_status',d.review_status,
   'can_delete',NOT public.av2_attendance_month_is_closed(d.emp_id,d.travel_date)
 ) ORDER BY ci.full_name,d.emp_id,d.travel_date),'[]'::jsonb) INTO v_result
 FROM public.attendance_daily_travel_reports d
 LEFT JOIN LATERAL (
   SELECT c.full_name,c.direct_manager FROM public.contacts_instructors c
   WHERE c.emp_id=d.emp_id LIMIT 1
 ) ci ON true
 WHERE d.travel_date BETWEEN p_from_date AND p_to_date
 AND (
   v_role IN ('admin','operation_manager')
   OR lower(trim(coalesce(ci.direct_manager,'')))=lower(trim(coalesce(v_name,'')))
 )
 AND NOT EXISTS (
   SELECT 1 FROM public.attendance_records a
   WHERE a.emp_id=d.emp_id AND a.report_date=d.travel_date
     AND a.generation_kind IS NULL
     AND a.activity_type NOT IN ('זום','ביטול זמן')
     AND coalesce(a.training_mode::text,'physical')<>'online'
     AND coalesce(a.operation_meeting_mode,'physical')<>'online'
 );
 RETURN v_result;
END;
$function$
;
REVOKE ALL ON FUNCTION public.av2_list_orphan_daily_travel_for_review(date,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.av2_list_orphan_daily_travel_for_review(date,date) TO authenticated;

CREATE OR REPLACE FUNCTION public.av2_delete_orphan_daily_travel(p_emp_id bigint, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_role text;v_name text;v_manager text;
 v_report public.attendance_daily_travel_reports%rowtype;
BEGIN
 SELECT lower(coalesce(u.role,'')),coalesce(u.full_name,u.name,u.username)
 INTO v_role,v_name FROM public.users u
 WHERE u.auth_user_id=auth.uid() AND u.is_active=true LIMIT 1;

 IF p_emp_id IS NULL OR p_date IS NULL OR p_date<date '2026-11-01' THEN
   RAISE EXCEPTION 'attendance_travel_query_invalid' USING errcode='22023';
 END IF;
 IF v_role NOT IN ('admin','operation_manager','manager','instructor_manager','activities_manager') THEN
   RAISE EXCEPTION 'attendance_travel_delete_denied' USING errcode='42501';
 END IF;
 IF v_role NOT IN ('admin','operation_manager') THEN
   SELECT c.direct_manager INTO v_manager FROM public.contacts_instructors c
   WHERE c.emp_id=p_emp_id LIMIT 1;
   IF lower(trim(coalesce(v_manager,'')))<>lower(trim(coalesce(v_name,''))) THEN
     RAISE EXCEPTION 'attendance_travel_delete_denied' USING errcode='42501';
   END IF;
 END IF;

 IF public.av2_attendance_month_is_closed(p_emp_id,p_date) THEN
   RAISE EXCEPTION 'attendance_month_locked' USING errcode='55000';
 END IF;

 SELECT * INTO v_report FROM public.attendance_daily_travel_reports d
 WHERE d.emp_id=p_emp_id AND d.travel_date=p_date FOR UPDATE;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'attendance_travel_report_missing' USING errcode='22023';
 END IF;

 IF EXISTS (
  SELECT 1 FROM public.attendance_records a
  WHERE a.emp_id=p_emp_id AND a.report_date=p_date
    AND a.generation_kind IS NULL
    AND a.activity_type NOT IN ('זום','ביטול זמן')
    AND coalesce(a.training_mode::text,'physical')<>'online'
    AND coalesce(a.operation_meeting_mode,'physical')<>'online'
 ) THEN
   RAISE EXCEPTION 'attendance_travel_has_attendance' USING errcode='22023';
 END IF;

 INSERT INTO public.attendance_daily_travel_audit(
   emp_id,travel_date,previous_status,previous_approved_km,
   previous_approved_cancellation_minutes,
   previous_approved_public_transport_cost,reason,actor)
 VALUES (v_report.emp_id,v_report.travel_date,v_report.review_status,
   v_report.approved_km,v_report.approved_cancellation_minutes,
   v_report.approved_public_transport_cost,
   'orphan_daily_travel_deleted',auth.uid());

 DELETE FROM public.attendance_daily_travel_reports d
 WHERE d.id=v_report.id;

 PERFORM set_config('app.av2_compensation_write','1',true);
 DELETE FROM public.attendance_records a
 WHERE a.emp_id=p_emp_id AND a.report_date=p_date
   AND (a.generation_kind='daily_travel_cancellation'
        OR (a.generation_kind IS NULL AND a.activity_type='ביטול זמן'));

 RETURN jsonb_build_object('deleted',true,'emp_id',p_emp_id,'travel_date',p_date);
END;
$function$
;
REVOKE ALL ON FUNCTION public.av2_delete_orphan_daily_travel(bigint,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.av2_delete_orphan_daily_travel(bigint,date) TO authenticated;
