-- Narrow owner-scoped expiry extension: activity managers may ONLY extend
-- previously expired, unanswered instructor campaigns for their CURRENT courses.
-- This never changes templates, public links, responses, opening times or mail history.
CREATE OR REPLACE FUNCTION public.feedback_manager_extend_instructor_expiry(
  p_campaign_id uuid,
  p_expires_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $body$
DECLARE
  v_campaign public.feedback_campaigns%ROWTYPE;
BEGIN
  IF (select auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'feedback_forbidden' USING ERRCODE='42501';
  END IF;

  SELECT c.* INTO v_campaign
  FROM public.feedback_campaigns c
  WHERE c.id=p_campaign_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'feedback_campaign_not_found';
  END IF;

  IF v_campaign.audience <> 'instructor'
     OR v_campaign.status <> 'active'
     OR v_campaign.expires_at IS NULL
     OR v_campaign.expires_at > now() THEN
    RAISE EXCEPTION 'feedback_expiry_not_eligible';
  END IF;

  IF EXISTS (
      SELECT 1 FROM public.feedback_recipients rec
      WHERE rec.campaign_id=v_campaign.id
        AND (rec.status='completed' OR rec.completed_at IS NOT NULL)
    ) OR EXISTS (
      SELECT 1 FROM public.feedback_responses resp
      WHERE resp.campaign_id=v_campaign.id
    ) THEN
    RAISE EXCEPTION 'feedback_already_completed';
  END IF;

  IF p_expires_at IS NULL OR p_expires_at <= now()
     OR p_expires_at <= v_campaign.opens_at THEN
    RAISE EXCEPTION 'feedback_invalid_window';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.activities a
    CROSS JOIN LATERAL private.feedback_activity_program(to_jsonb(a)) program
    WHERE a.activity_season=v_campaign.academic_year
      AND a.start_date IS NOT NULL
      AND a.instructor_assignment_locked IS TRUE
      AND private.feedback_is_course_activity(to_jsonb(a))
      AND (a.emp_id::text=v_campaign.instructor_emp_id
        OR a.emp_id_2=v_campaign.instructor_emp_id)
      AND program.program_key=v_campaign.program_key
      AND NOT COALESCE(program.excluded,false)
      AND private.feedback_can_share_staff_activity(a.row_id)
  ) THEN
    RAISE EXCEPTION 'feedback_forbidden' USING ERRCODE='42501';
  END IF;

  UPDATE public.feedback_campaigns
  SET expires_at=p_expires_at,updated_at=now()
  WHERE id=v_campaign.id;

  RETURN jsonb_build_object(
    'updated',true,
    'campaign_id',v_campaign.id,
    'expires_at',p_expires_at
  );
END
$body$;

REVOKE ALL ON FUNCTION public.feedback_manager_extend_instructor_expiry(uuid,timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.feedback_manager_extend_instructor_expiry(uuid,timestamptz)
  TO authenticated;

NOTIFY pgrst,'reload schema';
