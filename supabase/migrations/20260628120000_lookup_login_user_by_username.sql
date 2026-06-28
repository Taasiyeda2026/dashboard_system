-- Secure anonymous login lookup: expose only the minimum fields required to
-- translate an active migrated username to its Supabase Auth email.

DROP FUNCTION IF EXISTS public.lookup_login_user_by_username(text);

CREATE OR REPLACE FUNCTION public.lookup_login_user_by_username(p_username text)
RETURNS TABLE (
  user_id text,
  username text,
  role text,
  auth_email text,
  auth_user_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.user_id::text,
    u.username::text,
    u.role::text,
    u.auth_email::text,
    u.auth_user_id::uuid
  FROM public.users AS u
  WHERE u.is_active = true
    AND u.migrated_to_auth = true
    AND lower(btrim(u.username::text)) = lower(btrim(p_username))
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.lookup_login_user_by_username(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_login_user_by_username(text) TO anon, authenticated;
