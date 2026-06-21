-- Personal Reports Module
-- Tables: profiles, personal_reports, declared_travel_entries, public_transport_entries, expense_entries, report_attachments
-- Storage bucket: personal-report-attachments
-- RLS policies enforced on all tables
--
-- This migration is intentionally idempotent for Supabase Preview / branch databases:
-- every policy is dropped before being recreated so repeated or partially-applied runs do not fail.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────
-- 1. profiles
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email        text NOT NULL,
  full_name    text NOT NULL DEFAULT '',
  role         text NOT NULL DEFAULT 'employee' CHECK (role IN ('employee', 'admin')),
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_admin" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_admin" ON public.profiles;

CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "profiles_select_admin" ON public.profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles p2
      WHERE p2.id = auth.uid() AND p2.role = 'admin'
    )
  );

CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_update_admin" ON public.profiles
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles p2
      WHERE p2.id = auth.uid() AND p2.role = 'admin'
    )
  );

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─────────────────────────────────────────────
-- 2. personal_reports
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.personal_reports (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  report_month   int  NOT NULL CHECK (report_month BETWEEN 1 AND 12),
  report_year    int  NOT NULL CHECK (report_year >= 2020),
  status         text NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','submitted','needs_correction','approved','paid')),
  submitted_at   timestamptz,
  approved_at    timestamptz,
  paid_at        timestamptz,
  finance_notes  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, report_month, report_year)
);

ALTER TABLE public.personal_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reports_select_own" ON public.personal_reports;
DROP POLICY IF EXISTS "reports_select_admin" ON public.personal_reports;
DROP POLICY IF EXISTS "reports_insert_own" ON public.personal_reports;
DROP POLICY IF EXISTS "reports_update_own_draft" ON public.personal_reports;
DROP POLICY IF EXISTS "reports_update_admin" ON public.personal_reports;

CREATE POLICY "reports_select_own" ON public.personal_reports
  FOR SELECT USING (auth.uid() = employee_id);

CREATE POLICY "reports_select_admin" ON public.personal_reports
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "reports_insert_own" ON public.personal_reports
  FOR INSERT WITH CHECK (auth.uid() = employee_id);

CREATE POLICY "reports_update_own_draft" ON public.personal_reports
  FOR UPDATE USING (
    auth.uid() = employee_id AND status IN ('draft','needs_correction')
  );

CREATE POLICY "reports_update_admin" ON public.personal_reports
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ─────────────────────────────────────────────
-- 3. declared_travel_entries  (נסיעות בהצהרה)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.declared_travel_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id     uuid NOT NULL REFERENCES public.personal_reports(id) ON DELETE CASCADE,
  employee_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  travel_date   date NOT NULL,
  origin        text NOT NULL DEFAULT '',
  destination   text NOT NULL DEFAULT '',
  description   text NOT NULL DEFAULT '',
  roundtrip_km  numeric(10,2) NOT NULL DEFAULT 0,
  amount        numeric(10,2) NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.declared_travel_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dte_select_own" ON public.declared_travel_entries;
DROP POLICY IF EXISTS "dte_select_admin" ON public.declared_travel_entries;
DROP POLICY IF EXISTS "dte_insert_own" ON public.declared_travel_entries;
DROP POLICY IF EXISTS "dte_update_own_draft" ON public.declared_travel_entries;
DROP POLICY IF EXISTS "dte_delete_own_draft" ON public.declared_travel_entries;
DROP POLICY IF EXISTS "dte_admin_all" ON public.declared_travel_entries;

CREATE POLICY "dte_select_own" ON public.declared_travel_entries
  FOR SELECT USING (auth.uid() = employee_id);

CREATE POLICY "dte_select_admin" ON public.declared_travel_entries
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "dte_insert_own" ON public.declared_travel_entries
  FOR INSERT WITH CHECK (
    auth.uid() = employee_id AND
    EXISTS (
      SELECT 1 FROM public.personal_reports
      WHERE id = report_id AND employee_id = auth.uid() AND status IN ('draft','needs_correction')
    )
  );

