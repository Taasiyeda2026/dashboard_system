-- Personal reports: digital signature metadata and reviewed status.
-- Keeps existing tables/policies intact; only extends report metadata used by the screen.
ALTER TABLE public.personal_reports
  ADD COLUMN IF NOT EXISTS signature_full_name text,
  ADD COLUMN IF NOT EXISTS signature_confirmed_at timestamptz;

ALTER TABLE public.personal_reports
  DROP CONSTRAINT IF EXISTS personal_reports_status_check;

ALTER TABLE public.personal_reports
  ADD CONSTRAINT personal_reports_status_check
  CHECK (status IN ('draft','submitted','reviewed','approved','needs_correction','paid'));
