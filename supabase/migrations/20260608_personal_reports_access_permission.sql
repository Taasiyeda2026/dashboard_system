-- Gate personal reports behind users.permissions.can_access_personal_reports.
-- Active users no longer see the tab by role alone; Yael Aviv is explicitly excluded.

CREATE OR REPLACE FUNCTION private.dashboard_user_can_access_personal_reports()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.auth_user_id = auth.uid()
      AND u.is_active = true
      AND lower(trim(coalesce(u.permissions->>'can_access_personal_reports', ''))) IN ('yes', 'true', '1')
  );
$$;

-- Seed permission for existing users: grant all active users except Yael Aviv.
UPDATE public.users
SET permissions = jsonb_set(
  COALESCE(permissions, '{}'::jsonb),
  '{can_access_personal_reports}',
  '"yes"'::jsonb,
  true
)
WHERE is_active = true
  AND lower(trim(coalesce(email, ''))) <> 'yael_aviv@think.org.il';

UPDATE public.users
SET permissions = jsonb_set(
  COALESCE(permissions, '{}'::jsonb),
  '{can_access_personal_reports}',
  '"no"'::jsonb,
  true
)
WHERE lower(trim(coalesce(email, ''))) = 'yael_aviv@think.org.il';

-- personal_reports
DROP POLICY IF EXISTS "reports_select_own" ON public.personal_reports;
CREATE POLICY "reports_select_own" ON public.personal_reports
  FOR SELECT USING (
    auth.uid() = employee_id
    AND private.dashboard_user_can_access_personal_reports()
  );

