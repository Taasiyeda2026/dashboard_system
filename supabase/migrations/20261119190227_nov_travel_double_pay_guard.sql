-- Nov 2026 travel double-pay guard (canonical payroll exclusivity).
-- Does NOT rewrite historical attendance_records.roundtrip_km.
-- Production apply requires explicit owner approval after PR review.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Documented component resolutions (km / public transport / cancellation)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance_travel_payroll_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  emp_id bigint NOT NULL,
  travel_date date NOT NULL,
  component text NOT NULL CHECK (component IN ('kilometers', 'public_transport', 'cancellation')),
  legacy_value numeric(12,2) NOT NULL DEFAULT 0,
  daily_value numeric(12,2) NOT NULL DEFAULT 0,
  chosen_source text NOT NULL CHECK (chosen_source IN ('legacy', 'daily', 'manual')),
  approved_amount numeric(12,2) NOT NULL,
  reason text NOT NULL,
  resolved_by uuid NOT NULL,
  resolved_by_name text NOT NULL DEFAULT '',
  resolved_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_travel_payroll_resolutions_amount_nonneg CHECK (approved_amount >= 0),
  CONSTRAINT attendance_travel_payroll_resolutions_uniq UNIQUE (emp_id, travel_date, component),
  CONSTRAINT attendance_travel_payroll_resolutions_date_cutover CHECK (travel_date >= date '2026-11-01')
);

CREATE INDEX IF NOT EXISTS attendance_travel_payroll_resolutions_emp_date_idx
  ON public.attendance_travel_payroll_resolutions (emp_id, travel_date);

ALTER TABLE public.attendance_travel_payroll_resolutions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS attendance_travel_payroll_resolutions_select ON public.attendance_travel_payroll_resolutions;
CREATE POLICY attendance_travel_payroll_resolutions_select
  ON public.attendance_travel_payroll_resolutions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.auth_user_id = auth.uid() AND u.is_active = true
        AND lower(trim(coalesce(u.role, ''))) IN (
          'admin', 'operation_manager', 'finance',
          'manager', 'instructor_manager', 'activities_manager'
        )
    )
  );

REVOKE ALL ON public.attendance_travel_payroll_resolutions FROM PUBLIC, anon;
GRANT SELECT ON public.attendance_travel_payroll_resolutions TO authenticated;

COMMENT ON TABLE public.attendance_travel_payroll_resolutions IS
  'Documented entitlement decisions when legacy activity travel and daily travel disagree for the same instructor/day/component. Never auto-pays max().';

