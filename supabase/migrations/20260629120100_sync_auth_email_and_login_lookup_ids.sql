-- Keep public.users.auth_email aligned with Supabase Auth for active users
-- that are already linked by auth_user_id, and broaden login lookup so users
-- can sign in with username, user_id, or emp_id (in that priority order).
-- Intentionally updates only auth_email.

UPDATE public.users AS u
SET auth_email = au.email
FROM auth.users AS au
WHERE u.is_active = true
  AND u.auth_user_id IS NOT NULL
  AND u.auth_user_id = au.id
  AND au.email IS NOT NULL
  AND btrim(au.email::text) <> ''
  AND u.auth_email IS DISTINCT FROM au.email;

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
  WITH normalized_input AS (
    SELECT lower(btrim(p_username)) AS login_key
  )
  SELECT
    u.user_id::text,
    u.username::text,
    u.role::text,
    u.auth_email::text,
    u.auth_user_id::uuid
  FROM public.users AS u
  CROSS JOIN normalized_input AS input
  WHERE u.is_active = true
    AND u.migrated_to_auth = true
    AND input.login_key <> ''
    AND (
      lower(btrim(u.username::text)) = input.login_key
      OR lower(btrim(u.user_id::text)) = input.login_key
      OR lower(btrim(u.emp_id::text)) = input.login_key
    )
  ORDER BY
    CASE
      WHEN lower(btrim(u.username::text)) = input.login_key THEN 1
      WHEN lower(btrim(u.user_id::text)) = input.login_key THEN 2
      WHEN lower(btrim(u.emp_id::text)) = input.login_key THEN 3
      ELSE 4
    END,
    u.user_id::text
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.lookup_login_user_by_username(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_login_user_by_username(text) TO anon, authenticated;

-- Post-deploy verification queries for the reported users:
-- SELECT * FROM public.lookup_login_user_by_username('6000');
-- SELECT * FROM public.lookup_login_user_by_username('edenc');
-- SELECT u.user_id, u.username, u.auth_email, au.email AS auth_users_email
-- FROM public.users u
-- JOIN auth.users au ON au.id = u.auth_user_id
-- WHERE u.user_id IN ('6000', '1500');
