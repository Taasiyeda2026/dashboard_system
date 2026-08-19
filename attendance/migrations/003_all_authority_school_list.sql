-- ============================================================
-- Migration 003: All-authority-school list RPC (no instructor filter)
-- Purpose: Return ALL active authorities + schools for manual/extended
--          attendance form search, without requiring instructor assignments.
-- Depends: central public.authorities / public.schools tables.
-- ============================================================

CREATE OR REPLACE FUNCTION public.av2_get_all_authority_school_list()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'authority_id',   a.id,
        'authority_name', a.authority_name,
        'schools',        COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id',          s.id,
              'name',        s.school_name,
              'semel_mosad', s.semel_mosad
            ) ORDER BY s.school_name
          )
          FROM public.schools s
          WHERE s.authority_id = a.id
            AND lower(trim(coalesce(s.active, 'yes'))) NOT IN ('no', 'false', '0', 'לא')
        ), '[]'::jsonb)
      ) ORDER BY a.authority_name
    ),
    '[]'::jsonb
  )
  FROM public.authorities a
  WHERE lower(trim(coalesce(a.active, 'yes'))) NOT IN ('no', 'false', '0', 'לא');
$$;

REVOKE ALL ON FUNCTION public.av2_get_all_authority_school_list() FROM public;
GRANT EXECUTE ON FUNCTION public.av2_get_all_authority_school_list() TO authenticated, anon;

COMMENT ON FUNCTION public.av2_get_all_authority_school_list() IS
  'Returns the canonical active authority/school hierarchy for Attendance V2 extended/manual search.';
