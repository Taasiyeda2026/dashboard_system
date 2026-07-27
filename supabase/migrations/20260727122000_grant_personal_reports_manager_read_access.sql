-- Grant read-only access to all employee personal reports for users explicitly
-- marked with permissions.personal_reports_manager = yes/true/1.
--
-- This intentionally does not grant INSERT, UPDATE or DELETE privileges.

DROP POLICY IF EXISTS profiles_select_personal_reports_manager ON public.profiles;
CREATE POLICY profiles_select_personal_reports_manager
ON public.profiles
FOR SELECT
TO authenticated
USING ((SELECT private.dashboard_user_can_manage_personal_reports()));

DROP POLICY IF EXISTS reports_select_personal_reports_manager ON public.personal_reports;
CREATE POLICY reports_select_personal_reports_manager
ON public.personal_reports
FOR SELECT
TO authenticated
USING ((SELECT private.dashboard_user_can_manage_personal_reports()));

DROP POLICY IF EXISTS dte_select_personal_reports_manager ON public.declared_travel_entries;
CREATE POLICY dte_select_personal_reports_manager
ON public.declared_travel_entries
FOR SELECT
TO authenticated
USING ((SELECT private.dashboard_user_can_manage_personal_reports()));

DROP POLICY IF EXISTS pte_select_personal_reports_manager ON public.public_transport_entries;
CREATE POLICY pte_select_personal_reports_manager
ON public.public_transport_entries
FOR SELECT
TO authenticated
USING ((SELECT private.dashboard_user_can_manage_personal_reports()));

DROP POLICY IF EXISTS ee_select_personal_reports_manager ON public.expense_entries;
CREATE POLICY ee_select_personal_reports_manager
ON public.expense_entries
FOR SELECT
TO authenticated
USING ((SELECT private.dashboard_user_can_manage_personal_reports()));

DROP POLICY IF EXISTS ae_select_personal_reports_manager ON public.absence_entries;
CREATE POLICY ae_select_personal_reports_manager
ON public.absence_entries
FOR SELECT
TO authenticated
USING ((SELECT private.dashboard_user_can_manage_personal_reports()));

DROP POLICY IF EXISTS ra_select_personal_reports_manager ON public.report_attachments;
CREATE POLICY ra_select_personal_reports_manager
ON public.report_attachments
FOR SELECT
TO authenticated
USING ((SELECT private.dashboard_user_can_manage_personal_reports()));

DROP POLICY IF EXISTS payroll_select_personal_reports_manager ON public.payroll_report_summaries;
CREATE POLICY payroll_select_personal_reports_manager
ON public.payroll_report_summaries
FOR SELECT
TO authenticated
USING ((SELECT private.dashboard_user_can_manage_personal_reports()));

DROP POLICY IF EXISTS storage_select_personal_reports_manager ON storage.objects;
CREATE POLICY storage_select_personal_reports_manager
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'personal-report-attachments'
  AND (SELECT private.dashboard_user_can_manage_personal_reports())
);
