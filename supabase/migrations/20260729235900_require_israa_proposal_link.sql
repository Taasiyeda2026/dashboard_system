-- Israa is a tracking projection of proposals, never an independent proposal form.
-- NOT VALID preserves any historic orphan rows for deliberate data repair while
-- PostgreSQL enforces the link for every new or subsequently updated row.
alter table public.israa_program_tracking
  drop constraint if exists israa_program_tracking_requires_proposal;

alter table public.israa_program_tracking
  add constraint israa_program_tracking_requires_proposal
  check (proposal_agreement_id is not null) not valid;

comment on constraint israa_program_tracking_requires_proposal on public.israa_program_tracking is
  'Every new or updated Israa tracking row must reference an existing proposal agreement.';
