-- Preserve the full quick-pick pricing context on proposal line items.

ALTER TABLE public.proposal_agreement_items
  ADD COLUMN IF NOT EXISTS activity_no text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS unit_duration text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS proposal_group text NOT NULL DEFAULT '';
