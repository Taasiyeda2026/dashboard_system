-- Personal reports: correction workflow and distinct attachment rules.

ALTER TABLE public.personal_reports
  ADD COLUMN IF NOT EXISTS correction_note text,
  ADD COLUMN IF NOT EXISTS correction_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS correction_requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.expense_entries
  ADD COLUMN IF NOT EXISTS reliability_declaration boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.return_personal_report_for_correction(
  p_report_id uuid,
  p_correction_note text
)
RETURNS public.personal_reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_report public.personal_reports;
  v_note text := btrim(coalesce(p_correction_note, ''));
BEGIN
  IF NOT private.dashboard_user_can_manage_personal_reports() THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  IF v_note = '' THEN
    RAISE EXCEPTION 'correction_note_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_report
  FROM public.personal_reports
  WHERE id = p_report_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'personal_report_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_report.status = 'paid' THEN
    RAISE EXCEPTION 'report_paid_not_returnable' USING ERRCODE = '22023';
  END IF;

  IF v_report.status NOT IN ('submitted', 'approved') THEN
    RAISE EXCEPTION 'report_status_not_returnable' USING ERRCODE = '22023';
  END IF;

  UPDATE public.personal_reports
  SET status = 'needs_correction',
      correction_note = v_note,
      correction_requested_at = now(),
      correction_requested_by = auth.uid(),
      finance_notes = v_note,
      updated_at = now()
  WHERE id = p_report_id
  RETURNING * INTO v_report;

  RETURN v_report;
END;
$$;

GRANT EXECUTE ON FUNCTION public.return_personal_report_for_correction(uuid, text) TO authenticated;
