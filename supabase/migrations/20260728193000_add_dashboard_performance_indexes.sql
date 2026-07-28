-- Cover foreign keys used by activity and proposal lookups.
-- These indexes do not change data, permissions or application behavior.

create index if not exists activities_school_id_idx
  on public.activities (school_id);

create index if not exists activities_school_contact_id_idx
  on public.activities (school_contact_id);

create index if not exists proposals_agreements_school_id_idx
  on public.proposals_agreements (school_id);

create index if not exists proposals_agreements_supersedes_proposal_id_idx
  on public.proposals_agreements (supersedes_proposal_id);

-- The completion-approval directory is always ordered newest first.
create index if not exists activity_completion_approval_uploads_uploaded_at_idx
  on public.activity_completion_approval_uploads (uploaded_at desc);
