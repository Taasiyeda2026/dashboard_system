-- Personal reports: absence entries for salary reporting (vacation / sick / declaration)

CREATE TABLE IF NOT EXISTS public.absence_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id       uuid NOT NULL REFERENCES public.personal_reports(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  absence_type    text NOT NULL CHECK (absence_type IN ('vacation', 'sick', 'declaration')),
  start_date      date NOT NULL,
  end_date        date NOT NULL,
  calculated_days numeric(5,1) NOT NULL DEFAULT 0 CHECK (calculated_days >= 0),
  notes           text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS absence_entries_report_id_idx ON public.absence_entries(report_id);
CREATE INDEX IF NOT EXISTS absence_entries_employee_id_idx ON public.absence_entries(employee_id);

ALTER TABLE public.absence_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ae_select_own" ON public.absence_entries
  FOR SELECT USING (auth.uid() = employee_id);

CREATE POLICY "ae_select_admin" ON public.absence_entries
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "ae_insert_own" ON public.absence_entries
  FOR INSERT WITH CHECK (
    auth.uid() = employee_id AND
    EXISTS (
      SELECT 1 FROM public.personal_reports
      WHERE id = report_id AND employee_id = auth.uid() AND status IN ('draft','needs_correction')
    )
  );

CREATE POLICY "ae_update_own_draft" ON public.absence_entries
  FOR UPDATE USING (
    auth.uid() = employee_id AND
    EXISTS (
      SELECT 1 FROM public.personal_reports
      WHERE id = report_id AND employee_id = auth.uid() AND status IN ('draft','needs_correction')
    )
  );

CREATE POLICY "ae_delete_own_draft" ON public.absence_entries
  FOR DELETE USING (
    auth.uid() = employee_id AND
    EXISTS (
      SELECT 1 FROM public.personal_reports
      WHERE id = report_id AND employee_id = auth.uid() AND status IN ('draft','needs_correction')
    )
  );

CREATE POLICY "ae_admin_all" ON public.absence_entries
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

ALTER TABLE public.report_attachments
  ADD COLUMN IF NOT EXISTS absence_entry_id uuid REFERENCES public.absence_entries(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS report_attachments_absence_entry_id_idx ON public.report_attachments(absence_entry_id);
CREATE INDEX IF NOT EXISTS report_attachments_expense_entry_id_idx ON public.report_attachments(expense_entry_id);
