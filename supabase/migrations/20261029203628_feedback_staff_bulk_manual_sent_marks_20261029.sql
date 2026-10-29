-- One-time production administrative marking requested 2026-10-29.
-- 17 groups / 25 activities are displayed as 'sent', WITHOUT actually
-- dispatching any mail. The real Microsoft Graph outbox is never altered.
-- Keep the source metadata so these UI marks cannot be mistaken for delivery proof.
CREATE TABLE IF NOT EXISTS private.feedback_staff_manual_sent_marks (
  activity_row_id text NOT NULL,
  stage text NOT NULL CHECK(stage='pre'),
  source_group_key text NOT NULL,
  marked_at timestamptz NOT NULL DEFAULT now(),
  marker_source text NOT NULL DEFAULT 'user_requested_bulk_mark_2026_10_29',
  CONSTRAINT feedback_staff_manual_sent_marks_pkey PRIMARY KEY(activity_row_id,stage)
);
REVOKE ALL ON private.feedback_staff_manual_sent_marks FROM PUBLIC,anon,authenticated;
COMMENT ON TABLE private.feedback_staff_manual_sent_marks IS 'Manual UI-only marks by user request, NOT evidence of email delivery. Actual sends remain in feedback_staff_auto_outbox.';

-- Fixed audit snapshot of the precise activities manually marked on 2026-10-29.
INSERT INTO private.feedback_staff_manual_sent_marks
 (activity_row_id,stage,source_group_key,marked_at,marker_source)