CREATE POLICY "dte_update_own_draft" ON public.declared_travel_entries
  FOR UPDATE USING (
    auth.uid() = employee_id AND
    EXISTS (
      SELECT 1 FROM public.personal_reports
      WHERE id = report_id AND employee_id = auth.uid() AND status IN ('draft','needs_correction')
    )
  );

CREATE POLICY "dte_delete_own_draft" ON public.declared_travel_entries
  FOR DELETE USING (
    auth.uid() = employee_id AND
    EXISTS (
      SELECT 1 FROM public.personal_reports
      WHERE id = report_id AND employee_id = auth.uid() AND status IN ('draft','needs_correction')
    )
  );

CREATE POLICY "dte_admin_all" ON public.declared_travel_entries
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ─────────────────────────────────────────────
-- 4. public_transport_entries  (תחבורה ציבורית)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.public_transport_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id     uuid NOT NULL REFERENCES public.personal_reports(id) ON DELETE CASCADE,
  employee_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  travel_date   date NOT NULL,
  origin        text NOT NULL DEFAULT '',
  destination   text NOT NULL DEFAULT '',
  description   text NOT NULL DEFAULT '',
  amount        numeric(10,2) NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.public_transport_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pte_select_own" ON public.public_transport_entries;
DROP POLICY IF EXISTS "pte_select_admin" ON public.public_transport_entries;
DROP POLICY IF EXISTS "pte_insert_own" ON public.public_transport_entries;
DROP POLICY IF EXISTS "pte_update_own_draft" ON public.public_transport_entries;
DROP POLICY IF EXISTS "pte_delete_own_draft" ON public.public_transport_entries;
DROP POLICY IF EXISTS "pte_admin_all" ON public.public_transport_entries;

CREATE POLICY "pte_select_own" ON public.public_transport_entries
  FOR SELECT USING (auth.uid() = employee_id);

CREATE POLICY "pte_select_admin" ON public.public_transport_entries
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "pte_insert_own" ON public.public_transport_entries
  FOR INSERT WITH CHECK (
    auth.uid() = employee_id AND
    EXISTS (
      SELECT 1 FROM public.personal_reports
      WHERE id = report_id AND employee_id = auth.uid() AND status IN ('draft','needs_correction')
    )
  );

CREATE POLICY "pte_update_own_draft" ON public.public_transport_entries
  FOR UPDATE USING (
    auth.uid() = employee_id AND
    EXISTS (
      SELECT 1 FROM public.personal_reports
      WHERE id = report_id AND employee_id = auth.uid() AND status IN ('draft','needs_correction')
    )
  );

CREATE POLICY "pte_delete_own_draft" ON public.public_transport_entries
  FOR DELETE USING (
    auth.uid() = employee_id AND
    EXISTS (
      SELECT 1 FROM public.personal_reports
      WHERE id = report_id AND employee_id = auth.uid() AND status IN ('draft','needs_correction')
    )
  );

