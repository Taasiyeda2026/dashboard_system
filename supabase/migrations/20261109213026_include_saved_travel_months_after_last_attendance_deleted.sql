-- Read only an authenticated instructor's own saved travel months.
CREATE OR REPLACE FUNCTION public.av2_list_instructor_saved_travel_months()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_emp bigint;
BEGIN
  SELECT u.emp_id::bigint INTO v_emp
  FROM public.users u
  WHERE u.auth_user_id=auth.uid()
    AND u.is_active=true
    AND u.role IN ('instructor','מדריך')
  LIMIT 1;
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'attendance_travel_instructor_required' USING errcode='42501';
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(months.month_key ORDER BY months.month_key DESC),'[]'::jsonb)
    FROM (
      SELECT DISTINCT to_char(d.travel_date,'YYYY-MM') AS month_key
      FROM public.attendance_daily_travel_reports d
      WHERE d.emp_id=v_emp
    ) months
  );
END;
$function$
;
REVOKE ALL ON FUNCTION public.av2_list_instructor_saved_travel_months() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.av2_list_instructor_saved_travel_months() TO authenticated;
