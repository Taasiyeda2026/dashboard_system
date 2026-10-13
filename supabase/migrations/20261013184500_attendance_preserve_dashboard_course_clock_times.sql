-- Keep scheduled attendance clocks from the dashboard while preserving the distinct
-- 45=>60 and 90=>120 minute payroll rule. No existing record is rewritten.
-- The historical helper is ONLY for validating already-saved padded reports.
CREATE OR REPLACE FUNCTION attendance_private.course_work_legacy(sources jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $old$
  WITH windows AS (
    SELECT DISTINCT extract(epoch from (item->>'start_time')::time)::int/60 s,
      extract(epoch from (item->>'end_time')::time)::int/60 e
    FROM jsonb_array_elements(sources) item
  ), ordered AS (
    SELECT *, max(e) OVER (ORDER BY s,e ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) prior_end FROM windows
  ), clustered AS (
    SELECT *, sum(CASE WHEN prior_end IS NULL OR s >= prior_end THEN 1 ELSE 0 END) OVER (ORDER BY s,e) cluster FROM ordered
  ), sessions AS (SELECT min(s) s,max(e) e FROM clustered GROUP BY cluster),
  paid AS (
    SELECT greatest(0,s-ceil(floor((e-s)::numeric/45)/2)::int*15) s,
      least(1439,e+floor(floor((e-s)::numeric/45)/2)::int*15) e FROM sessions
  )
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM windows WHERE s IS NULL OR e IS NULL OR e<=s)
    AND count(*)>0 THEN jsonb_build_object(
      'start_time',to_char(time '00:00'+make_interval(mins=>min(s)),'HH24:MI'),
      'end_time',to_char(time '00:00'+make_interval(mins=>max(e)),'HH24:MI'),
      'paid_minutes',sum(e-s),'total_hours',round(sum(e-s)::numeric/60,2)
    ) ELSE NULL END FROM paid;
$old$;

REVOKE ALL ON FUNCTION attendance_private.course_work_legacy(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION attendance_private.course_work(sources jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $new$
  WITH windows AS (
    SELECT DISTINCT extract(epoch from (item->>'start_time')::time)::int/60 s,
      extract(epoch from (item->>'end_time')::time)::int/60 e
    FROM jsonb_array_elements(sources) item
  ), ordered AS (
    SELECT *, max(e) OVER (ORDER BY s,e ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) prior_end FROM windows
  ), clustered AS (
    SELECT *, sum(CASE WHEN prior_end IS NULL OR s >= prior_end THEN 1 ELSE 0 END) OVER (ORDER BY s,e) cluster FROM ordered
  ), sessions AS (SELECT min(s) s,max(e) e FROM clustered GROUP BY cluster),
  paid AS (
    SELECT s,e,
      CASE WHEN e-s=45 THEN 60 WHEN e-s=90 THEN 120 ELSE e-s END paid_minutes
    FROM sessions
  )
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM windows WHERE s IS NULL OR e IS NULL OR e<=s)
    AND count(*)>0 THEN jsonb_build_object(
      'start_time',to_char(time '00:00'+make_interval(mins=>min(s)),'HH24:MI'),
      'end_time',to_char(time '00:00'+make_interval(mins=>max(e)),'HH24:MI'),
      'paid_minutes',sum(paid_minutes),'total_hours',round(sum(paid_minutes)::numeric/60,2)
    ) ELSE NULL END FROM paid;
$new$;

REVOKE ALL ON FUNCTION attendance_private.course_work(jsonb) FROM PUBLIC, anon, authenticated;

-- Adapt the existing month validation; keep every authorization/assignment check.
-- Reports saved before this rollout are compared with their original calculation
-- only when they EXACTLY match the old padded algorithm; no general bypass.
DO $patch$
DECLARE
  v_def text := pg_get_functiondef('public.av2_validate_attendance_month_dashboard(bigint,text)'::regprocedure);
  v_old text;
  v_new text;
BEGIN
  v_old := 'v_work jsonb;';
  v_new := 'v_work jsonb;' || E'\n' || '  v_legacy_work jsonb;';
  IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old) <> 1 THEN
    RAISE EXCEPTION 'attendance validator declaration changed; refusing patch';
  END IF;
  v_def := replace(v_def,v_old,v_new);

  v_old := 'v_work := attendance_private.course_work(v_sources);';
  v_new := $replacement$
v_work := attendance_private.course_work(v_sources);
      IF r.created_at < timestamptz '2026-10-14 00:00:00+00' THEN
        v_legacy_work := attendance_private.course_work_legacy(v_sources);
        IF v_legacy_work IS NOT NULL
          AND r.start_time IS NOT DISTINCT FROM (v_legacy_work->>'start_time')::time
          AND r.end_time IS NOT DISTINCT FROM (v_legacy_work->>'end_time')::time
          AND r.total_hours IS NOT DISTINCT FROM (v_legacy_work->>'total_hours')::numeric THEN
          v_work := v_legacy_work;
        END IF;
      END IF;$replacement$;
  IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old) <> 1 THEN
    RAISE EXCEPTION 'attendance validator work calculation changed; refusing patch';
  END IF;
  v_def := replace(v_def,v_old,v_new);

  v_old := $previous$v_expected_start := v_dashboard_start - make_interval(mins => v_before_minutes);
          v_expected_end := v_dashboard_end + make_interval(mins => v_after_minutes);$previous$;
  v_new := $replacement$
v_expected_start := v_dashboard_start;
          v_expected_end := v_dashboard_end;
          -- Honor previously saved legacy clock ranges but never generate them anew.
          IF r.created_at < timestamptz '2026-10-14 00:00:00+00'
            AND r.start_time IS NOT DISTINCT FROM
              (v_dashboard_start - make_interval(mins => v_before_minutes))
            AND r.end_time IS NOT DISTINCT FROM
              (v_dashboard_end + make_interval(mins => v_after_minutes)) THEN
            v_expected_start := v_dashboard_start - make_interval(mins => v_before_minutes);
            v_expected_end := v_dashboard_end + make_interval(mins => v_after_minutes);
          END IF;$replacement$;
  IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old) <> 1 THEN
    RAISE EXCEPTION 'attendance validator legacy-clock calculation changed; refusing patch';
  END IF;
  v_def := replace(v_def,v_old,v_new);
  EXECUTE v_def;
END $patch$;