VALUES
  ('ACT-15afb366-1650-4792-9e64-b7d54e957cec','pre','007fc8f40c7ec4d741e15503e73982b2','2026-10-29 20:36:28.128393+00'::timestamptz,'user_requested_bulk_mark_2026_10_29'),
  ('ACT-19fa954b-ee04-4e20-aaf5-001ac61aec88','pre','007fc8f40c7ec4d741e15503e73982b2','2026-10-29 20:36:28.128393+00'::timestamptz,'user_requested_bulk_mark_2026_10_29'),
  ('ACT-1a1ec6f5-dc80-4391-9028-33f2c0e17a32','pre','007fc8f40c7ec4d741e15503e73982b2','2026-10-29 20:36:28.128393+00'::timestamptz,'user_requested_bulk_mark_2026_10_29'),
  ('ACT-48978a32-162d-481d-8d9c-2bb63c918e3a','pre','e764dfa6347a945bed080dcb11ff7590','2026-10-29 20:36:28.128393+00'::timestamptz,'user_requested_bulk_mark_2026_10_29'),
  ('ACT-49fee658-1471-46c4-b18a-587bccc29553','pre','007fc8f40c7ec4d741e15503e73982b2','2026-10-29 20:36:28.128393+00'::timestamptz,'user_requested_bulk_mark_2026_10_29'),
  ('ACT-4d5bdc34-26d7-475e-9050-dfb4c902cd8f','pre','1a533c12651e1c0c9b2946c0daa97d96','2026-10-29 20:36:28.128393+00'::timestamptz,'user_requested_bulk_mark_2026_10_29'),
  ('ACT-69fb3cb5-ab4f-463e-b83f-cca5f81b43cf','pre','7a715d5cefd4d566825704a861a247f4','2026-10-29 20:36:28.128393+00'::timestamptz,'user_requested_bulk_mark_2026_10_29'),
  ('ACT-7b2b665e-8faf-4d90-ba4e-f09724126ba8','pre','ea7a9c8df6ed4faf348c27017ea0093d','2026-10-29 20:36:28.128393+00'::timestamptz,'user_requested_bulk_mark_2026_10_29'),
  ('ACT-a032b570-fee2-4310-8e40-b86d69336106','pre','79437e1753e780530dde076626b82cb5','2026-10-29 20:36:28.128393+00'::timestamptz,'user_requested_bulk_mark_2026_10_29'),
  ('ACT-a85f53a4-5cdb-4fec-ab87-8a837fe273bc','pre','ea7a9c8df6ed4faf348c27017ea0093d','2026-10-29 20:36:28.128393+00'::timestamptz,'user_requested_bulk_mark_2026_10_29'),
  ('ACT-ae91f5b1-b123-4f15-87e2-63cc8e2453fc','pre','20d62bfb3448b145536f92d182ae7665','2026-10-29 20:36:28.128393+00'::timestamptz,'user_requested_bulk_mark_2026_10_29'),
  ('ACT-cd86ef69-671c-40b1-8a61-7111fbecef7b','pre','b2f0dd42af0bff5f95f996d972feb9fc','2026-10-29 20:36:28.128393+00'::timestamptz,'user_requested_bulk_mark_2026_10_29'),
  ('ISR-ORDER-2027-218966-57651-1','pre','dca011b090e6a0acdaa8971dcd725243','2026-10-29 20:36:28.128393+00'::timestamptz,'user_requested_bulk_mark_2026_10_29'),
  ('ISR-ORDER-2027-218966-57651-2','pre','dca011b090e6a0acdaa8971dcd725243','2026-10-29 20:36:28.128393+00'::timestamptz,'user_requested_bulk_mark_2026_10_29'),
  ('ISR-ORDER-2027-218966-57651-3','pre','dca011b090e6a0acdaa8971dcd725243','2026-10-29 20:36:28.128393+00'::timestamptz,'user_requested_bulk_mark_2026_10_29'),
  ('PAI-ebfab6d5-91e2-423e-a382-7f9f14a17960','pre','76dc71be71441f612acc4a4f4169d21e','2026-10-29 20:36:28.128393+00'::timestamptz,'user_requested_bulk_mark_2026_10_29'),
  ('PAI-ebfab6d5-91e2-423e-a382-7f9f14a17960-2','pre','cc1da2b1d3ad1c3d189ed15c66d944fe','2026-10-29 20:36:28.128393+00'::timestamptz,'user_requested_bulk_mark_2026_10_29'),
  ('PAI-ebfab6d5-91e2-423e-a382-7f9f14a17960-3','pre','76dc71be71441f612acc4a4f4169d21e','2026-10-29 20:36:28.128393+00'::timestamptz,'user_requested_bulk_mark_2026_10_29'),
  ('school_2027_032','pre','0895ce0b5c9292a983289d49ff129dc9','2026-10-29 20:36:28.128393+00'::timestamptz,'user_requested_bulk_mark_2026_10_29'),
  ('school_2027_038','pre','496004b8b383722898bc255473defa37','2026-10-29 20:36:28.128393+00'::timestamptz,'user_requested_bulk_mark_2026_10_29'),
  ('school_2027_039','pre','496004b8b383722898bc255473defa37','2026-10-29 20:36:28.128393+00'::timestamptz,'user_requested_bulk_mark_2026_10_29'),
  ('school_2027_049','pre','4d59d29f4878ca1c22f57c258478ebcc','2026-10-29 20:36:28.128393+00'::timestamptz,'user_requested_bulk_mark_2026_10_29'),
  ('school_2027_070','pre','1faca52356481fb6e0ac44a18ef05e17','2026-10-29 20:36:28.128393+00'::timestamptz,'user_requested_bulk_mark_2026_10_29'),
  ('school_2027_105','pre','592ffee7636f069bed9aa9c0dba698b8','2026-10-29 20:36:28.128393+00'::timestamptz,'user_requested_bulk_mark_2026_10_29'),
  ('school_2027_110','pre','a8ca6e3ca046cc58e5c16d20eaad83d8','2026-10-29 20:36:28.128393+00'::timestamptz,'user_requested_bulk_mark_2026_10_29')
ON CONFLICT(activity_row_id,stage) DO NOTHING;

-- The status RPC keeps the original viewer authorization and accepted-mail evidence.
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
      WHEN mark.activity_row_id IS NOT NULL THEN 'sent'
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
      WHEN mark.activity_row_id IS NOT NULL AND e.recorded_status IS DISTINCT FROM 'accepted'
        THEN 'manually_marked_sent_without_dispatch'
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
  FROM evidence e
  LEFT JOIN private.feedback_staff_manual_sent_marks mark
    ON mark.activity_row_id=e.activity_row_id AND mark.stage=e.stage;
END
$function$;
