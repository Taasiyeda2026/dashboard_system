alter table public.proposal_agreement_items
  add column if not exists list_id bigint;
