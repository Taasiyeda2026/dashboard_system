ALTER TABLE public.proposals_agreements
  ADD COLUMN IF NOT EXISTS custom_document_sections jsonb NOT NULL DEFAULT '{}'::jsonb;