-- ---------------------------------------------------------------------------
-- 2) Legacy day totals (read-only aggregation; no mutation)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.av2_travel_day_legacy_totals(p_emp_id bigint, p_date date)
RETURNS TABLE (
  legacy_km numeric,
  legacy_pt numeric,
  legacy_cancel_minutes numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    coalesce(sum(coalesce(a.roundtrip_km, 0)) FILTER (WHERE a.generation_kind IS NULL), 0)::numeric,
    coalesce(sum(coalesce(a.public_transport_cost, 0)) FILTER (WHERE a.generation_kind IS NULL), 0)::numeric,
    (
      coalesce(sum(
        coalesce(a.cancellation_before_minutes, 0) + coalesce(a.cancellation_after_minutes, 0)
      ) FILTER (WHERE a.generation_kind IS NULL), 0)
      + coalesce((
          SELECT sum(coalesce(c.approved_cancellation_minutes, 0))
          FROM public.attendance_travel_compensations c
          JOIN public.attendance_records s ON s.id = c.source_attendance_record_id
          WHERE s.emp_id = p_emp_id AND s.report_date = p_date
            AND c.review_status IN ('approved', 'corrected')
        ), 0)
      + coalesce((
          SELECT sum(coalesce(g.total_hours, 0) * 60)
          FROM public.attendance_records g
          WHERE g.emp_id = p_emp_id AND g.report_date = p_date
            AND g.generation_kind = 'travel_time_cancellation'
        ), 0)
    )::numeric
  FROM public.attendance_records a
  WHERE a.emp_id = p_emp_id AND a.report_date = p_date;
$function$;

REVOKE ALL ON FUNCTION public.av2_travel_day_legacy_totals(bigint, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.av2_travel_amounts_compatible(p_left numeric, p_right numeric)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT abs(coalesce(p_left, 0) - coalesce(p_right, 0)) <= 0.01;
$function$;

REVOKE ALL ON FUNCTION public.av2_travel_amounts_compatible(numeric, numeric) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 3) Overlap / conflict detection per component
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.av2_travel_day_component_conflicts(
  p_emp_id bigint,
  p_date date,
  p_daily_km numeric DEFAULT NULL,
  p_daily_pt numeric DEFAULT NULL,
  p_daily_cancel numeric DEFAULT NULL,
  p_no_travel boolean DEFAULT NULL
)
RETURNS TABLE (
  component text,
  legacy_value numeric,
  daily_value numeric,
  status text,
  resolution_id uuid,
  chosen_source text,
  approved_amount numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_legacy_km numeric := 0;
  v_legacy_pt numeric := 0;
  v_legacy_cancel numeric := 0;
  v_daily public.attendance_daily_travel_reports%ROWTYPE;
  v_km numeric;
  v_pt numeric;
  v_cancel numeric;
  v_no_travel boolean;
  v_has_daily boolean := false;
BEGIN
  IF p_emp_id IS NULL OR p_date IS NULL OR p_date < date '2026-11-01' THEN
    RETURN;
  END IF;

  SELECT legacy_km, legacy_pt, legacy_cancel_minutes
  INTO v_legacy_km, v_legacy_pt, v_legacy_cancel
  FROM public.av2_travel_day_legacy_totals(p_emp_id, p_date);

  SELECT * INTO v_daily
  FROM public.attendance_daily_travel_reports d
  WHERE d.emp_id = p_emp_id AND d.travel_date = p_date;

  v_has_daily := FOUND;
  IF NOT v_has_daily AND p_daily_km IS NULL AND p_daily_pt IS NULL AND p_daily_cancel IS NULL AND p_no_travel IS NULL THEN
    -- Legacy-only day: no overlap conflict rows.
    RETURN;
  END IF;

  v_no_travel := coalesce(p_no_travel, v_daily.no_travel, false);
  IF v_has_daily AND v_daily.review_status IN ('approved', 'corrected') THEN
    v_km := coalesce(p_daily_km, v_daily.approved_km, 0);
    v_pt := coalesce(p_daily_pt, v_daily.approved_public_transport_cost, 0);
    v_cancel := coalesce(p_daily_cancel, v_daily.approved_cancellation_minutes, 0);
  ELSIF v_has_daily THEN
    v_km := coalesce(p_daily_km, CASE WHEN v_no_travel THEN 0 ELSE v_daily.total_km END, 0);
    v_pt := coalesce(p_daily_pt, CASE WHEN v_no_travel THEN 0 ELSE v_daily.public_transport_cost END, 0);
    v_cancel := coalesce(p_daily_cancel, CASE WHEN v_no_travel THEN 0 ELSE v_daily.cancellation_minutes END, 0);
  ELSE
    v_km := coalesce(p_daily_km, 0);
    v_pt := coalesce(p_daily_pt, 0);
    v_cancel := coalesce(p_daily_cancel, 0);
  END IF;

  IF v_no_travel THEN
    v_km := 0;
    v_pt := 0;
    v_cancel := 0;
  END IF;

  RETURN QUERY
  WITH comps AS (
    SELECT * FROM (VALUES
      ('kilometers'::text, coalesce(v_legacy_km, 0), coalesce(v_km, 0)),
      ('public_transport', coalesce(v_legacy_pt, 0), coalesce(v_pt, 0)),
      ('cancellation', coalesce(v_legacy_cancel, 0), coalesce(v_cancel, 0))
    ) AS t(component, legacy_value, daily_value)
  ),
  judged AS (
    SELECT
      c.component,
      c.legacy_value,
      c.daily_value,
      CASE
        WHEN c.legacy_value <= 0.01 AND c.daily_value <= 0.01 THEN 'none'
        WHEN c.legacy_value > 0.01 AND c.daily_value <= 0.01 AND NOT v_no_travel THEN 'legacy_only_with_daily_zero'
        WHEN c.legacy_value > 0.01 AND v_no_travel THEN 'no_travel_vs_legacy'
        WHEN c.legacy_value <= 0.01 AND c.daily_value > 0.01 THEN 'daily_only'
        WHEN public.av2_travel_amounts_compatible(c.legacy_value, c.daily_value) THEN 'compatible'
        ELSE 'conflict'
      END AS status
    FROM comps c
  )
  SELECT
    j.component,
    j.legacy_value,
    j.daily_value,
    CASE
      WHEN j.status IN ('compatible', 'daily_only', 'none') THEN j.status
      WHEN r.id IS NOT NULL THEN 'resolved'
      ELSE j.status
    END AS status,
    r.id,
    r.chosen_source,
    r.approved_amount
  FROM judged j
  LEFT JOIN public.attendance_travel_payroll_resolutions r
    ON r.emp_id = p_emp_id AND r.travel_date = p_date AND r.component = j.component
  WHERE j.status NOT IN ('none', 'daily_only')
     OR r.id IS NOT NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.av2_travel_day_component_conflicts(bigint, date, numeric, numeric, numeric, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.av2_travel_day_component_conflicts(bigint, date, numeric, numeric, numeric, boolean)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.av2_travel_day_has_unresolved_overlap(p_emp_id bigint, p_date date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.av2_travel_day_component_conflicts(p_emp_id, p_date)
    WHERE status IN ('conflict', 'no_travel_vs_legacy', 'legacy_only_with_daily_zero')
  );
$function$;

REVOKE ALL ON FUNCTION public.av2_travel_day_has_unresolved_overlap(bigint, date) FROM PUBLIC, anon, authenticated;

-- Expand legacy conflict guard used by payable sync.
CREATE OR REPLACE FUNCTION public.av2_november_travel_legacy_conflict(p_emp_id bigint, p_date date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.attendance_travel_compensations c
      JOIN public.attendance_records a ON a.id = c.source_attendance_record_id
      WHERE a.emp_id = p_emp_id AND a.report_date = p_date
        AND c.review_status IN ('approved', 'corrected')
        AND coalesce(c.approved_cancellation_minutes, 0) > 0
    )
    OR public.av2_travel_day_has_unresolved_overlap(p_emp_id, p_date);
$function$;

-- ---------------------------------------------------------------------------
-- 4) Resolve / list RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.av2_list_travel_payroll_overlaps(
  p_employee_ids bigint[] DEFAULT NULL,
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
  v_name text;
BEGIN
  SELECT lower(trim(coalesce(u.role, ''))),
         coalesce(nullif(trim(coalesce(u.full_name, '')), ''), nullif(trim(coalesce(u.name, '')), ''), nullif(trim(coalesce(u.username, '')), ''))
  INTO v_role, v_name
  FROM public.users u
  WHERE u.auth_user_id = auth.uid() AND u.is_active = true
  LIMIT 1;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'attendance_auth_required' USING ERRCODE = '42501';
  END IF;
  IF v_role NOT IN ('admin', 'operation_manager', 'finance', 'manager', 'instructor_manager', 'activities_manager') THEN
    RAISE EXCEPTION 'attendance_permission_denied' USING ERRCODE = '42501';
  END IF;

  RETURN (
    SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.emp_id, x.travel_date, x.component), '[]'::jsonb)
    FROM (
      SELECT
        d.emp_id,
        coalesce(ci.full_name, d.emp_id::text) AS employee_name,
        d.travel_date,
        c.component,
        c.legacy_value,
        c.daily_value,
        (c.daily_value - c.legacy_value) AS delta,
        c.status,
        d.review_status AS daily_review_status,
        d.no_travel,
        c.resolution_id,
        c.chosen_source,
        c.approved_amount,
        r.reason,
        r.resolved_by_name,
        r.resolved_at
      FROM public.attendance_daily_travel_reports d
      JOIN LATERAL public.av2_travel_day_component_conflicts(d.emp_id, d.travel_date) c ON true
      LEFT JOIN public.attendance_travel_payroll_resolutions r ON r.id = c.resolution_id
      LEFT JOIN public.contacts_instructors ci ON ci.emp_id = d.emp_id
      WHERE d.travel_date >= date '2026-11-01'
        AND (p_from_date IS NULL OR d.travel_date >= p_from_date)
        AND (p_to_date IS NULL OR d.travel_date <= p_to_date)
        AND (p_employee_ids IS NULL OR d.emp_id = ANY (p_employee_ids))
        AND (
          v_role IN ('admin', 'operation_manager', 'finance')
          OR lower(trim(coalesce(ci.direct_manager, ''))) = lower(trim(coalesce(v_name, '')))
        )
        AND c.status IN (
          'conflict', 'no_travel_vs_legacy', 'legacy_only_with_daily_zero',
          'compatible', 'resolved'
        )
    ) x
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.av2_list_travel_payroll_overlaps(bigint[], date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.av2_list_travel_payroll_overlaps(bigint[], date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.av2_resolve_travel_payroll_component(
  p_emp_id bigint,
  p_date date,
  p_component text,
  p_chosen_source text,
  p_approved_amount numeric,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
  v_name text;
  v_manager text;
  v_legacy_km numeric := 0;
  v_legacy_pt numeric := 0;
  v_legacy_cancel numeric := 0;
  v_daily public.attendance_daily_travel_reports%ROWTYPE;
  v_legacy_val numeric := 0;
  v_daily_val numeric := 0;
  v_amount numeric;
  v_row public.attendance_travel_payroll_resolutions%ROWTYPE;
BEGIN
  SELECT lower(trim(coalesce(u.role, ''))),
         coalesce(nullif(trim(coalesce(u.full_name, '')), ''), nullif(trim(coalesce(u.name, '')), ''), nullif(trim(coalesce(u.username, '')), ''))
  INTO v_role, v_name
  FROM public.users u
  WHERE u.auth_user_id = auth.uid() AND u.is_active = true
  LIMIT 1;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'attendance_auth_required' USING ERRCODE = '42501';
  END IF;
  IF v_role NOT IN ('admin', 'operation_manager', 'manager', 'instructor_manager', 'activities_manager') THEN
    RAISE EXCEPTION 'attendance_travel_review_denied' USING ERRCODE = '42501';
  END IF;
  IF v_role IN ('manager', 'instructor_manager', 'activities_manager') THEN
    SELECT direct_manager INTO v_manager FROM public.contacts_instructors WHERE emp_id = p_emp_id LIMIT 1;
    IF nullif(trim(v_name), '') IS NULL OR nullif(trim(v_manager), '') IS NULL
       OR lower(trim(coalesce(v_name, ''))) <> lower(trim(coalesce(v_manager, ''))) THEN
      RAISE EXCEPTION 'attendance_travel_review_denied' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_emp_id IS NULL OR p_date IS NULL OR p_date < date '2026-11-01'
     OR p_component NOT IN ('kilometers', 'public_transport', 'cancellation')
     OR p_chosen_source NOT IN ('legacy', 'daily', 'manual')
     OR nullif(btrim(coalesce(p_reason, '')), '') IS NULL
     OR p_approved_amount IS NULL OR p_approved_amount < 0 OR p_approved_amount > 100000 THEN
    RAISE EXCEPTION 'attendance_travel_resolution_invalid' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('av2-travel-resolve|' || p_emp_id || '|' || p_date || '|' || p_component, 0));

  IF public.av2_attendance_month_is_closed(p_emp_id, p_date) THEN
    RAISE EXCEPTION 'attendance_month_locked' USING ERRCODE = '55000';
  END IF;

  SELECT legacy_km, legacy_pt, legacy_cancel_minutes
  INTO v_legacy_km, v_legacy_pt, v_legacy_cancel
  FROM public.av2_travel_day_legacy_totals(p_emp_id, p_date);
  SELECT * INTO v_daily FROM public.attendance_daily_travel_reports
  WHERE emp_id = p_emp_id AND travel_date = p_date FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'attendance_travel_resolution_requires_daily' USING ERRCODE = '22023';
  END IF;

  v_legacy_val := CASE p_component
    WHEN 'kilometers' THEN coalesce(v_legacy_km, 0)
    WHEN 'public_transport' THEN coalesce(v_legacy_pt, 0)
    ELSE coalesce(v_legacy_cancel, 0)
  END;
  v_daily_val := CASE p_component
    WHEN 'kilometers' THEN CASE WHEN v_daily.no_travel THEN 0 ELSE coalesce(v_daily.total_km, 0) END
    WHEN 'public_transport' THEN CASE WHEN v_daily.no_travel THEN 0 ELSE coalesce(v_daily.public_transport_cost, 0) END
    ELSE CASE WHEN v_daily.no_travel THEN 0 ELSE coalesce(v_daily.cancellation_minutes, 0) END
  END;

  v_amount := CASE p_chosen_source
    WHEN 'legacy' THEN v_legacy_val
    WHEN 'daily' THEN v_daily_val
    ELSE p_approved_amount
  END;

  IF p_chosen_source = 'manual' AND p_approved_amount IS DISTINCT FROM v_amount THEN
    v_amount := p_approved_amount;
  END IF;

  INSERT INTO public.attendance_travel_payroll_resolutions AS r (
    emp_id, travel_date, component, legacy_value, daily_value,
    chosen_source, approved_amount, reason, resolved_by, resolved_by_name, resolved_at, updated_at
  ) VALUES (
    p_emp_id, p_date, p_component, v_legacy_val, v_daily_val,
    p_chosen_source, v_amount, btrim(p_reason), auth.uid(), coalesce(v_name, ''), now(), now()
  )
  ON CONFLICT (emp_id, travel_date, component) DO UPDATE
  SET legacy_value = EXCLUDED.legacy_value,
      daily_value = EXCLUDED.daily_value,
      chosen_source = EXCLUDED.chosen_source,
      approved_amount = EXCLUDED.approved_amount,
      reason = EXCLUDED.reason,
      resolved_by = EXCLUDED.resolved_by,
      resolved_by_name = EXCLUDED.resolved_by_name,
      resolved_at = now(),
      updated_at = now()
  RETURNING * INTO v_row;

  -- Refresh payable only when the day is approved and every component is resolved.
  IF v_daily.review_status IN ('approved', 'corrected')
     AND NOT public.av2_travel_day_has_unresolved_overlap(p_emp_id, p_date) THEN
    PERFORM public.av2_sync_daily_travel_payable(p_emp_id, p_date);
  END IF;

  RETURN to_jsonb(v_row);
END;
$function$;

REVOKE ALL ON FUNCTION public.av2_resolve_travel_payroll_component(bigint, date, text, text, numeric, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.av2_resolve_travel_payroll_component(bigint, date, text, text, numeric, text)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) Payable sync: apply resolutions; still never rewrite legacy activity km
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.av2_sync_daily_travel_payable(p_emp_id bigint, p_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  d public.attendance_daily_travel_reports%ROWTYPE;
  v_source uuid;
  v_row uuid;
  v_km numeric := 0;
  v_pt numeric := 0;
  v_cancel numeric := 0;
  v_res record;
BEGIN
  IF p_date < date '2026-11-01' THEN
    RAISE EXCEPTION 'attendance_daily_travel_not_active' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('av2-daily-payable|' || p_emp_id || '|' || p_date, 0));

  IF public.av2_november_travel_legacy_conflict(p_emp_id, p_date) THEN
    RAISE EXCEPTION 'attendance_existing_legacy_approved_travel_conflict' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO d
  FROM public.attendance_daily_travel_reports
  WHERE emp_id = p_emp_id AND travel_date = p_date
  FOR UPDATE;
  IF NOT FOUND OR d.review_status NOT IN ('approved', 'corrected', 'rejected') THEN
    RAISE EXCEPTION 'attendance_daily_travel_not_reviewed' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_source
  FROM public.attendance_records
  WHERE emp_id = p_emp_id AND report_date = p_date AND generation_kind IS NULL
    AND activity_type NOT IN ('זום', 'ביטול זמן')
    AND coalesce(training_mode::text, 'physical') <> 'online'
    AND coalesce(operation_meeting_mode, 'physical') <> 'online'
  ORDER BY start_time, id
  LIMIT 1
  FOR UPDATE;
  IF v_source IS NULL THEN
    RAISE EXCEPTION 'attendance_daily_travel_source_missing' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.attendance_records existing
    WHERE existing.emp_id = p_emp_id AND existing.report_date = p_date
      AND existing.generation_kind = 'travel_time_cancellation'
      AND (coalesce(existing.total_hours, 0) > 0 OR coalesce(existing.roundtrip_km, 0) > 0)
  ) THEN
    RAISE EXCEPTION 'attendance_existing_travel_payable_conflict' USING ERRCODE = '22023';
  END IF;

  v_km := coalesce(d.approved_km, 0);
  v_pt := coalesce(d.approved_public_transport_cost, 0);
  v_cancel := coalesce(d.approved_cancellation_minutes, 0);

  FOR v_res IN
    SELECT component, approved_amount
    FROM public.attendance_travel_payroll_resolutions
    WHERE emp_id = p_emp_id AND travel_date = p_date
  LOOP
    IF v_res.component = 'kilometers' THEN v_km := coalesce(v_res.approved_amount, 0); END IF;
    IF v_res.component = 'public_transport' THEN v_pt := coalesce(v_res.approved_amount, 0); END IF;
    IF v_res.component = 'cancellation' THEN v_cancel := coalesce(v_res.approved_amount, 0); END IF;
  END LOOP;

  PERFORM set_config('app.av2_compensation_write', '1', true);

  IF d.review_status IN ('approved', 'corrected')
     AND (coalesce(v_cancel, 0) > 0 OR coalesce(v_km, 0) > 0 OR coalesce(v_pt, 0) > 0) THEN
    INSERT INTO public.attendance_records (
      emp_id, report_date, start_time, end_time, total_hours, activity_type,
      activity_name_snapshot, roundtrip_km, public_transport, public_transport_cost,
      expenses, source_attendance_record_id, generation_kind, updated_at
    ) VALUES (
      p_emp_id, p_date, NULL, NULL, v_cancel / 60.0, 'ביטול זמן',
      'נסיעות וביטולים מאושרים', v_km, coalesce(v_pt, 0) > 0, coalesce(v_pt, 0), 0,
      v_source, 'daily_travel_cancellation', now()
    )
    ON CONFLICT (source_attendance_record_id)
      WHERE generation_kind = 'daily_travel_cancellation'
    DO UPDATE SET
      report_date = EXCLUDED.report_date,
      total_hours = EXCLUDED.total_hours,
      roundtrip_km = EXCLUDED.roundtrip_km,
      public_transport = EXCLUDED.public_transport,
      public_transport_cost = EXCLUDED.public_transport_cost,
      updated_at = now()
    RETURNING id INTO v_row;
  ELSE
    DELETE FROM public.attendance_records
    WHERE emp_id = p_emp_id AND report_date = p_date
      AND generation_kind = 'daily_travel_cancellation';
  END IF;

  RETURN jsonb_build_object(
    'record_id', v_row,
    'review_status', d.review_status,
    'approved_km', v_km,
    'approved_public_transport_cost', v_pt,
    'approved_cancellation_minutes', v_cancel
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.av2_sync_daily_travel_payable(bigint, date) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6) Review gate: unresolved overlaps cannot be approved
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.av2_review_daily_travel(
  p_emp_id bigint,
  p_date date,
  p_decision text,
  p_km numeric DEFAULT NULL,
  p_minutes integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
  v_name text;
  v_manager text;
  v_row public.attendance_daily_travel_reports%ROWTYPE;
  v_next_km numeric;
  v_next_pt numeric;
  v_next_cancel numeric;
  v_no_travel boolean;
BEGIN
  SELECT lower(coalesce(role, '')), coalesce(full_name, name, username)
  INTO v_role, v_name
  FROM public.users
  WHERE auth_user_id = auth.uid() AND is_active = true
  LIMIT 1;

  IF v_role IS NULL OR v_role NOT IN ('admin', 'operation_manager', 'manager', 'instructor_manager', 'activities_manager') THEN
    RAISE EXCEPTION 'attendance_travel_review_denied' USING ERRCODE = '42501';
  END IF;
  IF v_role IN ('manager', 'instructor_manager', 'activities_manager') THEN
    SELECT direct_manager INTO v_manager FROM public.contacts_instructors WHERE emp_id = p_emp_id LIMIT 1;
    IF nullif(trim(v_name), '') IS NULL OR nullif(trim(v_manager), '') IS NULL
       OR lower(trim(coalesce(v_name, ''))) <> lower(trim(coalesce(v_manager, ''))) THEN
      RAISE EXCEPTION 'attendance_travel_review_denied' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_decision IS NULL OR p_decision NOT IN ('approve', 'correct', 'reject')
     OR (p_decision = 'correct' AND (p_km IS NULL OR p_minutes IS NULL))
     OR (p_km IS NOT NULL AND (p_km < 0 OR p_km > 10000))
     OR (p_minutes IS NOT NULL AND (p_minutes < 0 OR p_minutes > 1440)) THEN
    RAISE EXCEPTION 'attendance_travel_review_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_emp_id IS NULL OR p_date IS NULL OR p_date < date '2026-11-01' THEN
    RAISE EXCEPTION 'attendance_travel_query_invalid' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('av2-daily|' || p_emp_id || '|' || p_date, 0));

  IF public.av2_attendance_month_is_closed(p_emp_id, p_date) THEN
    RAISE EXCEPTION 'attendance_month_locked' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_row
  FROM public.attendance_daily_travel_reports
  WHERE emp_id = p_emp_id AND travel_date = p_date
  FOR UPDATE;
  IF NOT FOUND OR v_row.review_status <> 'pending_review' THEN
    RAISE EXCEPTION 'attendance_travel_review_not_pending' USING ERRCODE = '42501';
  END IF;

  IF p_decision IN ('approve', 'correct') AND (
       (v_row.context_fingerprint IS NOT NULL AND v_row.context_fingerprint IS DISTINCT FROM
          private.av2_daily_travel_context_fingerprint(p_emp_id, p_date))
    OR (v_row.context_fingerprint IS NULL AND EXISTS (
          SELECT 1 FROM public.attendance_records a
          WHERE a.emp_id = p_emp_id AND a.report_date = p_date
            AND a.generation_kind IS NULL AND a.activity_type NOT IN ('זום', 'ביטול זמן')
            AND coalesce(a.training_mode, 'physical') <> 'online'
            AND coalesce(a.operation_meeting_mode, 'physical') <> 'online'
            AND a.updated_at > v_row.reported_at))
  ) THEN
    RAISE EXCEPTION 'attendance_travel_route_changed' USING ERRCODE = '22023';
  END IF;
  IF NOT v_row.no_travel AND NOT public.av2_daily_travel_route_matches(p_emp_id, p_date, v_row.legs) THEN
    RAISE EXCEPTION 'attendance_travel_route_changed' USING ERRCODE = '22023';
  END IF;

  v_no_travel := v_row.no_travel;
  v_next_km := CASE p_decision WHEN 'approve' THEN v_row.total_km WHEN 'correct' THEN p_km ELSE NULL END;
  v_next_pt := CASE WHEN p_decision IN ('approve', 'correct') THEN v_row.public_transport_cost ELSE NULL END;
  v_next_cancel := CASE p_decision WHEN 'approve' THEN v_row.cancellation_minutes WHEN 'correct' THEN p_minutes ELSE NULL END;

  IF p_decision IN ('approve', 'correct') THEN
    IF EXISTS (
      SELECT 1
      FROM public.av2_travel_day_component_conflicts(
        p_emp_id, p_date, v_next_km, v_next_pt, v_next_cancel, v_no_travel
      ) c
      WHERE c.status IN ('conflict', 'no_travel_vs_legacy', 'legacy_only_with_daily_zero')
    ) THEN
      RAISE EXCEPTION 'attendance_travel_overlap_unresolved' USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE public.attendance_daily_travel_reports
  SET review_status = CASE p_decision
        WHEN 'approve' THEN 'approved'
        WHEN 'correct' THEN 'corrected'
        ELSE 'rejected'
      END,
      approved_public_transport_cost = CASE WHEN p_decision IN ('approve', 'correct') THEN public_transport_cost ELSE NULL END,
      approved_km = CASE p_decision WHEN 'approve' THEN total_km WHEN 'correct' THEN p_km ELSE NULL END,
      approved_cancellation_minutes = CASE p_decision WHEN 'approve' THEN cancellation_minutes WHEN 'correct' THEN p_minutes ELSE NULL END,
      review_by = auth.uid(),
      review_at = now(),
      updated_at = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  PERFORM public.av2_sync_daily_travel_payable(p_emp_id, p_date);

  RETURN jsonb_build_object(
    'review_status', v_row.review_status,
    'approved_km', v_row.approved_km,
    'approved_public_transport_cost', v_row.approved_public_transport_cost,
    'approved_cancellation_minutes', v_row.approved_cancellation_minutes
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.av2_review_daily_travel(bigint, date, text, numeric, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.av2_review_daily_travel(bigint, date, text, numeric, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7) Canonical payroll projection exclusivity (+ generation_kind)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_payroll_attendance_records(bigint[], date, date);

CREATE OR REPLACE FUNCTION public.get_payroll_attendance_records(
  p_employee_ids bigint[] DEFAULT NULL::bigint[],
  p_from_date date DEFAULT NULL::date,
  p_to_date date DEFAULT NULL::date
)
RETURNS TABLE (
  record_id uuid,
  employee_id text,
  employee_name text,
  employment_type text,
  team text,
  attendance_date date,
  start_time time without time zone,
  end_time time without time zone,
  work_hours numeric,
  activity_type text,
  school_name text,
  municipality text,
  program_name text,
  session_number text,
  total_expenses numeric,
  kilometers numeric,
  expenses_details text,
  notes text,
  activity_row_id text,
  activity_numeric_id bigint,
  activity_no text,
  activity_season text,
  authority_id bigint,
  school_id bigint,
  semel_mosad bigint,
  public_transport boolean,
  public_transport_cost numeric,
  attachments jsonb,
  training_mode text,
  generation_kind text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
  v_own_name text;
BEGIN
  SELECT
    lower(trim(coalesce(u.role, ''))),
    coalesce(nullif(trim(coalesce(u.full_name, '')), ''), nullif(trim(coalesce(u.name, '')), ''), nullif(trim(coalesce(u.username, '')), ''))
  INTO v_role, v_own_name
  FROM public.users u
  WHERE u.auth_user_id = auth.uid()
    AND u.is_active = true
  LIMIT 1;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'payroll_attendance_auth_required' USING ERRCODE = '42501';
  END IF;

  IF v_role NOT IN ('admin', 'operation_manager', 'activities_manager', 'finance', 'manager', 'instructor_manager') THEN
    RAISE EXCEPTION 'payroll_attendance_permission_denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH daily_canonical AS (
    SELECT d.emp_id, d.travel_date
    FROM public.attendance_daily_travel_reports d
    WHERE d.review_status IN ('approved', 'corrected')
      AND d.travel_date >= date '2026-11-01'
      AND (p_from_date IS NULL OR d.travel_date >= p_from_date)
      AND (p_to_date IS NULL OR d.travel_date <= p_to_date)
      AND (p_employee_ids IS NULL OR d.emp_id = ANY (p_employee_ids))
    UNION
    SELECT g.emp_id, g.report_date
    FROM public.attendance_records g
    WHERE g.generation_kind = 'daily_travel_cancellation'
      AND g.report_date >= date '2026-11-01'
      AND (p_from_date IS NULL OR g.report_date >= p_from_date)
      AND (p_to_date IS NULL OR g.report_date <= p_to_date)
      AND (p_employee_ids IS NULL OR g.emp_id = ANY (p_employee_ids))
  )
  SELECT
    ar.id,
    ar.emp_id::text,
    coalesce(ci.full_name, ar.emp_id::text),
    coalesce(ci.employment_type, ''),
    coalesce(ci.direct_manager, ''),
    ar.report_date,
    ar.start_time,
    ar.end_time,
    ar.total_hours,
    ar.activity_type,
    coalesce(ar.school_name_snapshot, ''),
    coalesce(ar.authority_name_snapshot, ''),
    coalesce(nullif(ar.program_name_snapshot, ''), nullif(ar.program_name, ''), nullif(ar.activity_name_snapshot, ''), ''),
    coalesce(ar.meeting_no::text, (
      SELECT string_agg(number_text, ', ' ORDER BY number_text::numeric)
      FROM (
        SELECT DISTINCT item->>'meeting_no' AS number_text
        FROM jsonb_array_elements(coalesce(ar.course_dashboard_sources, '[]'::jsonb)) item
        WHERE jsonb_typeof(item->'meeting_no') = 'number'
      ) linked_meetings
    ), ''),
    coalesce(ar.expenses, 0),
    CASE
      WHEN ar.generation_kind IS NULL
        AND ar.report_date >= date '2026-11-01'
        AND EXISTS (
          SELECT 1 FROM daily_canonical dc
          WHERE dc.emp_id = ar.emp_id AND dc.travel_date = ar.report_date
        )
      THEN 0::numeric
      ELSE coalesce(ar.roundtrip_km, 0)
    END,
    coalesce(ar.expense_details, ''),
    coalesce(ar.notes, ''),
    coalesce(ar.activity_row_id, ''),
    ar.activity_id,
    coalesce(ar.activity_no, ''),
    coalesce(ar.activity_season, ''),
    ar.authority_id,
    ar.school_id,
    ar.semel_mosad,
    CASE
      WHEN ar.generation_kind IS NULL
        AND ar.report_date >= date '2026-11-01'
        AND EXISTS (
          SELECT 1 FROM daily_canonical dc
          WHERE dc.emp_id = ar.emp_id AND dc.travel_date = ar.report_date
        )
      THEN false
      ELSE coalesce(ar.public_transport, false)
    END,
    CASE
      WHEN ar.generation_kind IS NULL
        AND ar.report_date >= date '2026-11-01'
        AND EXISTS (
          SELECT 1 FROM daily_canonical dc
          WHERE dc.emp_id = ar.emp_id AND dc.travel_date = ar.report_date
        )
      THEN 0::numeric
      ELSE coalesce(ar.public_transport_cost, 0)
    END,
    coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', att.id,
          'fileName', att.file_name,
          'storagePath', att.storage_path,
          'fileType', att.file_type,
          'fileSize', att.file_size
        )
        ORDER BY att.file_name, att.id
      )
      FROM public.attendance_record_attachments att
      WHERE att.record_id = ar.id
    ), '[]'::jsonb),
    ar.training_mode::text,
    ar.generation_kind::text
  FROM public.attendance_records ar
  LEFT JOIN public.contacts_instructors ci ON ci.emp_id = ar.emp_id
  WHERE (p_employee_ids IS NULL OR ar.emp_id = ANY (p_employee_ids))
    AND (p_from_date IS NULL OR ar.report_date >= p_from_date)
    AND (p_to_date IS NULL OR ar.report_date <= p_to_date)
    AND (
      v_role IN ('admin', 'operation_manager', 'finance')
      OR (
        v_role IN ('activities_manager', 'manager', 'instructor_manager')
        AND lower(trim(coalesce(ci.direct_manager, ''))) = lower(trim(coalesce(v_own_name, '')))
      )
    )
  ORDER BY ar.report_date, ar.start_time, ar.emp_id;

  RETURN QUERY
  SELECT
    e.id, e.emp_id::text, coalesce(ci.full_name, e.emp_id::text),
    coalesce(ci.employment_type, ''), coalesce(ci.direct_manager, ''),
    e.expense_date, NULL::time, NULL::time, 0::numeric,
    'הוצאות'::text, ''::text, ''::text, 'הוצאות מדריך'::text, ''::text,
    coalesce(e.approved_amount, 0)::numeric, 0::numeric, e.details,
    ''::text, ''::text, NULL::bigint, ''::text, ''::text,
    NULL::bigint, NULL::bigint, NULL::bigint,
    false, 0::numeric,
    coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', att.id, 'fileName', att.file_name,
        'storagePath', att.storage_path, 'fileType', att.file_type,
        'fileSize', att.file_size
      ) ORDER BY att.file_name, att.id)
      FROM public.attendance_expense_attachments att
      WHERE att.expense_id = e.id
    ), '[]'::jsonb),
    NULL::text,
    'standalone_expense'::text
  FROM public.attendance_expense_reports e
  LEFT JOIN public.contacts_instructors ci ON ci.emp_id = e.emp_id
  WHERE e.review_status = 'approved'
    AND e.expense_date >= date '2026-11-01'
    AND (p_employee_ids IS NULL OR e.emp_id = ANY (p_employee_ids))
    AND (p_from_date IS NULL OR e.expense_date >= p_from_date)
    AND (p_to_date IS NULL OR e.expense_date <= p_to_date)
    AND (
      v_role IN ('admin', 'operation_manager', 'finance')
      OR (
        v_role IN ('activities_manager', 'manager', 'instructor_manager')
        AND lower(trim(coalesce(ci.direct_manager, ''))) = lower(trim(coalesce(v_own_name, '')))
      )
    )
  ORDER BY e.expense_date, e.emp_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_payroll_attendance_records(bigint[], date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_payroll_attendance_records(bigint[], date, date) TO authenticated;

COMMENT ON FUNCTION public.get_payroll_attendance_records(bigint[], date, date) IS
  'Payroll attendance bridge. From 2026-11-01, activity-row km/PT are suppressed in projection when an approved daily travel path exists for that day; historical roundtrip_km rows remain unchanged.';

-- ---------------------------------------------------------------------------
-- 8) Payroll dispatch guard: unresolved overlaps block send-to-payroll
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.av2_assert_payroll_travel_review_ready(
  p_emp_id bigint,
  p_month_key text,
  p_manager_approved_at timestamp with time zone
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
  v_hold boolean;
  v_from date;
  v_to date;
BEGIN
  SELECT lower(btrim(coalesce(u.role, ''))) INTO v_role
  FROM public.users u
  WHERE u.auth_user_id = auth.uid() AND u.is_active = true
  LIMIT 1;
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'payroll_attendance_permission_denied' USING ERRCODE = '42501';
  END IF;
  IF p_manager_approved_at IS NULL THEN
    RAISE EXCEPTION 'attendance_month_manager_signature_missing' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(payroll_hold, false) INTO v_hold
  FROM public.attendance_month_approvals
  WHERE emp_id = p_emp_id AND month_key = p_month_key;
  IF coalesce(v_hold, false) THEN
    RAISE EXCEPTION 'attendance_payroll_hold_active' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.attendance_records a
    WHERE a.emp_id = p_emp_id
      AND to_char(a.report_date, 'YYYY-MM') = p_month_key
      AND a.generation_kind IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.attendance_manager_record_reviews r
        WHERE r.record_id = a.id
          AND r.status = 'approved'
          AND r.approved_record_updated_at = a.updated_at
          AND r.approved_at <= p_manager_approved_at
      )
  ) THEN
    RAISE EXCEPTION 'attendance_records_not_fully_approved' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.attendance_travel_compensations c
    JOIN public.attendance_records a ON a.id = c.source_attendance_record_id
    WHERE a.emp_id = p_emp_id
      AND to_char(a.report_date, 'YYYY-MM') = p_month_key
      AND a.report_date < date '2026-11-01'
      AND (
        c.review_status IN ('awaiting_report', 'auto_matched', 'pending_review')
        OR (
          c.review_status IN ('approved', 'corrected', 'rejected')
          AND (c.review_at IS NULL OR c.review_at > p_manager_approved_at)
        )
      )
  ) THEN
    RAISE EXCEPTION 'attendance_travel_reviews_pending' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.attendance_records g
    WHERE g.emp_id = p_emp_id
      AND to_char(g.report_date, 'YYYY-MM') = p_month_key
      AND g.generation_kind IN ('travel_time_cancellation', 'daily_travel_cancellation')
      AND (g.created_at > p_manager_approved_at OR g.updated_at > p_manager_approved_at)
  ) THEN
    RAISE EXCEPTION 'attendance_payable_changed_after_manager_approval' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.attendance_records a
    LEFT JOIN public.attendance_daily_travel_reports d
      ON d.emp_id = a.emp_id AND d.travel_date = a.report_date
    WHERE a.emp_id = p_emp_id
      AND to_char(a.report_date, 'YYYY-MM') = p_month_key
      AND a.report_date >= date '2026-11-01'
      AND a.generation_kind IS NULL
      AND a.activity_type NOT IN ('זום', 'ביטול זמן')
      AND coalesce(a.training_mode, 'physical') <> 'online'
      AND coalesce(a.operation_meeting_mode, 'physical') <> 'online'
      AND (
        d.id IS NULL
        OR d.review_status NOT IN ('approved', 'corrected')
        OR d.review_at IS NULL
        OR d.review_at > p_manager_approved_at
        OR d.reported_at IS NULL
        OR d.reported_at > d.review_at
        OR (
          NOT d.no_travel
          AND NOT public.av2_daily_travel_route_matches(d.emp_id, d.travel_date, d.legs)
        )
      )
  ) THEN
    RAISE EXCEPTION 'attendance_daily_travel_reviews_pending' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.attendance_expense_reports e
    WHERE e.emp_id = p_emp_id
      AND to_char(e.expense_date, 'YYYY-MM') = p_month_key
      AND e.review_status = 'pending_review'
  ) THEN
    RAISE EXCEPTION 'attendance_expense_reviews_pending' USING ERRCODE = '22023';
  END IF;

  IF public.av2_month_has_double_cancellation(p_emp_id, p_month_key) THEN
    RAISE EXCEPTION 'attendance_double_cancellation_same_day' USING ERRCODE = '22023';
  END IF;

  v_from := (p_month_key || '-01')::date;
  v_to := (v_from + INTERVAL '1 month' - INTERVAL '1 day')::date;
  IF EXISTS (
    SELECT 1
    FROM public.attendance_daily_travel_reports d
    WHERE d.emp_id = p_emp_id
      AND d.travel_date BETWEEN v_from AND v_to
      AND public.av2_travel_day_has_unresolved_overlap(d.emp_id, d.travel_date)
  ) THEN
    RAISE EXCEPTION 'attendance_travel_overlap_unresolved' USING ERRCODE = '22023';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.av2_assert_payroll_travel_review_ready(bigint, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.av2_assert_payroll_travel_review_ready(bigint, text, timestamptz)
  TO authenticated;

COMMIT;
