-- Per-proposal catalog appendix attachment.
-- The proposal form exposes an explicit "הוספת הקטלוג להצעה" action; the chosen state
-- is stored on the proposal row and drives the catalog appendix in Preview/PDF.
alter table public.proposals_agreements
  add column if not exists include_catalog boolean not null default false;

comment on column public.proposals_agreements.include_catalog is
  'When true, the activities catalog / info sheet appendix is attached to the proposal document (Preview/PDF).';

-- Preserve previous behavior: approved proposals used to get the catalog appendix
-- automatically, so keep it attached for them.
update public.proposals_agreements
set include_catalog = true
where status = 'approved'
  and include_catalog = false;
