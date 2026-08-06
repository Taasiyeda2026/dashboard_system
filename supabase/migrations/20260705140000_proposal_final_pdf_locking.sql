-- Lock sent proposals with a final PDF and immutable document snapshot.
-- No backfill: legacy sent rows without final_pdf_path stay legacy until manual upload.

ALTER TABLE public.proposals_agreements
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by text,
  ADD COLUMN IF NOT EXISTS locked_reason text,
  ADD COLUMN IF NOT EXISTS final_pdf_path text,
  ADD COLUMN IF NOT EXISTS final_pdf_file_name text,
  ADD COLUMN IF NOT EXISTS final_pdf_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS final_pdf_created_by text,
  ADD COLUMN IF NOT EXISTS document_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS document_html_snapshot text;

COMMENT ON COLUMN public.proposals_agreements.locked_at IS 'Timestamp when the proposal document was locked (typically on send).';
COMMENT ON COLUMN public.proposals_agreements.locked_by IS 'User display name who locked the proposal.';
COMMENT ON COLUMN public.proposals_agreements.locked_reason IS 'Why the proposal was locked, e.g. sent.';
COMMENT ON COLUMN public.proposals_agreements.final_pdf_path IS 'Storage path in proposal-final-pdfs bucket.';
COMMENT ON COLUMN public.proposals_agreements.document_snapshot IS 'Immutable JSON snapshot of proposal data at lock time.';
COMMENT ON COLUMN public.proposals_agreements.document_html_snapshot IS 'Immutable rendered HTML at lock time.';

-- Private bucket for final sent proposal PDFs.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'proposal-final-pdfs',
  'proposal-final-pdfs',
  false,
  52428800,
  ARRAY['application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  public = false,
  file_size_limit = 52428800,
  allowed_mime_types = ARRAY['application/pdf']::text[];

-- Authorized proposal users may read final PDFs.
DROP POLICY IF EXISTS "proposal_final_pdfs_storage_select" ON storage.objects;
CREATE POLICY "proposal_final_pdfs_storage_select" ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'proposal-final-pdfs'
    AND public.app_can_use_proposals_agreements()
  );

-- Authorized proposal users may upload final PDFs (no delete via UI policies).
DROP POLICY IF EXISTS "proposal_final_pdfs_storage_insert" ON storage.objects;
CREATE POLICY "proposal_final_pdfs_storage_insert" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'proposal-final-pdfs'
    AND public.app_can_use_proposals_agreements()
  );

-- Recreate directory view with lock / PDF columns for list reads.
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
  pa.sent_by,
  pa.sent_at,
  pa.locked_at,
  pa.locked_by,
  pa.locked_reason,
  pa.final_pdf_path,
  pa.final_pdf_file_name,
  pa.final_pdf_created_at,
  pa.final_pdf_created_by,
  pa.document_snapshot,
  pa.document_html_snapshot,
  pa.created_at,
  pa.updated_at
FROM public.proposals_agreements pa
LEFT JOIN public.authorities a ON a.id = pa.authority_id
LEFT JOIN public.contacts_schools cs ON cs.id = pa.contact_school_id
LEFT JOIN public.schools s ON s.id = pa.school_id;

GRANT SELECT ON public.proposals_agreements_directory_view TO authenticated;
