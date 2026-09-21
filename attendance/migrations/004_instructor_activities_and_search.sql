-- ============================================================
-- Migration 004: All instructor activities + canonical search
-- Purpose: Load all instructor assignments (not date-filtered) and
--          support extended activity search for the new-report form.
-- Depends: migration 001 RPCs / activities_directory_view in production
-- ============================================================

-- Returns every activity the instructor is assigned to in the given seasons.
-- Same row shape as av2_get_instructor_activities_for_date (without meeting_no/date filter).
CREATE OR REPLACE FUNCTION public.av2_get_instructor_activities(
  p_emp_id           bigint,
  p_activity_seasons text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(v) ORDER BY v.activity_name, v.row_id), '[]'::jsonb)
  FROM (
    SELECT DISTINCT ON (a.row_id)
      a.row_id,
      a.id,
      a.activity_name,
      a.activity_type,
      a.activity_no,
      a.activity_season,
      a.program_name,
      a.authority_id,
      COALESCE(auth.authority_name, a.authority) AS authority_name,
      a.school_id                               AS single_school_id,
      COALESCE(sch.school_name, a.school)       AS single_school_name,
      sch.semel_mosad                           AS single_semel_mosad,
      CASE
        WHEN COALESCE(linked.cnt, 0) > 1 THEN 'multiple_schools'
        WHEN a.school_id IS NOT NULL OR btrim(COALESCE(a.school, '')) <> '' THEN 'single_school'
        ELSE 'authority_or_place_only'
      END AS school_link_status,
      linked.linked_schools_json
    FROM public.activities a
    LEFT JOIN public.authorities auth ON auth.id = a.authority_id
    LEFT JOIN public.schools sch ON sch.id = a.school_id
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::int AS cnt,
        COALESCE(jsonb_agg(
          jsonb_build_object(
            'id',          ls.id,
            'name',        ls.school_name,
            'semel_mosad', ls.semel_mosad
          ) ORDER BY ls.school_name
        ) FILTER (WHERE ls.id IS NOT NULL), '[]'::jsonb) AS linked_schools_json
      FROM public.activity_schools acs
      JOIN public.schools ls ON ls.id = acs.school_id
      WHERE acs.activity_id = a.id
    ) linked ON true
    WHERE (
        a.emp_id = p_emp_id
        OR btrim(COALESCE(a.emp_id_2, '')) = p_emp_id::text
      )
      AND COALESCE(a.status, '') NOT IN ('נמחק', 'בוטל', 'cancelled', 'canceled', 'deleted')
      AND (
        p_activity_seasons IS NULL
        OR cardinality(p_activity_seasons) = 0
        OR a.activity_season = ANY (p_activity_seasons)
      )
    ORDER BY a.row_id, a.activity_name
  ) v;
$$;

-- Canonical activity search for extended picker (optionally filtered by DB activity_type).
CREATE OR REPLACE FUNCTION public.av2_search_canonical_activities(
  p_query            text,
  p_activity_types   text[] DEFAULT NULL,
  p_activity_seasons text[] DEFAULT NULL,
  p_limit            int    DEFAULT 50
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  WITH q AS (
    SELECT btrim(COALESCE(p_query, '')) AS needle
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(v) ORDER BY v.activity_name, v.row_id), '[]'::jsonb)
  FROM (
    SELECT DISTINCT ON (a.row_id)
      a.row_id,
      a.id,
      a.activity_name,
      a.activity_type,
      a.activity_no,
      a.activity_season,
      a.program_name,
      a.authority_id,
      COALESCE(auth.authority_name, a.authority) AS authority_name,
      a.school_id                               AS single_school_id,
      COALESCE(sch.school_name, a.school)       AS single_school_name,
      sch.semel_mosad                           AS single_semel_mosad,
      CASE
        WHEN COALESCE(linked.cnt, 0) > 1 THEN 'multiple_schools'
        WHEN a.school_id IS NOT NULL OR btrim(COALESCE(a.school, '')) <> '' THEN 'single_school'
        ELSE 'authority_or_place_only'
      END AS school_link_status,
      linked.linked_schools_json
    FROM public.activities a
    CROSS JOIN q
    LEFT JOIN public.authorities auth ON auth.id = a.authority_id
    LEFT JOIN public.schools sch ON sch.id = a.school_id
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::int AS cnt,
        COALESCE(jsonb_agg(
          jsonb_build_object(
            'id',          ls.id,
            'name',        ls.school_name,
            'semel_mosad', ls.semel_mosad
          ) ORDER BY ls.school_name
        ) FILTER (WHERE ls.id IS NOT NULL), '[]'::jsonb) AS linked_schools_json
      FROM public.activity_schools acs
      JOIN public.schools ls ON ls.id = acs.school_id
      WHERE acs.activity_id = a.id
    ) linked ON true
    WHERE COALESCE(a.status, '') NOT IN ('נמחק', 'בוטל', 'cancelled', 'canceled', 'deleted')
      AND (
        p_activity_seasons IS NULL
        OR cardinality(p_activity_seasons) = 0
        OR a.activity_season = ANY (p_activity_seasons)
      )
      AND (
        p_activity_types IS NULL
        OR cardinality(p_activity_types) = 0
        OR lower(btrim(COALESCE(a.activity_type, ''))) = ANY (
          SELECT lower(btrim(x)) FROM unnest(p_activity_types) AS x
        )
      )
      AND (
        q.needle = ''
        OR a.row_id ILIKE ('%' || q.needle || '%')
        OR COALESCE(a.activity_name, '') ILIKE ('%' || q.needle || '%')
        OR COALESCE(a.activity_type, '') ILIKE ('%' || q.needle || '%')
        OR COALESCE(a.activity_no, '') ILIKE ('%' || q.needle || '%')
        OR COALESCE(auth.authority_name, a.authority, '') ILIKE ('%' || q.needle || '%')
        OR COALESCE(sch.school_name, a.school, '') ILIKE ('%' || q.needle || '%')
        OR COALESCE(sch.semel_mosad::text, '') ILIKE ('%' || q.needle || '%')
      )
    ORDER BY a.row_id, a.activity_name
    LIMIT GREATEST(COALESCE(p_limit, 50), 1)
  ) v;
