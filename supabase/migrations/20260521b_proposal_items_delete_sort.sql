-- Allow DELETE on proposal_agreement_items so the UI can replace the full item list on save.
-- Also adds sort_order for stable item ordering.

ALTER TABLE public.proposal_agreement_items
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

GRANT DELETE ON public.proposal_agreement_items TO authenticated;

DROP POLICY IF EXISTS proposal_agreement_items_delete ON public.proposal_agreement_items;
CREATE POLICY proposal_agreement_items_delete
  ON public.proposal_agreement_items FOR DELETE TO authenticated
  USING (public.app_can_use_proposals_agreements());
