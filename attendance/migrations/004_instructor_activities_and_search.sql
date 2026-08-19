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
