-- Add leave/meta columns to personal_reports
-- Required for: vacation days, sick days, declaration day, work days in month, report notes
ALTER TABLE public.personal_reports
  ADD COLUMN IF NOT EXISTS work_days_in_month int,
  ADD COLUMN IF NOT EXISTS vacation_days      numeric(5,1) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sick_days          numeric(5,1) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS declaration_day    date,
  ADD COLUMN IF NOT EXISTS report_notes       text DEFAULT '';

-- Add notes column to entry tables (for הערות column in each table)
ALTER TABLE public.declared_travel_entries
  ADD COLUMN IF NOT EXISTS notes text DEFAULT '';

ALTER TABLE public.public_transport_entries
  ADD COLUMN IF NOT EXISTS notes text DEFAULT '';

ALTER TABLE public.expense_entries
  ADD COLUMN IF NOT EXISTS notes text DEFAULT '';