$$;

GRANT EXECUTE ON FUNCTION public.av2_get_instructor_activities(bigint, text[]) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.av2_search_canonical_activities(text, text[], text[], int) TO authenticated, anon;


-- Current instructor calendar events for a compact monthly calendar.
-- The public RPC never accepts an employee id. It resolves the instructor from auth.uid().
CREATE OR REPLACE FUNCTION private.av2_get_current_instructor_calendar_events(
  p_from date,
  p_to date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_emp_id bigint;
  v_result jsonb;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR (p_to - p_from) > 62 THEN
    RAISE EXCEPTION 'invalid_calendar_range';
  END IF;

  SELECT u.emp_id::bigint
    INTO v_emp_id
  FROM public.users u
  WHERE u.auth_user_id = auth.uid()
    AND u.role = 'instructor'
    AND u.is_active = true
  LIMIT 1;

  IF v_emp_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', adv.id,
        'row_id', a.row_id,
        'date', d.meeting_date,
        'meeting_no', (
          SELECT COUNT(*)::int + 1
          FROM unnest(ARRAY[
            a.date_1,a.date_2,a.date_3,a.date_4,a.date_5,a.date_6,a.date_7,
            a.date_8,a.date_9,a.date_10,a.date_11,a.date_12,a.date_13,a.date_14,
            a.date_15,a.date_16,a.date_17,a.date_18,a.date_19,a.date_20,a.date_21,
            a.date_22,a.date_23,a.date_24,a.date_25,a.date_26,a.date_27,a.date_28,
            a.date_29,a.date_30,a.date_31,a.date_32,a.date_33,a.date_34,a.date_35
          ]) prior(meeting_date)
          WHERE prior.meeting_date IS NOT NULL
            AND prior.meeting_date < d.meeting_date
            AND NOT EXISTS (
              SELECT 1
              FROM public.course_meeting_cancellations cmc_prev
              WHERE cmc_prev.activity_id = a.row_id
                AND cmc_prev.meeting_date = prior.meeting_date
            )
        ),
        'activity_no', adv.activity_no,
        'activity_name', adv.activity_name,
        'activity_type', adv.activity_type,
        'activity_season', adv.activity_season,
        'program_name', adv.program_name,
        'start_time', CASE WHEN adv.start_time IS NULL THEN '' ELSE to_char(adv.start_time,'HH24:MI') END,
        'end_time', CASE WHEN adv.end_time IS NULL THEN '' ELSE to_char(adv.end_time,'HH24:MI') END,
        'authority_id', adv.authority_id,
        'authority_name', adv.authority_name,
        'school_link_status', adv.school_link_status,
        'single_school_id', adv.single_school_id,
        'single_semel_mosad', adv.single_semel_mosad,
        'single_school_name', adv.single_school_name,
        'linked_schools_json', adv.linked_schools_json
      )
      ORDER BY d.meeting_date, adv.start_time NULLS LAST, adv.activity_name, a.row_id
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM public.activities a
  JOIN public.activities_directory_view adv ON adv.id = a.id
  CROSS JOIN LATERAL unnest(ARRAY[
    a.date_1,a.date_2,a.date_3,a.date_4,a.date_5,a.date_6,a.date_7,
    a.date_8,a.date_9,a.date_10,a.date_11,a.date_12,a.date_13,a.date_14,
    a.date_15,a.date_16,a.date_17,a.date_18,a.date_19,a.date_20,a.date_21,
    a.date_22,a.date_23,a.date_24,a.date_25,a.date_26,a.date_27,a.date_28,
    a.date_29,a.date_30,a.date_31,a.date_32,a.date_33,a.date_34,a.date_35
  ]) d(meeting_date)
  WHERE (a.emp_id = v_emp_id OR btrim(COALESCE(a.emp_id_2,'')) = v_emp_id::text)
    AND d.meeting_date BETWEEN p_from AND p_to
    AND COALESCE(a.status,'') NOT IN ('נמחק','בוטל','מבוטל','cancelled','canceled','deleted')
    AND NOT EXISTS (
      SELECT 1
      FROM public.course_meeting_cancellations cmc
      WHERE cmc.activity_id = a.row_id
        AND cmc.meeting_date = d.meeting_date
    );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION private.av2_get_current_instructor_calendar_events(date,date) FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.av2_get_current_instructor_calendar_events(date,date) TO authenticated;

CREATE OR REPLACE FUNCTION public.av2_get_current_instructor_calendar_events(
  p_from date,
  p_to date
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.av2_get_current_instructor_calendar_events(p_from,p_to);
$$;

REVOKE ALL ON FUNCTION public.av2_get_current_instructor_calendar_events(date,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.av2_get_current_instructor_calendar_events(date,date) FROM anon;
GRANT EXECUTE ON FUNCTION public.av2_get_current_instructor_calendar_events(date,date) TO authenticated;
