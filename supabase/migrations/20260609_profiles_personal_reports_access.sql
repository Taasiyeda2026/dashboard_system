-- Personal reports access: source of truth is public.profiles, not users.permissions.
-- Grant is explicit-only; new/active employees do not receive access by default.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS can_access_personal_reports boolean NOT NULL DEFAULT false;

ALTER TABLE public.profiles
  ALTER COLUMN can_access_personal_reports SET DEFAULT false;

UPDATE public.profiles
SET can_access_personal_reports = false;

UPDATE public.profiles
SET can_access_personal_reports = true
WHERE lower(trim(coalesce(email, ''))) IN (
  'esraas@think.org.il',
  'gilneeman@think.org.il',
  'hilar@think.org.il',
  'toni@think.org.il',
  'edenc@think.org.il',
  'idann@think.org.il'
);

CREATE OR REPLACE FUNCTION private.dashboard_user_can_access_personal_reports()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.is_active = true
      AND p.can_access_personal_reports = true
  );
$$;

DROP FUNCTION IF EXISTS public.verify_personal_reports_entry_code(text, text);

CREATE OR REPLACE FUNCTION public.verify_personal_reports_entry_code(
  p_email      text,
  p_entry_code text
)
RETURNS TABLE (
  verify_status text,
  email         text,
  name          text,
  role          text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, private
AS $$
  WITH input AS (
    SELECT
      lower(trim(coalesce(p_email, '')))  AS email,
      trim(coalesce(p_entry_code, ''))    AS code
  ),
  guard AS (
    SELECT
      CASE
        WHEN (SELECT i.email FROM input i) = ''                          THEN 'invalid_input'
        WHEN (SELECT i.code  FROM input i) = ''                          THEN 'invalid_input'
        WHEN position('@' IN (SELECT i.email FROM input i)) = 0          THEN 'invalid_input'
        ELSE 'pass'
      END AS result
  ),
  candidate AS (
    SELECT
      u.email      AS c_email,
      u.name       AS c_name,
      u.role       AS c_role,
      p.is_active  AS c_is_active,
      u.entry_code AS c_entry_code,
      p.can_access_personal_reports AS c_pr_access
    FROM public.users u
    INNER JOIN public.profiles p ON p.id = u.auth_user_id
    CROSS JOIN input i
    WHERE lower(trim(u.email)) = i.email
    LIMIT 1
  ),
  diagnostic AS (
    SELECT
      CASE
        WHEN (SELECT g.result FROM guard g) <> 'pass'                    THEN (SELECT g.result FROM guard g)
        WHEN NOT EXISTS (SELECT 1 FROM candidate)                        THEN 'user_not_found'
        WHEN NOT (SELECT c.c_is_active FROM candidate c)                 THEN 'inactive_user'
        WHEN NOT COALESCE((SELECT c.c_pr_access FROM candidate c), false) THEN 'permission_denied'
        WHEN trim(coalesce((SELECT c.c_entry_code FROM candidate c), ''))
             <> (SELECT i.code FROM input i)                             THEN 'entry_code_mismatch'
        ELSE 'ok'
      END AS status
  )
  SELECT
    d.status                                                AS verify_status,
    CASE WHEN d.status = 'ok' THEN c.c_email END            AS email,
    CASE WHEN d.status = 'ok' THEN c.c_name  END            AS name,
    CASE WHEN d.status = 'ok' THEN c.c_role  END            AS role
  FROM diagnostic d
  LEFT JOIN candidate c ON true;
$$;
