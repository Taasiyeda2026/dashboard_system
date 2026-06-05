-- Add monthly work-hour rows for the personal reports screen.
-- The table is keyed by report_id + employee_id so reports remain identified by employee/month/year via personal_reports.
CREATE TABLE IF NOT EXISTS public.work_hour_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id    uuid NOT NULL REFERENCES public.personal_reports(id) ON DELETE CASCADE,
  employee_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  work_date    date NOT NULL,
  description  text NOT NULL DEFAULT '',
  hours_count  numeric(10,2) NOT NULL DEFAULT 0 CHECK (hours_count >= 0),
  notes        text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.work_hour_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "whe_select_own" ON public.work_hour_entries
  FOR SELECT USING (auth.uid() = employee_id);

CREATE POLICY "whe_select_admin" ON public.work_hour_entries
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "whe_insert_own" ON public.work_hour_entries
  FOR INSERT WITH CHECK (
    auth.uid() = employee_id
    AND EXISTS (
      SELECT 1 FROM public.personal_reports
      WHERE id = report_id AND employee_id = auth.uid() AND status IN ('draft','needs_correction')
    )
  );

CREATE POLICY "whe_update_own_draft" ON public.work_hour_entries
  FOR UPDATE USING (
    auth.uid() = employee_id
    AND EXISTS (
      SELECT 1 FROM public.personal_reports
      WHERE id = report_id AND employee_id = auth.uid() AND status IN ('draft','needs_correction')
    )
  );

CREATE POLICY "whe_delete_own_draft" ON public.work_hour_entries
  FOR DELETE USING (
    auth.uid() = employee_id
    AND EXISTS (
      SELECT 1 FROM public.personal_reports
      WHERE id = report_id AND employee_id = auth.uid() AND status IN ('draft','needs_correction')
    )
  );

CREATE POLICY "whe_admin_all" ON public.work_hour_entries
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE INDEX IF NOT EXISTS idx_work_hour_entries_report_date
  ON public.work_hour_entries(report_id, work_date);
