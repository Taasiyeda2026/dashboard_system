-- Add proposal domain and prevent approved/signature metadata from coexisting with draft status.

ALTER TABLE public.proposals_agreements
  ADD COLUMN IF NOT EXISTS proposal_domain text NOT NULL DEFAULT 'A';

UPDATE public.proposals_agreements
SET proposal_domain = 'A'
WHERE proposal_domain IS NULL OR btrim(proposal_domain) = '' OR proposal_domain NOT IN ('A', 'N');

ALTER TABLE public.proposals_agreements
  DROP CONSTRAINT IF EXISTS proposals_agreements_proposal_domain_check;

ALTER TABLE public.proposals_agreements
  ADD CONSTRAINT proposals_agreements_proposal_domain_check
  CHECK (proposal_domain IN ('A', 'N'));

UPDATE public.proposals_agreements
SET status = 'approved'
WHERE status = 'draft'
  AND (approved_at IS NOT NULL OR (signature_meta IS NOT NULL AND signature_meta::jsonb <> '{}'::jsonb));

ALTER TABLE public.proposals_agreements
  DROP CONSTRAINT IF EXISTS proposals_agreements_draft_without_approval_check;

ALTER TABLE public.proposals_agreements
  ADD CONSTRAINT proposals_agreements_draft_without_approval_check
  CHECK (
    status <> 'draft'
    OR (
      approved_at IS NULL
      AND approved_by IS NULL
      AND (signature_meta IS NULL OR signature_meta::jsonb = '{}'::jsonb)
    )
  );

DROP VIEW IF EXISTS public.proposals_agreements_directory_view CASCADE;

CREATE VIEW public.proposals_agreements_directory_view AS
SELECT
  pa.id,
  pa.authority_id,
  a.authority_code,
  pa.school_id,
  pa.contact_school_id,
  COALESCE(a.authority_name, cs.authority, pa.client_authority) AS authority_name,
  pa.client_authority AS legacy_client_authority,
  cs.client_type AS contact_client_type,
  cs.client_name AS contact_client_name,
  COALESCE(s.school_name, cs.school, pa.school_framework) AS school_name,
  pa.school_framework AS legacy_school_framework,
  pa.document_type,
  pa.activity_type_group,
  pa.proposal_domain,
  pa.proposal_date,
  pa.activity_names,
  pa.contact_name,
  pa.contact_role,
  pa.phone,
  pa.email,
  pa.notes,
  pa.status,
  pa.approval_note,
  pa.total_amount,
  pa.custom_document_sections,
  pa.include_catalog,
  pa.signature_meta,
  pa.approved_by,
  pa.approved_at,
  pa.created_at,
  pa.updated_at
FROM public.proposals_agreements pa
LEFT JOIN public.authorities a ON a.id = pa.authority_id
LEFT JOIN public.contacts_schools cs ON cs.id = pa.contact_school_id
LEFT JOIN public.schools s ON s.id = pa.school_id;

GRANT SELECT ON public.proposals_agreements_directory_view TO authenticated;
