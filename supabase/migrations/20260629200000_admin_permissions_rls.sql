-- Admin Permissions RLS Fix
-- Ensures admin (by users.role) can perform all CRUD on users table,
-- and can update can_access_personal_reports on profiles table.
--
-- Safe to run repeatedly (idempotent via DROP IF EXISTS + CREATE).
-- Does NOT depend on app_is_admin() function from write-rls-policies-draft.sql.

-- ─────────────────────────────────────────────
-- 1. public.users — enable RLS + admin CRUD policies
-- ─────────────────────────────────────────────

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Helper: subquery used in all users policies — is the calling auth user an active admin?
-- We avoid using app_is_admin() in case write-rls-policies-draft.sql was not applied.

-- SELECT: allow all authenticated users to read active users
-- (needed for login, permissions screen, bootstrap)
DROP POLICY IF EXISTS "users_select_authenticated_active" ON public.users;
CREATE POLICY "users_select_authenticated_active"
ON public.users
FOR SELECT
TO authenticated
USING (true);

-- INSERT: admin only
DROP POLICY IF EXISTS "users_insert_admin_by_role" ON public.users;
CREATE POLICY "users_insert_admin_by_role"
ON public.users
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_user_id = auth.uid()
      AND u.role = 'admin'
      AND u.is_active = true
    LIMIT 1
  )
);

-- UPDATE: admin only
DROP POLICY IF EXISTS "users_update_admin_by_role" ON public.users;
CREATE POLICY "users_update_admin_by_role"
ON public.users
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_user_id = auth.uid()
      AND u.role = 'admin'
      AND u.is_active = true
    LIMIT 1
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_user_id = auth.uid()
      AND u.role = 'admin'
      AND u.is_active = true
    LIMIT 1
  )
);

-- DELETE: admin only
DROP POLICY IF EXISTS "users_delete_admin_by_role" ON public.users;
CREATE POLICY "users_delete_admin_by_role"
ON public.users
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_user_id = auth.uid()
      AND u.role = 'admin'
      AND u.is_active = true
    LIMIT 1
  )
);

-- Grant table privileges to authenticated role (safe to re-run)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.users TO authenticated;

-- ─────────────────────────────────────────────
-- 2. public.profiles — allow admin (by users.role) to update can_access_personal_reports
-- ─────────────────────────────────────────────

-- The existing profiles_update_admin policy checks profiles.role = 'admin',
-- which requires the admin to have a row in profiles with role='admin'.
-- Admins who never used personal reports may not have such a row.
-- This new policy checks users.role = 'admin' instead, covering all app admins.

DROP POLICY IF EXISTS "profiles_update_app_admin_by_users_role" ON public.profiles;
CREATE POLICY "profiles_update_app_admin_by_users_role"
ON public.profiles
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_user_id = auth.uid()
      AND u.role = 'admin'
      AND u.is_active = true
    LIMIT 1
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_user_id = auth.uid()
      AND u.role = 'admin'
      AND u.is_active = true
    LIMIT 1
  )
);

-- Also ensure SELECT on profiles for admin (needed by savePermission which reads auth_user_id)
DROP POLICY IF EXISTS "profiles_select_app_admin_by_users_role" ON public.profiles;
CREATE POLICY "profiles_select_app_admin_by_users_role"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  auth.uid() = id
  OR EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_user_id = auth.uid()
      AND u.role = 'admin'
      AND u.is_active = true
    LIMIT 1
  )
);

-- Ensure authenticated has UPDATE privilege on profiles
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
