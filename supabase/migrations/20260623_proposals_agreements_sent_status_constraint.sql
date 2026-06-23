-- Allow signed proposals/agreements to be persisted with the business "sent" status.
-- The application marks approval-and-signature completion as status='sent'.
ALTER TABLE public.proposals_agreements
  DROP CONSTRAINT IF EXISTS proposals_agreements_status_check;

ALTER TABLE public.proposals_agreements
  ADD CONSTRAINT proposals_agreements_status_check
  CHECK (status IN ('draft', 'sent', 'pending_approval', 'returned_for_changes', 'approved', 'cancelled'));
