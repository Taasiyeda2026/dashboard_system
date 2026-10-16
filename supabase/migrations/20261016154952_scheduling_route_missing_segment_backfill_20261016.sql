-- Dedicated, opt-in route backfill runs. Does not modify activity assignments.
CREATE TABLE IF NOT EXISTS public.scheduling_route_maintenance_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','completed_with_issues','failed')),
  request_count integer NOT NULL DEFAULT 0,
  cached_count integer NOT NULL DEFAULT 0,
  created_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  blocked_count integer NOT NULL DEFAULT 0,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);
ALTER TABLE public.scheduling_route_maintenance_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.scheduling_route_maintenance_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.scheduling_route_maintenance_runs TO service_role;

-- The worker can only validate a secret stored in Vault; anonymous callers
-- and authenticated application users cannot call this RPC.
CREATE OR REPLACE FUNCTION public.scheduling_route_maintenance_authorized(p_secret text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT length(coalesce(p_secret,'')) >= 60 AND EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE name = 'scheduling_route_maintenance_secret'
      AND decrypted_secret = p_secret
  )
$function$;
REVOKE ALL ON FUNCTION public.scheduling_route_maintenance_authorized(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scheduling_route_maintenance_authorized(text) TO service_role;

-- Operational one-time setup: provision the Vault secret separately.
-- Never commit the secret or its decrypted value to source control.
