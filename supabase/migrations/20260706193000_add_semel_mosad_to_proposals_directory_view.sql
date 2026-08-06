-- Add semel_mosad to proposals_agreements_directory_view
-- Fixes: column proposals_agreements_directory_view.semel_mosad does not exist
-- Note: proposals_agreements does NOT have semel_mosad.
-- Source of truth for semel_mosad is schools / contacts_schools.

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
  pa.created_at,
  pa.updated_at
FROM public.proposals_agreements pa
LEFT JOIN public.authorities a ON a.id = pa.authority_id
LEFT JOIN public.contacts_schools cs ON cs.id = pa.contact_school_id
LEFT JOIN public.schools s ON s.id = pa.school_id;

GRANT SELECT ON public.proposals_agreements_directory_view TO authenticated;
