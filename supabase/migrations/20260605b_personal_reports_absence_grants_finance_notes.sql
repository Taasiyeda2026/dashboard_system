-- Focused personal reports safety migration.
-- Keep RLS enabled; only ensure the authenticated role can exercise CRUD
-- through the existing absence_entries RLS policies, and ensure finance notes
-- exists for returning reports to correction.

ALTER TABLE public.personal_reports
  ADD COLUMN IF NOT EXISTS finance_notes text;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.absence_entries TO authenticated;
