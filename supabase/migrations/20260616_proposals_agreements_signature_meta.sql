-- Store admin-selected proposal signature placement as JSON percentages relative to the A4 page.
ALTER TABLE public.proposals_agreements
  ADD COLUMN IF NOT EXISTS signature_meta jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.proposals_agreements.signature_meta IS
  'Proposal approval signature metadata, including image path and x/y/width percentages relative to the A4 page.';