DROP POLICY IF EXISTS "reports_select_admin" ON public.personal_reports;
CREATE POLICY "reports_select_admin" ON public.personal_reports
  FOR SELECT USING (
    private.dashboard_user_can_access_personal_reports()
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "reports_insert_own" ON public.personal_reports;
CREATE POLICY "reports_insert_own" ON public.personal_reports
  FOR INSERT WITH CHECK (
    auth.uid() = employee_id
    AND private.dashboard_user_can_access_personal_reports()
  );

DROP POLICY IF EXISTS "reports_update_own_draft" ON public.personal_reports;
CREATE POLICY "reports_update_own_draft" ON public.personal_reports
  FOR UPDATE USING (
    auth.uid() = employee_id
    AND status IN ('draft','needs_correction')
    AND private.dashboard_user_can_access_personal_reports()
  );

DROP POLICY IF EXISTS "reports_update_admin" ON public.personal_reports;
CREATE POLICY "reports_update_admin" ON public.personal_reports
  FOR UPDATE USING (
    private.dashboard_user_can_access_personal_reports()
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- declared_travel_entries
DROP POLICY IF EXISTS "dte_select_own" ON public.declared_travel_entries;
CREATE POLICY "dte_select_own" ON public.declared_travel_entries
  FOR SELECT USING (
    auth.uid() = employee_id
    AND private.dashboard_user_can_access_personal_reports()
  );

DROP POLICY IF EXISTS "dte_select_admin" ON public.declared_travel_entries;
CREATE POLICY "dte_select_admin" ON public.declared_travel_entries
  FOR SELECT USING (
    private.dashboard_user_can_access_personal_reports()
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "dte_insert_own" ON public.declared_travel_entries;
CREATE POLICY "dte_insert_own" ON public.declared_travel_entries
  FOR INSERT WITH CHECK (
    auth.uid() = employee_id
    AND private.dashboard_user_can_access_personal_reports()
    AND EXISTS (
      SELECT 1 FROM public.personal_reports
      WHERE id = report_id AND employee_id = auth.uid() AND status IN ('draft','needs_correction')
    )
  );

DROP POLICY IF EXISTS "dte_update_own_draft" ON public.declared_travel_entries;
CREATE POLICY "dte_update_own_draft" ON public.declared_travel_entries
  FOR UPDATE USING (
    auth.uid() = employee_id
    AND private.dashboard_user_can_access_personal_reports()
    AND EXISTS (
      SELECT 1 FROM public.personal_reports
      WHERE id = report_id AND employee_id = auth.uid() AND status IN ('draft','needs_correction')
    )
  );

DROP POLICY IF EXISTS "dte_delete_own_draft" ON public.declared_travel_entries;
CREATE POLICY "dte_delete_own_draft" ON public.declared_travel_entries
  FOR DELETE USING (
    auth.uid() = employee_id
    AND private.dashboard_user_can_access_personal_reports()
    AND EXISTS (
      SELECT 1 FROM public.personal_reports
      WHERE id = report_id AND employee_id = auth.uid() AND status IN ('draft','needs_correction')
    )
  );

DROP POLICY IF EXISTS "dte_admin_all" ON public.declared_travel_entries;
CREATE POLICY "dte_admin_all" ON public.declared_travel_entries
  FOR ALL USING (
    private.dashboard_user_can_access_personal_reports()
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- public_transport_entries
DROP POLICY IF EXISTS "pte_select_own" ON public.public_transport_entries;
CREATE POLICY "pte_select_own" ON public.public_transport_entries
  FOR SELECT USING (
    auth.uid() = employee_id
    AND private.dashboard_user_can_access_personal_reports()
  );

DROP POLICY IF EXISTS "pte_select_admin" ON public.public_transport_entries;
CREATE POLICY "pte_select_admin" ON public.public_transport_entries
  FOR SELECT USING (
    private.dashboard_user_can_access_personal_reports()
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "pte_insert_own" ON public.public_transport_entries;
CREATE POLICY "pte_insert_own" ON public.public_transport_entries
  FOR INSERT WITH CHECK (
    auth.uid() = employee_id
    AND private.dashboard_user_can_access_personal_reports()
    AND EXISTS (
      SELECT 1 FROM public.personal_reports
      WHERE id = report_id AND employee_id = auth.uid() AND status IN ('draft','needs_correction')
    )
  );

DROP POLICY IF EXISTS "pte_update_own_draft" ON public.public_transport_entries;
CREATE POLICY "pte_update_own_draft" ON public.public_transport_entries
  FOR UPDATE USING (
    auth.uid() = employee_id
    AND private.dashboard_user_can_access_personal_reports()
    AND EXISTS (
      SELECT 1 FROM public.personal_reports
      WHERE id = report_id AND employee_id = auth.uid() AND status IN ('draft','needs_correction')
    )
  );

DROP POLICY IF EXISTS "pte_delete_own_draft" ON public.public_transport_entries;
CREATE POLICY "pte_delete_own_draft" ON public.public_transport_entries
  FOR DELETE USING (
    auth.uid() = employee_id
    AND private.dashboard_user_can_access_personal_reports()
    AND EXISTS (
      SELECT 1 FROM public.personal_reports
      WHERE id = report_id AND employee_id = auth.uid() AND status IN ('draft','needs_correction')
    )
  );

DROP POLICY IF EXISTS "pte_admin_all" ON public.public_transport_entries;
CREATE POLICY "pte_admin_all" ON public.public_transport_entries
  FOR ALL USING (
    private.dashboard_user_can_access_personal_reports()
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- expense_entries
DROP POLICY IF EXISTS "ee_select_own" ON public.expense_entries;
CREATE POLICY "ee_select_own" ON public.expense_entries
  FOR SELECT USING (
    auth.uid() = employee_id
    AND private.dashboard_user_can_access_personal_reports()
  );

DROP POLICY IF EXISTS "ee_select_admin" ON public.expense_entries;
CREATE POLICY "ee_select_admin" ON public.expense_entries
  FOR SELECT USING (
    private.dashboard_user_can_access_personal_reports()
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "ee_insert_own" ON public.expense_entries;
CREATE POLICY "ee_insert_own" ON public.expense_entries
  FOR INSERT WITH CHECK (
    auth.uid() = employee_id
    AND private.dashboard_user_can_access_personal_reports()
    AND EXISTS (
      SELECT 1 FROM public.personal_reports
      WHERE id = report_id AND employee_id = auth.uid() AND status IN ('draft','needs_correction')
    )
  );

DROP POLICY IF EXISTS "ee_update_own_draft" ON public.expense_entries;
CREATE POLICY "ee_update_own_draft" ON public.expense_entries
  FOR UPDATE USING (
    auth.uid() = employee_id
    AND private.dashboard_user_can_access_personal_reports()
    AND EXISTS (
      SELECT 1 FROM public.personal_reports
      WHERE id = report_id AND employee_id = auth.uid() AND status IN ('draft','needs_correction')
    )
  );

DROP POLICY IF EXISTS "ee_delete_own_draft" ON public.expense_entries;
CREATE POLICY "ee_delete_own_draft" ON public.expense_entries
  FOR DELETE USING (
    auth.uid() = employee_id
    AND private.dashboard_user_can_access_personal_reports()
    AND EXISTS (
      SELECT 1 FROM public.personal_reports
      WHERE id = report_id AND employee_id = auth.uid() AND status IN ('draft','needs_correction')
    )
  );

DROP POLICY IF EXISTS "ee_admin_all" ON public.expense_entries;
CREATE POLICY "ee_admin_all" ON public.expense_entries
  FOR ALL USING (
    private.dashboard_user_can_access_personal_reports()
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- report_attachments
DROP POLICY IF EXISTS "ra_select_own" ON public.report_attachments;
CREATE POLICY "ra_select_own" ON public.report_attachments
  FOR SELECT USING (
    auth.uid() = employee_id
    AND private.dashboard_user_can_access_personal_reports()
  );

DROP POLICY IF EXISTS "ra_select_admin" ON public.report_attachments;
CREATE POLICY "ra_select_admin" ON public.report_attachments
  FOR SELECT USING (
    private.dashboard_user_can_access_personal_reports()
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "ra_insert_own" ON public.report_attachments;
CREATE POLICY "ra_insert_own" ON public.report_attachments
  FOR INSERT WITH CHECK (
    auth.uid() = employee_id
    AND private.dashboard_user_can_access_personal_reports()
    AND EXISTS (
      SELECT 1 FROM public.personal_reports
      WHERE id = report_id AND employee_id = auth.uid() AND status IN ('draft','needs_correction')
    )
  );

DROP POLICY IF EXISTS "ra_delete_own_draft" ON public.report_attachments;
CREATE POLICY "ra_delete_own_draft" ON public.report_attachments
  FOR DELETE USING (
    auth.uid() = employee_id
    AND private.dashboard_user_can_access_personal_reports()
    AND EXISTS (
      SELECT 1 FROM public.personal_reports
      WHERE id = report_id AND employee_id = auth.uid() AND status IN ('draft','needs_correction')
    )
  );

DROP POLICY IF EXISTS "ra_admin_all" ON public.report_attachments;
CREATE POLICY "ra_admin_all" ON public.report_attachments
  FOR ALL USING (
    private.dashboard_user_can_access_personal_reports()
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- absence_entries
DROP POLICY IF EXISTS "ae_select_own" ON public.absence_entries;
CREATE POLICY "ae_select_own" ON public.absence_entries
  FOR SELECT USING (
    auth.uid() = employee_id
    AND private.dashboard_user_can_access_personal_reports()
  );

DROP POLICY IF EXISTS "ae_select_admin" ON public.absence_entries;
CREATE POLICY "ae_select_admin" ON public.absence_entries
  FOR SELECT USING (
    private.dashboard_user_can_access_personal_reports()
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "ae_insert_own" ON public.absence_entries;
CREATE POLICY "ae_insert_own" ON public.absence_entries
  FOR INSERT WITH CHECK (
    auth.uid() = employee_id
    AND private.dashboard_user_can_access_personal_reports()
    AND EXISTS (
      SELECT 1 FROM public.personal_reports
      WHERE id = report_id AND employee_id = auth.uid() AND status IN ('draft','needs_correction')
    )
  );

DROP POLICY IF EXISTS "ae_update_own_draft" ON public.absence_entries;
CREATE POLICY "ae_update_own_draft" ON public.absence_entries
  FOR UPDATE USING (
    auth.uid() = employee_id
    AND private.dashboard_user_can_access_personal_reports()
    AND EXISTS (
      SELECT 1 FROM public.personal_reports
      WHERE id = report_id AND employee_id = auth.uid() AND status IN ('draft','needs_correction')
    )
  );

DROP POLICY IF EXISTS "ae_delete_own_draft" ON public.absence_entries;
CREATE POLICY "ae_delete_own_draft" ON public.absence_entries
  FOR DELETE USING (
    auth.uid() = employee_id
    AND private.dashboard_user_can_access_personal_reports()
    AND EXISTS (
      SELECT 1 FROM public.personal_reports
      WHERE id = report_id AND employee_id = auth.uid() AND status IN ('draft','needs_correction')
    )
  );

DROP POLICY IF EXISTS "ae_admin_all" ON public.absence_entries;
CREATE POLICY "ae_admin_all" ON public.absence_entries
  FOR ALL USING (
    private.dashboard_user_can_access_personal_reports()
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- profiles admin listing for personal reports management
DROP POLICY IF EXISTS "profiles_select_admin" ON public.profiles;
CREATE POLICY "profiles_select_admin" ON public.profiles
  FOR SELECT USING (
    private.dashboard_user_can_access_personal_reports()
    AND EXISTS (
      SELECT 1 FROM public.profiles p2
      WHERE p2.id = auth.uid() AND p2.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "profiles_update_admin" ON public.profiles;
CREATE POLICY "profiles_update_admin" ON public.profiles
  FOR UPDATE USING (
    private.dashboard_user_can_access_personal_reports()
    AND EXISTS (
      SELECT 1 FROM public.profiles p2
      WHERE p2.id = auth.uid() AND p2.role = 'admin'
    )
  );

-- storage bucket policies
DROP POLICY IF EXISTS "storage_insert_own" ON storage.objects;
CREATE POLICY "storage_insert_own" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'personal-report-attachments'
    AND private.dashboard_user_can_access_personal_reports()
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "storage_select_own" ON storage.objects;
CREATE POLICY "storage_select_own" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'personal-report-attachments'
    AND private.dashboard_user_can_access_personal_reports()
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "storage_delete_own" ON storage.objects;
CREATE POLICY "storage_delete_own" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'personal-report-attachments'
    AND private.dashboard_user_can_access_personal_reports()
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "storage_select_admin" ON storage.objects;
CREATE POLICY "storage_select_admin" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'personal-report-attachments'
    AND private.dashboard_user_can_access_personal_reports()
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "storage_delete_admin" ON storage.objects;
CREATE POLICY "storage_delete_admin" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'personal-report-attachments'
    AND private.dashboard_user_can_access_personal_reports()
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- RPC hardening
CREATE OR REPLACE FUNCTION private.personal_reports_can_manage_travel_rates()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT private.dashboard_user_can_access_personal_reports()
    AND EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND role = 'admin'
    );
$$;

CREATE OR REPLACE FUNCTION public.upsert_declared_travel_entry(
  p_id uuid DEFAULT NULL,
  p_report_id uuid DEFAULT NULL,
  p_employee_id uuid DEFAULT NULL,
  p_travel_date date DEFAULT NULL,
  p_origin text DEFAULT '',
  p_destination text DEFAULT '',
  p_description text DEFAULT '',
  p_roundtrip_km numeric DEFAULT 0
)
RETURNS public.declared_travel_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_row public.declared_travel_entries;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_employee_id THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF NOT private.dashboard_user_can_access_personal_reports() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF NOT private.personal_report_is_editable(p_report_id) THEN
    RAISE EXCEPTION 'report_not_editable';
  END IF;

  IF p_id IS NOT NULL THEN
    UPDATE public.declared_travel_entries
    SET
      report_id = p_report_id,
      employee_id = p_employee_id,
      travel_date = p_travel_date,
      origin = COALESCE(p_origin, ''),
      destination = COALESCE(p_destination, ''),
      description = COALESCE(p_description, ''),
      roundtrip_km = COALESCE(p_roundtrip_km, 0),
      updated_at = now()
    WHERE id = p_id
      AND employee_id = p_employee_id
    RETURNING * INTO v_row;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'not_found';
    END IF;
  ELSE
    INSERT INTO public.declared_travel_entries (
      report_id,
      employee_id,
      travel_date,
      origin,
      destination,
      description,
      roundtrip_km
    ) VALUES (
      p_report_id,
      p_employee_id,
      p_travel_date,
      COALESCE(p_origin, ''),
      COALESCE(p_destination, ''),
      COALESCE(p_description, ''),
      COALESCE(p_roundtrip_km, 0)
    )
    RETURNING * INTO v_row;
  END IF;

  RETURN v_row;
END;
$$;

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
      u.is_active  AS c_is_active,
      u.entry_code AS c_entry_code,
      lower(trim(coalesce(u.permissions->>'can_access_personal_reports', ''))) AS c_pr_access
    FROM public.users u
    CROSS JOIN input i
    WHERE lower(trim(u.email)) = i.email
    LIMIT 1
  ),
  diagnostic AS (
    SELECT
      CASE
        WHEN (SELECT g.result FROM guard g) <> 'pass'                    THEN (SELECT g.result FROM guard g)
        WHEN NOT EXISTS (SELECT 1 FROM candidate)                        THEN 'user_not_found'
        WHEN NOT (SELECT c.c_is_active FROM candidate c)               THEN 'inactive_user'
        WHEN (SELECT c.c_pr_access FROM candidate c) NOT IN ('yes', 'true', '1') THEN 'permission_denied'
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
