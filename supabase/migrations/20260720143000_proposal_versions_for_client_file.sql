-- Proposal version lineage for the unified client-file screen.
-- A proposal created from an earlier proposal becomes the current version and
-- the source remains immutable in the archive.

ALTER TABLE public.proposals_agreements
  ADD COLUMN IF NOT EXISTS proposal_series_id uuid,
  ADD COLUMN IF NOT EXISTS version_number integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS supersedes_proposal_id uuid REFERENCES public.proposals_agreements(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

UPDATE public.proposals_agreements
SET proposal_series_id = id
WHERE proposal_series_id IS NULL;

ALTER TABLE public.proposals_agreements
  ALTER COLUMN proposal_series_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS proposals_agreements_series_version_uidx
  ON public.proposals_agreements (proposal_series_id, version_number);

CREATE INDEX IF NOT EXISTS proposals_agreements_client_file_idx
  ON public.proposals_agreements (authority_id, school_id, archived_at, updated_at DESC);

CREATE OR REPLACE FUNCTION public.prepare_proposal_agreement_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  source_row public.proposals_agreements%ROWTYPE;
BEGIN
  IF NEW.supersedes_proposal_id IS NULL THEN
    NEW.proposal_series_id := COALESCE(NEW.proposal_series_id, NEW.id);
    NEW.version_number := COALESCE(NEW.version_number, 1);
    RETURN NEW;
  END IF;

  SELECT * INTO source_row
  FROM public.proposals_agreements
  WHERE id = NEW.supersedes_proposal_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'superseded proposal was not found';
  END IF;

  NEW.proposal_series_id := COALESCE(source_row.proposal_series_id, source_row.id);
  NEW.version_number := source_row.version_number + 1;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS proposals_agreements_prepare_version ON public.proposals_agreements;
CREATE TRIGGER proposals_agreements_prepare_version
BEFORE INSERT ON public.proposals_agreements
FOR EACH ROW EXECUTE FUNCTION public.prepare_proposal_agreement_version();

CREATE OR REPLACE FUNCTION public.archive_superseded_proposal_agreement()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.supersedes_proposal_id IS NOT NULL THEN
    UPDATE public.proposals_agreements
    SET archived_at = COALESCE(archived_at, now()), updated_at = now()
    WHERE id = NEW.supersedes_proposal_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS proposals_agreements_archive_superseded ON public.proposals_agreements;
CREATE TRIGGER proposals_agreements_archive_superseded
AFTER INSERT ON public.proposals_agreements
FOR EACH ROW EXECUTE FUNCTION public.archive_superseded_proposal_agreement();

COMMENT ON COLUMN public.proposals_agreements.proposal_series_id IS 'Stable lineage identifier shared by proposal versions.';
COMMENT ON COLUMN public.proposals_agreements.version_number IS 'Sequential version number inside a proposal series.';
COMMENT ON COLUMN public.proposals_agreements.supersedes_proposal_id IS 'Previous proposal version preserved in the client-file archive.';
COMMENT ON COLUMN public.proposals_agreements.archived_at IS 'Timestamp when this proposal version stopped being current.';

DROP VIEW IF EXISTS public.proposals_agreements_directory_view CASCADE;

CREATE VIEW public.proposals_agreements_directory_view AS
SELECT
  pa.id,
  pa.authority_id,
  a.authority_code,
  pa.school_id,
  pa.contact_school_id,
  COALESCE(s.semel_mosad, cs.semel_mosad) AS semel_mosad,
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
  pa.proposal_series_id,
  pa.version_number,
  pa.supersedes_proposal_id,
  pa.archived_at,
  pa.created_at,
  pa.updated_at
FROM public.proposals_agreements pa
LEFT JOIN public.authorities a ON a.id = pa.authority_id
LEFT JOIN public.contacts_schools cs ON cs.id = pa.contact_school_id
LEFT JOIN public.schools s ON s.id = pa.school_id;

GRANT SELECT ON public.proposals_agreements_directory_view TO authenticated;
