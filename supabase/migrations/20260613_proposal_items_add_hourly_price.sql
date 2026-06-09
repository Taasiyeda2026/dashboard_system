-- Add hourly_price to proposal_agreement_items to persist pricing context with each line item.
ALTER TABLE public.proposal_agreement_items
  ADD COLUMN IF NOT EXISTS hourly_price numeric;
