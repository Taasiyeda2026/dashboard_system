-- Persist proposal client identity as an immutable document snapshot.
alter table public.proposals_agreements
  add column if not exists client_type text,
  add column if not exists client_name text,
  add column if not exists authority_code bigint,
  add column if not exists semel_mosad bigint;

-- One-time enrichment for historical proposals only. Runtime proposal/document flows
-- must use the copied values and must not repeat these directory lookups.
update public.proposals_agreements pa
set
  client_type = coalesce(
    nullif(btrim(pa.client_type), ''),
    nullif(btrim((select cs.client_type from public.contacts_schools cs where cs.id = pa.contact_school_id)), ''),
    case when pa.school_id is not null then 'school' else 'authority' end
  ),
  client_name = coalesce(
    nullif(btrim(pa.client_name), ''),
    nullif(btrim((select cs.client_name from public.contacts_schools cs where cs.id = pa.contact_school_id)), ''),
    case when pa.school_id is not null then nullif(btrim(pa.school_framework), '')
         else nullif(btrim(pa.client_authority), '') end
  ),
  authority_code = coalesce(pa.authority_code,
    (select a.authority_code from public.authorities a where a.id = pa.authority_id)),
  semel_mosad = case
    when coalesce(nullif(btrim(pa.client_type), ''),
                  nullif(btrim((select cs.client_type from public.contacts_schools cs where cs.id = pa.contact_school_id)), ''),
                  case when pa.school_id is not null then 'school' else 'authority' end) = 'school'
      then coalesce(pa.semel_mosad,
        (select s.semel_mosad from public.schools s where s.id = pa.school_id),
        (select cs.semel_mosad from public.contacts_schools cs where cs.id = pa.contact_school_id))
    else pa.semel_mosad
  end
;

-- Cover legacy rows without a resolvable authority relation.
update public.proposals_agreements pa
set
  client_type = coalesce(nullif(btrim(pa.client_type), ''),
    case when pa.school_id is not null then 'school' else 'authority' end),
  client_name = coalesce(nullif(btrim(pa.client_name), ''),
    case when pa.school_id is not null then nullif(btrim(pa.school_framework), '')
         else nullif(btrim(pa.client_authority), '') end)
where pa.client_type is null or btrim(pa.client_type) = '' or pa.client_name is null;

alter table public.proposals_agreements
  alter column client_type set default 'authority',
  alter column client_type set not null;

alter table public.proposals_agreements
  drop constraint if exists proposals_agreements_client_type_check;
alter table public.proposals_agreements
  add constraint proposals_agreements_client_type_check
  check (client_type in ('authority', 'school', 'other'));

comment on column public.proposals_agreements.client_type is 'Client type copied when the proposal is saved; document source of truth.';
comment on column public.proposals_agreements.authority_code is 'Authority symbol copied when the proposal is saved; no runtime directory lookup.';
comment on column public.proposals_agreements.semel_mosad is 'School symbol copied when the proposal is saved; no runtime directory lookup.';

create or replace view public.proposals_agreements_directory_view as
select
  pa.id,
  pa.authority_id,
  pa.authority_code,
  pa.school_id,
  pa.contact_school_id,
  pa.semel_mosad,
  pa.client_authority as authority_name,
  pa.client_authority as legacy_client_authority,
  pa.client_type as contact_client_type,
  pa.client_name as contact_client_name,
  pa.school_framework as school_name,
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
from public.proposals_agreements pa;

grant select on public.proposals_agreements_directory_view to authenticated;
