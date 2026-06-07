-- Personal reports management: admin OR users.permissions.personal_reports_manager = yes.
-- Scoped to personal reports tables only; does not grant general admin access.

CREATE OR REPLACE FUNCTION private.dashboard_user_can_manage_personal_reports()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT private.dashboard_user_can_access_personal_reports()
    AND (
      EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE id = auth.uid()
          AND role = 'admin'
      )
      OR EXISTS (
        SELECT 1
        FROM public.users u
        WHERE u.auth_user_id = auth.uid()
          AND u.is_active = true
          AND lower(trim(coalesce(u.permissions->>'personal_reports_manager', ''))) IN ('yes', 'true', '1')
      )
    );
$$;

-- personal_reports
DROP POLICY IF EXISTS "reports_select_admin" ON public.personal_reports;
CREATE POLICY "reports_select_admin" ON public.personal_reports
  FOR SELECT USING (private.dashboard_user_can_manage_personal_reports());

DROP POLICY IF EXISTS "reports_update_admin" ON public.personal_reports;
CREATE POLICY "reports_update_admin" ON public.personal_reports
  FOR UPDATE USING (private.dashboard_user_can_manage_personal_reports());

-- declared_travel_entries
DROP POLICY IF EXISTS "dte_select_admin" ON public.declared_travel_entries;
CREATE POLICY "dte_select_admin" ON public.declared_travel_entries
  FOR SELECT USING (private.dashboard_user_can_manage_personal_reports());

DROP POLICY IF EXISTS "dte_admin_all" ON public.declared_travel_entries;
CREATE POLICY "dte_admin_all" ON public.declared_travel_entries
  FOR ALL USING (private.dashboard_user_can_manage_personal_reports());

-- public_transport_entries
DROP POLICY IF EXISTS "pte_select_admin" ON public.public_transport_entries;
CREATE POLICY "pte_select_admin" ON public.public_transport_entries
  FOR SELECT USING (private.dashboard_user_can_manage_personal_reports());

DROP POLICY IF EXISTS "pte_admin_all" ON public.public_transport_entries;
CREATE POLICY "pte_admin_all" ON public.public_transport_entries
  FOR ALL USING (private.dashboard_user_can_manage_personal_reports());

-- expense_entries
DROP POLICY IF EXISTS "ee_select_admin" ON public.expense_entries;
CREATE POLICY "ee_select_admin" ON public.expense_entries
  FOR SELECT USING (private.dashboard_user_can_manage_personal_reports());

DROP POLICY IF EXISTS "ee_admin_all" ON public.expense_entries;
CREATE POLICY "ee_admin_all" ON public.expense_entries
  FOR ALL USING (private.dashboard_user_can_manage_personal_reports());

-- report_attachments
DROP POLICY IF EXISTS "ra_select_admin" ON public.report_attachments;
CREATE POLICY "ra_select_admin" ON public.report_attachments
  FOR SELECT USING (private.dashboard_user_can_manage_personal_reports());

DROP POLICY IF EXISTS "ra_admin_all" ON public.report_attachments;
CREATE POLICY "ra_admin_all" ON public.report_attachments
  FOR ALL USING (private.dashboard_user_can_manage_personal_reports());

-- absence_entries
DROP POLICY IF EXISTS "ae_select_admin" ON public.absence_entries;
CREATE POLICY "ae_select_admin" ON public.absence_entries
  FOR SELECT USING (private.dashboard_user_can_manage_personal_reports());

DROP POLICY IF EXISTS "ae_admin_all" ON public.absence_entries;
CREATE POLICY "ae_admin_all" ON public.absence_entries
  FOR ALL USING (private.dashboard_user_can_manage_personal_reports());

-- profiles listing for personal reports management
DROP POLICY IF EXISTS "profiles_select_admin" ON public.profiles;
CREATE POLICY "profiles_select_admin" ON public.profiles
  FOR SELECT USING (private.dashboard_user_can_manage_personal_reports());

DROP POLICY IF EXISTS "profiles_update_admin" ON public.profiles;
CREATE POLICY "profiles_update_admin" ON public.profiles
  FOR UPDATE USING (private.dashboard_user_can_manage_personal_reports());

-- storage bucket policies
DROP POLICY IF EXISTS "storage_select_admin" ON storage.objects;
CREATE POLICY "storage_select_admin" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'personal-report-attachments'
    AND private.dashboard_user_can_manage_personal_reports()
  );

DROP POLICY IF EXISTS "storage_delete_admin" ON storage.objects;
CREATE POLICY "storage_delete_admin" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'personal-report-attachments'
    AND private.dashboard_user_can_manage_personal_reports()
  );