CREATE POLICY "pte_admin_all" ON public.public_transport_entries
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ─────────────────────────────────────────────
-- 5. expense_entries  (הוצאות)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.expense_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id       uuid NOT NULL REFERENCES public.personal_reports(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expense_date    date NOT NULL,
  document_type   text NOT NULL DEFAULT 'receipt'
                    CHECK (document_type IN ('receipt','invoice','other')),
  description     text NOT NULL DEFAULT '',
  amount          numeric(10,2) NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.expense_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ee_select_own" ON public.expense_entries;
DROP POLICY IF EXISTS "ee_select_admin" ON public.expense_entries;
DROP POLICY IF EXISTS "ee_insert_own" ON public.expense_entries;
DROP POLICY IF EXISTS "ee_update_own_draft" ON public.expense_entries;
DROP POLICY IF EXISTS "ee_delete_own_draft" ON public.expense_entries;
DROP POLICY IF EXISTS "ee_admin_all" ON public.expense_entries;

CREATE POLICY "ee_select_own" ON public.expense_entries
  FOR SELECT USING (auth.uid() = employee_id);

CREATE POLICY "ee_select_admin" ON public.expense_entries
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "ee_insert_own" ON public.expense_entries
  FOR INSERT WITH CHECK (
    auth.uid() = employee_id AND
    EXISTS (
      SELECT 1 FROM public.personal_reports
      WHERE id = report_id AND employee_id = auth.uid() AND status IN ('draft','needs_correction')
    )
  );

CREATE POLICY "ee_update_own_draft" ON public.expense_entries
  FOR UPDATE USING (
    auth.uid() = employee_id AND
    EXISTS (
      SELECT 1 FROM public.personal_reports
      WHERE id = report_id AND employee_id = auth.uid() AND status IN ('draft','needs_correction')
    )
  );

CREATE POLICY "ee_delete_own_draft" ON public.expense_entries
  FOR DELETE USING (
    auth.uid() = employee_id AND
    EXISTS (
      SELECT 1 FROM public.personal_reports
      WHERE id = report_id AND employee_id = auth.uid() AND status IN ('draft','needs_correction')
    )
  );

CREATE POLICY "ee_admin_all" ON public.expense_entries
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ─────────────────────────────────────────────
-- 6. report_attachments  (קבצים מצורפים)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.report_attachments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id        uuid NOT NULL REFERENCES public.personal_reports(id) ON DELETE CASCADE,
  employee_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expense_entry_id uuid REFERENCES public.expense_entries(id) ON DELETE SET NULL,
  storage_path     text NOT NULL,
  file_name        text NOT NULL DEFAULT '',
  file_type        text NOT NULL DEFAULT '',
  file_size        bigint NOT NULL DEFAULT 0,
  uploaded_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.report_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ra_select_own" ON public.report_attachments;
DROP POLICY IF EXISTS "ra_select_admin" ON public.report_attachments;
DROP POLICY IF EXISTS "ra_insert_own" ON public.report_attachments;
DROP POLICY IF EXISTS "ra_delete_own_draft" ON public.report_attachments;
DROP POLICY IF EXISTS "ra_admin_all" ON public.report_attachments;

CREATE POLICY "ra_select_own" ON public.report_attachments
  FOR SELECT USING (auth.uid() = employee_id);

CREATE POLICY "ra_select_admin" ON public.report_attachments
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "ra_insert_own" ON public.report_attachments
  FOR INSERT WITH CHECK (
    auth.uid() = employee_id AND
    EXISTS (
      SELECT 1 FROM public.personal_reports
      WHERE id = report_id AND employee_id = auth.uid() AND status IN ('draft','needs_correction')
    )
  );

CREATE POLICY "ra_delete_own_draft" ON public.report_attachments
  FOR DELETE USING (
    auth.uid() = employee_id AND
    EXISTS (
      SELECT 1 FROM public.personal_reports
      WHERE id = report_id AND employee_id = auth.uid() AND status IN ('draft','needs_correction')
    )
  );

CREATE POLICY "ra_admin_all" ON public.report_attachments
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ─────────────────────────────────────────────
-- Storage bucket RLS policies
-- (bucket must be created manually in Supabase Dashboard as private bucket named: personal-report-attachments)
-- ─────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'personal-report-attachments',
  'personal-report-attachments',
  false,
  10485760,
  ARRAY['image/jpeg','image/png','image/webp','image/gif','application/pdf','image/heic','image/heif']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "storage_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "storage_select_own" ON storage.objects;
DROP POLICY IF EXISTS "storage_delete_own" ON storage.objects;
DROP POLICY IF EXISTS "storage_select_admin" ON storage.objects;
DROP POLICY IF EXISTS "storage_delete_admin" ON storage.objects;

-- Employees can upload to their own folder: {user_id}/...
CREATE POLICY "storage_insert_own" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'personal-report-attachments' AND
    auth.uid()::text = split_part(name, '/', 1)
  );

-- Employees can read their own files
CREATE POLICY "storage_select_own" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'personal-report-attachments' AND
    auth.uid()::text = split_part(name, '/', 1)
  );

-- Employees can delete their own files
CREATE POLICY "storage_delete_own" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'personal-report-attachments' AND
    auth.uid()::text = split_part(name, '/', 1)
  );

-- Admins can read all files
CREATE POLICY "storage_select_admin" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'personal-report-attachments' AND
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Admins can delete all files
CREATE POLICY "storage_delete_admin" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'personal-report-attachments' AND
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );