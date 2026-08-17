create or replace view public.proposals_agreements_directory_view as
select
  pa.id,
  pa.authority_id,
  a.authority_code,
  pa.school_id,
  pa.contact_school_id,
  coalesce(s.semel_mosad, cs.semel_mosad) as semel_mosad,
  coalesce(a.authority_name, cs.authority, pa.client_authority) as authority_name,
  pa.client_authority as legacy_client_authority,
  cs.client_type as contact_client_type,
  cs.client_name as contact_client_name,
  coalesce(s.school_name, cs.school, pa.school_framework) as school_name,
  pa.school_framework as legacy_school_framework,
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
  pa.updated_at,
  pa.quote_number,
  pa.valid_until,
  pa.combine_gefen_approval,
  pa.gfen_signed_or_ordered,
  coalesce((
    jsonb_typeof(pa.signature_meta) = 'object'
    and coalesce(pa.signature_meta #>> '{signature,image}', pa.signature_meta ->> 'image', '') <> ''
  ), false) as has_approval_signature
from public.proposals_agreements pa
left join public.authorities a on a.id = pa.authority_id
left join public.contacts_schools cs on cs.id = pa.contact_school_id
left join public.schools s on s.id = pa.school_id;

grant select on public.proposals_agreements_directory_view to authenticated;
