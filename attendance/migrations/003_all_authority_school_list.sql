-- ============================================================
-- Migration 003: All-authority-school list RPC (no instructor filter)
-- Purpose: Return ALL authorities + schools for manual form entry
--          without requiring instructor to have linked activities.
-- Applied: after migration 002
-- ============================================================

-- av2_get_all_authority_school_list
-- Returns all active authorities and their schools from the central DB.
-- Used when an instructor fills in a report without a planned activity.

CREATE OR REPLACE FUNCTION public.av2_get_all_authority_school_list()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'authority_id',   a.id,
      'authority_name', a.name,
      'schools',        COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id',          s.id,
            'name',        s.name,
            'semel_mosad', s.semel_mosad
          ) ORDER BY s.name
        )
        FROM public.schools s
        WHERE s.authority_id = a.id
      ), '[]'::jsonb)
    ) ORDER BY a.name
  ), '[]'::jsonb)
  FROM public.authorities a
  WHERE a.active IS DISTINCT FROM false
$$;

GRANT EXECUTE ON FUNCTION public.av2_get_all_authority_school_list() TO authenticated, anon;
