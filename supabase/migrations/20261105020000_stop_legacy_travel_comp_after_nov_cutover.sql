-- Stop creating legacy attendance_travel_compensations for report_date >= 2026-11-01.
-- Preserve every existing compensation row (including residual November rows).
-- Historical months continue to use the legacy prepare/reconcile/report path unchanged.

DO $cutover_context$
DECLARE
  v_oid oid;
  v_def text;
  v_marker text := $m$if not found then
    raise exception 'attendance_source_not_found' using errcode = '22023';
  end if;

  excluded_type :=$m$;
  v_replacement text := $m$if not found then
    raise exception 'attendance_source_not_found' using errcode = '22023';
  end if;

  -- Daily-travel UI owns November 2026 onward; keep legacy mechanism for earlier months only.
  if s.report_date >= date '2026-11-01' then
    return jsonb_build_object(
      'eligible', false,
      'source_id', s.id,
      'reason', 'daily_travel_cutover',
      'report_date', s.report_date
    );
  end if;

  excluded_type :=$m$;
BEGIN
  SELECT p.oid, pg_get_functiondef(p.oid)
    INTO v_oid, v_def
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname = 'av2_attendance_travel_context'
  ORDER BY p.oid DESC
  LIMIT 1;

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'av2_attendance_travel_context_missing';
  END IF;

  IF position('daily_travel_cutover' IN v_def) > 0 THEN
    RAISE NOTICE 'av2_attendance_travel_context already has daily_travel_cutover';
  ELSE
    IF position(v_marker IN v_def) = 0 THEN
      RAISE EXCEPTION 'av2_attendance_travel_context_structure_changed';
    END IF;
    EXECUTE replace(v_def, v_marker, v_replacement);
  END IF;
END
$cutover_context$;

DO $cutover_prepare$
DECLARE
  v_oid oid;
  v_def text;
  v_marker text := $m$ctx := public.av2_attendance_travel_context(p_source_id, p_actor_id);

  select * into old$m$;
  v_replacement text := $m$ctx := public.av2_attendance_travel_context(p_source_id, p_actor_id);

  -- Never create or delete legacy compensation rows after the daily-travel cutover.
  -- Existing November residuals stay readable; new writes go through daily travel only.
  if coalesce(ctx->>'reason', '') = 'daily_travel_cutover' then
    return ctx;
  end if;

  select * into old$m$;
BEGIN
  SELECT p.oid, pg_get_functiondef(p.oid)
    INTO v_oid, v_def
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname = 'av2_prepare_attendance_travel'
  ORDER BY p.oid DESC
  LIMIT 1;

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'av2_prepare_attendance_travel_missing';
  END IF;

  IF position('daily_travel_cutover' IN v_def) > 0 THEN
    RAISE NOTICE 'av2_prepare_attendance_travel already has daily_travel_cutover guard';
  ELSE
    IF position(v_marker IN v_def) = 0 THEN
      RAISE EXCEPTION 'av2_prepare_attendance_travel_structure_changed';
    END IF;
    EXECUTE replace(v_def, v_marker, v_replacement);
  END IF;
END
$cutover_prepare$;

DO $cutover_report$
DECLARE
  v_oid oid;
  v_def text;
  v_marker text := $m$if not found or not public.av2_can_write_month(s.report_date) then
    raise exception 'attendance_month_locked' using errcode = '42501';
  end if;

  perform public.av2_prepare_attendance_travel(p_source_id, auth.uid());$m$;
  v_replacement text := $m$if not found or not public.av2_can_write_month(s.report_date) then
    raise exception 'attendance_month_locked' using errcode = '42501';
  end if;

  if s.report_date >= date '2026-11-01' then
    raise exception 'attendance_daily_travel_report_required' using errcode = '22023';
  end if;

  perform public.av2_prepare_attendance_travel(p_source_id, auth.uid());$m$;
BEGIN
  SELECT p.oid, pg_get_functiondef(p.oid)
    INTO v_oid, v_def
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname = 'av2_report_attendance_travel_time'
  ORDER BY p.oid DESC
  LIMIT 1;

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'av2_report_attendance_travel_time_missing';
  END IF;

  IF position('attendance_daily_travel_report_required' IN v_def) > 0 THEN
    RAISE NOTICE 'av2_report_attendance_travel_time already blocks post-cutover dates';
  ELSE
    IF position(v_marker IN v_def) = 0 THEN
      RAISE EXCEPTION 'av2_report_attendance_travel_time_structure_changed';
    END IF;
    EXECUTE replace(v_def, v_marker, v_replacement);
  END IF;
END
$cutover_report$;
