-- Fix Edge Function 500 (SQLSTATE 42501): the service role was not granted
-- data access when the export receipt table was created.
-- Keep the browser's authenticated role read-only via its existing RLS policy.
grant select, insert, update on table public.instructor_observation_sharepoint_exports to service_role;

-- Only the backend service can create or update confirmed PDF receipts.
revoke insert, update, delete on table public.instructor_observation_sharepoint_exports from anon, authenticated;
