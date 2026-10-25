-- These two read-only attendance catalog helpers are only called by the
-- signed-in attendance dashboard. Preserve signed-in and server access.
-- Do not change the public feedback or premium questionnaire workflows.
DO $guard$
BEGIN
  IF (SELECT count(*) FROM pg_proc p
      WHERE p.pronamespace='public'::regnamespace
      AND p.proname IN('av2_get_all_authority_school_list','av2_get_distinct_activity_types')
      AND p.prosecdef)=2 THEN
    REVOKE EXECUTE ON FUNCTION public.av2_get_all_authority_school_list()
      FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.av2_get_all_authority_school_list()
      TO authenticated, service_role;
    REVOKE EXECUTE ON FUNCTION public.av2_get_distinct_activity_types()
      FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.av2_get_distinct_activity_types()
      TO authenticated, service_role;
  ELSE
    RAISE EXCEPTION 'Unexpected attendance helper definitions';
  END IF;
END $guard$;