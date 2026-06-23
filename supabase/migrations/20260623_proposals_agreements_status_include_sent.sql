-- Allow proposals/agreements to persist every workflow status used by the application.
ALTER TABLE public.proposals_agreements
  DROP CONSTRAINT IF EXISTS proposals_agreements_status_check;

ALTER TABLE public.proposals_agreements
  ADD CONSTRAINT proposals_agreements_status_check
  CHECK (status IN ('draft', 'pending_approval', 'returned_for_changes', 'approved', 'sent', 'cancelled'));
