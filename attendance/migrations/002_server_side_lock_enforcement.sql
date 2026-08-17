-- ============================================================
-- Migration 002: Server-side month lock enforcement + GRANTs
-- Branch: feature/attendance-v2
-- Applied: 2026-08-17
-- Purpose: DB-level enforcement of month edits — grace period,
--          submitted/locked status. Complements frontend
--          canEditMonth() but is the *authoritative* gate.
-- ============================================================

-- ──────────────────────────────────────────────────────────
-- 1. Table-level GRANTs (required for RLS to work via REST)
-- ──────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_records TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_record_attachments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_month_approvals TO authenticated;
GRANT SELECT ON public.attendance_records TO anon;
GRANT SELECT ON public.attendance_record_attachments TO anon;
GRANT SELECT ON public.attendance_month_approvals TO anon;

-- ──────────────────────────────────────────────────────────
-- 2. Core enforcement function: av2_can_write_month
--    Resolves caller from auth.uid() — never trusts frontend.
--    Returns false if month is submitted, locked, or past
--    grace period (days 1-2 of following month).
-- ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.av2_can_write_month(p_report_date date)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_emp_id      bigint;
  v_month_key   text;
  v_status      text;
  v_cur_year    int  := EXTRACT(YEAR  FROM CURRENT_DATE)::int;
  v_cur_month   int  := EXTRACT(MONTH FROM CURRENT_DATE)::int;
  v_cur_day     int  := EXTRACT(DAY   FROM CURRENT_DATE)::int;
  v_rec_year    int  := EXTRACT(YEAR  FROM p_report_date)::int;
  v_rec_month   int  := EXTRACT(MONTH FROM p_report_date)::int;
  v_prev_year   int;
  v_prev_month  int;
BEGIN
  -- Resolve emp_id from authenticated session — never from input
  SELECT emp_id::bigint INTO v_emp_id
  FROM public.users
  WHERE auth_user_id = auth.uid()
  LIMIT 1;
  IF v_emp_id IS NULL THEN RETURN false; END IF;

  v_month_key := TO_CHAR(p_report_date, 'YYYY-MM');

  -- Check approval status
  SELECT status INTO v_status
  FROM public.attendance_month_approvals
  WHERE emp_id = v_emp_id AND month_key = v_month_key;

  -- Hard block: submitted or locked
  IF v_status IN ('submitted', 'locked') THEN RETURN false; END IF;

  -- Current calendar month: always editable
  IF v_rec_year = v_cur_year AND v_rec_month = v_cur_month THEN RETURN true; END IF;

  -- Previous month: editable only during grace period (days 1-2 of current month)
  IF v_cur_month = 1 THEN
    v_prev_year := v_cur_year - 1; v_prev_month := 12;
  ELSE
    v_prev_year := v_cur_year;     v_prev_month := v_cur_month - 1;
  END IF;

  IF v_rec_year = v_prev_year AND v_rec_month = v_prev_month
     AND v_cur_day <= 2 THEN
    RETURN true;
  END IF;

  -- All other months: blocked
  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.av2_can_write_month(date) TO authenticated;

