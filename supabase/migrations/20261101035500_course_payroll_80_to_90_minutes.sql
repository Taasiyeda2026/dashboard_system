CREATE OR REPLACE FUNCTION attendance_private.course_work(sources jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
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
      CASE WHEN e-s=45 THEN 60 WHEN e-s BETWEEN 80 AND 90 THEN 120 ELSE e-s END paid_minutes
    FROM sessions
  )
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM windows WHERE s IS NULL OR e IS NULL OR e<=s)
    AND count(*)>0 THEN jsonb_build_object(
      'start_time',to_char(time '00:00'+make_interval(mins=>min(s)),'HH24:MI'),
      'end_time',to_char(time '00:00'+make_interval(mins=>max(e)),'HH24:MI'),
      'paid_minutes',sum(paid_minutes),'total_hours',round(sum(paid_minutes)::numeric/60,2)
    ) ELSE NULL END FROM paid;
$function$;