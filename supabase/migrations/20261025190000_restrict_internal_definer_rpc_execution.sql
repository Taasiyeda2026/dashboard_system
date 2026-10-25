-- Restrict internal privileged routines that were inadvertently callable over
-- the exposed PostgREST RPC endpoint via the default PUBLIC EXECUTE grant.
-- Applied to production Dashboard through Supabase migration:
-- restrict_internal_definer_rpc_execution_20261025
--
-- apply_contact_import_batch modifies contact/school import data and is an
-- internal server operation, not a public or signed-in client RPC.
-- av2_append_travel_compensation_event is called internally from SECURITY
-- DEFINER attendance routines, which still execute with their own owner role.
-- No policies or privileges on the underlying tables are broadened.
REVOKE ALL ON FUNCTION public.apply_contact_import_batch(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_contact_import_batch(uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.av2_append_travel_compensation_event(
  uuid, bigint, text, jsonb, jsonb, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.av2_append_travel_compensation_event(
  uuid, bigint, text, jsonb, jsonb, text
) TO service_role;