-- ──────────────────────────────────────────────────────────
-- 3. Attachment enforcement helper: av2_can_write_attachment
--    Looks up parent record date, then delegates to
--    av2_can_write_month for the actual policy check.
-- ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.av2_can_write_attachment(p_record_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_report_date date;
BEGIN
  SELECT report_date INTO v_report_date
  FROM public.attendance_records WHERE id = p_record_id;
  IF v_report_date IS NULL THEN RETURN false; END IF;
  RETURN public.av2_can_write_month(v_report_date);
END;
$$;

GRANT EXECUTE ON FUNCTION public.av2_can_write_attachment(uuid) TO authenticated;

-- ──────────────────────────────────────────────────────────
-- 4. Updated RLS policies on attendance_records
--    (INSERT/UPDATE/DELETE now include av2_can_write_month)
-- ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "av2_ar_insert" ON public.attendance_records;
DROP POLICY IF EXISTS "av2_ar_update" ON public.attendance_records;
DROP POLICY IF EXISTS "av2_ar_delete" ON public.attendance_records;

CREATE POLICY "av2_ar_insert" ON public.attendance_records FOR INSERT
  WITH CHECK (
    emp_id = (SELECT emp_id::bigint FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1)
    AND public.av2_can_write_month(report_date)
  );

CREATE POLICY "av2_ar_update" ON public.attendance_records FOR UPDATE
  USING (
    emp_id = (SELECT emp_id::bigint FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1)
    AND public.av2_can_write_month(report_date)
  )
  WITH CHECK (
    emp_id = (SELECT emp_id::bigint FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1)
    AND public.av2_can_write_month(report_date)
  );

CREATE POLICY "av2_ar_delete" ON public.attendance_records FOR DELETE
  USING (
    emp_id = (SELECT emp_id::bigint FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1)
    AND public.av2_can_write_month(report_date)
  );

-- ──────────────────────────────────────────────────────────
-- 5. Updated RLS policies on attendance_record_attachments
-- ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "av2_ara_insert" ON public.attendance_record_attachments;
DROP POLICY IF EXISTS "av2_ara_delete" ON public.attendance_record_attachments;

CREATE POLICY "av2_ara_insert" ON public.attendance_record_attachments FOR INSERT
  WITH CHECK (
    emp_id = (SELECT emp_id::bigint FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1)
    AND public.av2_can_write_attachment(record_id)
  );

CREATE POLICY "av2_ara_delete" ON public.attendance_record_attachments FOR DELETE
  USING (
    emp_id = (SELECT emp_id::bigint FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1)
    AND public.av2_can_write_attachment(record_id)
  );

-- ──────────────────────────────────────────────────────────
-- 6. Trigger: auto-fill emp_id from auth.uid() on INSERT
--    Prevents frontend from injecting a foreign emp_id.
-- ──────────────────────────────────────────────────────────

-- attendance_records trigger
CREATE OR REPLACE FUNCTION public.av2_attendance_record_before_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_emp_id bigint;
BEGIN
  SELECT emp_id::bigint INTO v_emp_id FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_emp_id IS NULL THEN RAISE EXCEPTION 'No authenticated user or missing users mapping'; END IF;
  NEW.emp_id := v_emp_id;
  RETURN NEW;
END; $$;

GRANT EXECUTE ON FUNCTION public.av2_attendance_record_before_insert() TO authenticated;

DROP TRIGGER IF EXISTS av2_set_emp_id ON public.attendance_records;
CREATE TRIGGER av2_set_emp_id
  BEFORE INSERT ON public.attendance_records
  FOR EACH ROW EXECUTE FUNCTION public.av2_attendance_record_before_insert();

-- attendance_record_attachments trigger
CREATE OR REPLACE FUNCTION public.av2_attachment_before_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_emp_id bigint;
BEGIN
  SELECT emp_id::bigint INTO v_emp_id FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_emp_id IS NULL THEN RAISE EXCEPTION 'No authenticated user'; END IF;
  NEW.emp_id := v_emp_id;
  RETURN NEW;
END; $$;

GRANT EXECUTE ON FUNCTION public.av2_attachment_before_insert() TO authenticated;

DROP TRIGGER IF EXISTS av2_set_attach_emp_id ON public.attendance_record_attachments;
CREATE TRIGGER av2_set_attach_emp_id
  BEFORE INSERT ON public.attendance_record_attachments
  FOR EACH ROW EXECUTE FUNCTION public.av2_attachment_before_insert();

-- attendance_month_approvals trigger
CREATE OR REPLACE FUNCTION public.av2_approval_before_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_emp_id bigint;
BEGIN
  SELECT emp_id::bigint INTO v_emp_id FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_emp_id IS NULL THEN RAISE EXCEPTION 'No authenticated user'; END IF;
  NEW.emp_id := v_emp_id;
  RETURN NEW;
END; $$;

GRANT EXECUTE ON FUNCTION public.av2_approval_before_insert() TO authenticated;

DROP TRIGGER IF EXISTS av2_set_approval_emp_id ON public.attendance_month_approvals;
CREATE TRIGGER av2_set_approval_emp_id
  BEFORE INSERT ON public.attendance_month_approvals
  FOR EACH ROW EXECUTE FUNCTION public.av2_approval_before_insert();

-- ──────────────────────────────────────────────────────────
-- 7. Function GRANTs for RPCs (already deployed in Mig 001)
-- ──────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.av2_get_distinct_activity_types() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.av2_get_instructor_activities_for_date(bigint, date) TO authenticated, anon;
