-- One transaction for one instructor's historical travel day. Keep existing RLS
-- and lifecycle/payroll triggers; never elevate the caller's privileges.
CREATE OR REPLACE FUNCTION public.av2_save_historical_travel_batch(
  p_emp_id bigint, p_date date, p_changes jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $function$
DECLARE
  item jsonb;
  original public.attendance_records%rowtype;
  km numeric;
  before_minutes integer;
  after_minutes integer;
  changed_ids uuid[] := ARRAY[]::uuid[];
  result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users u WHERE u.auth_user_id=auth.uid()
      AND u.emp_id::bigint=p_emp_id AND u.is_active=true
      AND lower(u.role) IN ('instructor','מדריך')
  ) THEN RAISE EXCEPTION 'attendance_travel_instructor_required' USING errcode='42501'; END IF;
  IF p_date IS NULL OR p_date>=date '2026-11-01'
      OR NOT public.av2_can_write_month(p_date) THEN
    RAISE EXCEPTION 'attendance_month_locked' USING errcode='42501';
  END IF;
  IF jsonb_typeof(p_changes) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'attendance_travel_batch_invalid' USING errcode='22023';
  END IF;
  IF jsonb_array_length(p_changes) NOT BETWEEN 1 AND 50
      OR (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_changes))<>jsonb_array_length(p_changes) THEN
    RAISE EXCEPTION 'attendance_travel_batch_invalid' USING errcode='22023';
  END IF;
  -- Deterministic locking prevents deadlocks between overlapping submissions.
  FOR item IN SELECT value FROM jsonb_array_elements(p_changes) ORDER BY value->>'id' LOOP
    SELECT * INTO original FROM public.attendance_records a
      WHERE a.id=(item->>'id')::uuid AND a.emp_id=p_emp_id
        AND a.report_date=p_date AND a.generation_kind IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'attendance_travel_record_unavailable' USING errcode='42501'; END IF;
    IF jsonb_typeof(item->'payload') IS DISTINCT FROM 'object'
      OR EXISTS(SELECT 1 FROM jsonb_object_keys(item->'payload') AS keys(k)
        WHERE k NOT IN ('roundtrip_km','cancellation_before_minutes','cancellation_after_minutes'))
      OR NOT (item->'payload' ?& ARRAY['roundtrip_km','cancellation_before_minutes','cancellation_after_minutes']) THEN
      RAISE EXCEPTION 'attendance_travel_batch_invalid' USING errcode='22023';
    END IF;
    km := (item->'payload'->>'roundtrip_km')::numeric;
    before_minutes := (item->'payload'->>'cancellation_before_minutes')::integer;
    after_minutes := (item->'payload'->>'cancellation_after_minutes')::integer;
    IF km<0 OR km>2000 OR before_minutes NOT BETWEEN 0 AND 359
      OR after_minutes NOT BETWEEN 0 AND 359
      OR (before_minutes IS NULL)<>(after_minutes IS NULL) THEN
      RAISE EXCEPTION 'attendance_travel_leg_value_invalid' USING errcode='22023';
    END IF;
    -- A retry of an already committed batch is a no-op, preserving approvals.
    IF original.roundtrip_km IS DISTINCT FROM km
      OR original.cancellation_before_minutes IS DISTINCT FROM before_minutes
      OR original.cancellation_after_minutes IS DISTINCT FROM after_minutes THEN
      IF item->>'expected_updated_at' IS NULL OR original.updated_at IS DISTINCT FROM (item->>'expected_updated_at')::timestamptz THEN
        RAISE EXCEPTION 'הרשומה השתנתה בשרת. יש לבדוק את הנתונים לפני שמירה נוספת.' USING errcode='PT409';
      END IF;
      UPDATE public.attendance_records SET roundtrip_km=km,
        cancellation_before_minutes=before_minutes,cancellation_after_minutes=after_minutes,
        updated_at=now() WHERE id=original.id AND emp_id=p_emp_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'attendance_travel_record_unavailable' USING errcode='42501'; END IF;
    END IF;
    changed_ids := array_append(changed_ids,original.id);
  END LOOP;
  SELECT jsonb_agg(jsonb_build_object('id',id,'roundtrip_km',roundtrip_km,
    'cancellation_before_minutes',cancellation_before_minutes,
    'cancellation_after_minutes',cancellation_after_minutes)) INTO result
    FROM public.attendance_records WHERE id=ANY(changed_ids) AND emp_id=p_emp_id;
  RETURN result;
END;
$function$;
REVOKE ALL ON FUNCTION public.av2_save_historical_travel_batch(bigint,date,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.av2_save_historical_travel_batch(bigint,date,jsonb) TO authenticated;
