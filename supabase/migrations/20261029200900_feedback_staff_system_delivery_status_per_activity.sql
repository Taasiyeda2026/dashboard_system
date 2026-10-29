-- Status-only read: per-activity recorded email acceptance, not questionnaire completion.
-- Supabase migration 20261029200900 applied as feedback_staff_system_delivery_status_per_activity.
-- No emails are sent and no data is written or rescheduled by this function.
CREATE OR REPLACE FUNCTION public.feedback_staff_auto_status()
 RETURNS TABLE(activity_row_id text, stage text, status text, reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NOT private.feedback_can_view_results() THEN
    RAISE EXCEPTION 'feedback_forbidden' USING ERRCODE='42501';
  END IF;

  RETURN QUERY
  WITH individual AS (
    SELECT
      member.row_id AS activity_row_id,
      batch.stage, batch.status AS candidate_status,
      batch.contact_email, batch.contact_id,
      a.start_date
    FROM public.feedback_staff_auto_candidates(now()) batch
    CROSS JOIN LATERAL unnest(batch.member_row_ids) AS member(row_id)
    JOIN public.activities a ON a.row_id=member.row_id
  ),
  evidence AS (
    SELECT
      i.*,
      history.status AS recorded_status,
      history.last_error AS recorded_error,
      history.activity_row_id AS recorded_representative
    FROM individual i
    LEFT JOIN LATERAL (
      SELECT o.*
      FROM public.feedback_staff_auto_outbox o
      WHERE o.stage=i.stage
        AND (o.activity_row_id=i.activity_row_id OR i.activity_row_id=ANY(o.member_row_ids))
        -- Legacy aggregated mail records sometimes included future starts.
        -- They are not proof that a questionnaire was sent for a course
        -- that had not yet started when the email was accepted.
        AND (o.status <> 'accepted' OR
          (o.accepted_at IS NOT NULL AND
           (o.accepted_at AT TIME ZONE 'Asia/Jerusalem')::date >= i.start_date))
      ORDER BY
        CASE o.status WHEN 'accepted' THEN 0 WHEN 'unknown' THEN 1
             WHEN 'sending' THEN 2 ELSE 3 END,
        o.updated_at DESC, o.id
      LIMIT 1
    ) history ON TRUE
  )
  SELECT e.activity_row_id,e.stage,
    CASE
      WHEN e.recorded_status='accepted' THEN 'sent'
      WHEN e.recorded_status='failed' THEN 'failed'
      WHEN e.recorded_status IN ('unknown','cancelled','needs_attention') THEN 'needs_attention'
      WHEN e.candidate_status NOT IN ('eligible','not_due','unscheduled') THEN 'needs_attention'
      WHEN e.recorded_status IN ('pending','sending') THEN 'pending'
      WHEN e.stage='pre' AND e.start_date <
          ((now() AT TIME ZONE 'Asia/Jerusalem')::date - 6) THEN 'needs_attention'
      WHEN e.candidate_status='eligible' AND e.stage IN ('pre','mid')
        AND extract(isodow FROM now() AT TIME ZONE 'Asia/Jerusalem')=4
        AND extract(hour FROM now() AT TIME ZONE 'Asia/Jerusalem')<8 THEN 'scheduled'
      WHEN e.candidate_status='eligible' THEN 'needs_attention'
      ELSE 'not_due'
    END::text AS status,
    CASE
      WHEN e.recorded_status IS NOT NULL
        THEN coalesce(e.recorded_error,e.recorded_status)
      WHEN e.stage='pre' AND e.start_date <
          ((now() AT TIME ZONE 'Asia/Jerusalem')::date - 6)
        AND e.contact_id IS NULL THEN 'missing_selected_contact_after_deadline'
      WHEN e.stage='pre' AND e.start_date <
          ((now() AT TIME ZONE 'Asia/Jerusalem')::date - 6)
        AND (e.contact_email IS NULL OR btrim(e.contact_email)='')
        THEN 'missing_contact_email_after_deadline'
      WHEN e.stage='pre' AND e.start_date <
          ((now() AT TIME ZONE 'Asia/Jerusalem')::date - 6)
        THEN 'opening_window_elapsed'
      WHEN e.candidate_status NOT IN ('eligible','not_due','unscheduled')
        THEN e.candidate_status
      WHEN e.candidate_status='eligible'
        AND extract(isodow FROM now() AT TIME ZONE 'Asia/Jerusalem')=4
        AND extract(hour FROM now() AT TIME ZONE 'Asia/Jerusalem')>=8
        THEN 'dispatch_window_elapsed'
      WHEN e.candidate_status='eligible'
        THEN 'awaiting_dispatch'
      ELSE e.candidate_status
    END::text AS reason
  FROM evidence e;
END
$function$
