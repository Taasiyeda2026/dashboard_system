-- Persist proposal client identity as a document snapshot.
-- Rollout order: apply this migration first, then deploy the snapshot-writing frontend.
alter table public.proposals_agreements
  add column if not exists client_type text,
  add column if not exists client_name text,
  add column if not exists authority_code bigint,
  add column if not exists semel_mosad bigint;

-- One-time historical backfill. Strongest evidence wins: linked contact, school,
-- authority, then the legacy unlinked "other" shape.
with inferred as (
  select
    pa.id,
    case
      when pa.client_type in ('school', 'authority', 'other') then pa.client_type
      when cs.client_type in ('school', 'authority', 'other') then cs.client_type
      when pa.school_id is not null or s.id is not null then 'school'
      when pa.authority_id is not null or nullif(btrim(pa.client_authority), '') is not null then 'authority'
      else 'other'
    end as inferred_client_type,
    cs.client_name as linked_client_name,
    a.authority_code as linked_authority_code,
    coalesce(s.semel_mosad, cs.semel_mosad) as linked_semel_mosad
  from public.proposals_agreements pa
  left join public.contacts_schools cs on cs.id = pa.contact_school_id
  left join public.schools s on s.id = pa.school_id
  left join public.authorities a on a.id = pa.authority_id
)
update public.proposals_agreements pa
set
  client_type = i.inferred_client_type,
  client_name = coalesce(
    nullif(btrim(pa.client_name), ''),
    nullif(btrim(i.linked_client_name), ''),
    case
      when i.inferred_client_type = 'other' then nullif(btrim(pa.school_framework), '')
      when i.inferred_client_type = 'school' then nullif(btrim(pa.school_framework), '')
      else nullif(btrim(pa.client_authority), '')
    end
  ),
  authority_code = coalesce(pa.authority_code, i.linked_authority_code),
  semel_mosad = case when i.inferred_client_type = 'school'
    then coalesce(pa.semel_mosad, i.linked_semel_mosad)
    else pa.semel_mosad end
from inferred i
where i.id = pa.id;

-- ROLLOUT BRIDGE ONLY: the old frontend does not send snapshot columns. This
-- trigger activates only when client_type is missing. The new frontend always
-- supplies client_type and therefore never uses this compatibility lookup.
-- Remove/harden this trigger after the snapshot-writing frontend is fully rolled out.
create or replace function public.bridge_legacy_proposal_client_snapshot()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  linked_contact public.contacts_schools%rowtype;
  linked_authority_code bigint;
  linked_semel_mosad bigint;
begin
  if new.client_type is not null then return new; end if;

  if new.contact_school_id is not null then
    select * into linked_contact from public.contacts_schools where id = new.contact_school_id;
  end if;

  new.client_type := case
    when linked_contact.client_type in ('school', 'authority', 'other') then linked_contact.client_type
    when new.school_id is not null then 'school'
    when new.authority_id is not null or nullif(btrim(new.client_authority), '') is not null then 'authority'
    else 'other'
  end;
  new.client_name := coalesce(nullif(btrim(new.client_name), ''), nullif(btrim(linked_contact.client_name), ''),
    case when new.client_type in ('school', 'other') then nullif(btrim(new.school_framework), '')
         else nullif(btrim(new.client_authority), '') end);

  if new.authority_id is not null then
    select authority_code into linked_authority_code from public.authorities where id = new.authority_id;
    new.authority_code := coalesce(new.authority_code, linked_authority_code);
  end if;
  if new.client_type = 'school' then
    if new.school_id is not null then
      select semel_mosad into linked_semel_mosad from public.schools where id = new.school_id;
    end if;
    new.semel_mosad := coalesce(new.semel_mosad, linked_semel_mosad, linked_contact.semel_mosad);
  end if;
  return new;
end;
$$;

drop trigger if exists proposals_agreements_legacy_snapshot_bridge on public.proposals_agreements;
create trigger proposals_agreements_legacy_snapshot_bridge
before insert or update on public.proposals_agreements
for each row execute function public.bridge_legacy_proposal_client_snapshot();

alter table public.proposals_agreements
  alter column client_type set not null;
alter table public.proposals_agreements
  drop constraint if exists proposals_agreements_client_type_check;
alter table public.proposals_agreements
  add constraint proposals_agreements_client_type_check
  check (client_type in ('authority', 'school', 'other'));

comment on column public.proposals_agreements.client_type is 'Client type copied when the proposal is saved; document source of truth.';
comment on column public.proposals_agreements.authority_code is 'Authority symbol copied when the proposal is saved; no runtime directory lookup.';
comment on column public.proposals_agreements.semel_mosad is 'School symbol copied when the proposal is saved; no runtime directory lookup.';

-- Keep the existing permission guard and enforce the workflow atomically against
-- the row version PostgreSQL is actually updating (OLD), without a frontend read.
create or replace function public.guard_proposals_agreements_explicit_permissions()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  has_manage boolean := public.app_current_role() = 'admin' or public.app_can_manage_proposals_agreements();
  has_approve boolean := public.app_current_role() = 'admin' or public.app_can_approve_proposals_agreements();
begin
  if not has_manage then
    raise exception 'proposals_agreements_manage_forbidden' using errcode = '42501';
  end if;

  if (new.status = 'approved' and new.status is distinct from old.status)
    or new.approved_by is distinct from old.approved_by
    or new.approved_at is distinct from old.approved_at
    or new.signature_meta is distinct from old.signature_meta then
    if not has_approve then
      raise exception 'proposals_agreements_approval_forbidden' using errcode = '42501';
    end if;
  end if;

  if old.status = 'sent' then
    if new.status is distinct from old.status then
      raise exception 'proposal_status_transition_sent_locked' using errcode = '23514';
    end if;

    -- Post-send operational exception 1: the GEFEN signed/ordered checkbox is
    -- deliberately mutable after sending. No proposal/document identity may ride
    -- along with that update.
    if (to_jsonb(new) - array['updated_at', 'gfen_signed_or_ordered'])
      is not distinct from
      (to_jsonb(old) - array['updated_at', 'gfen_signed_or_ordered']) then
      return new;
    end if;

    -- Post-send operational exception 2: legacy sent rows may receive their one
    -- missing final PDF record. This is the existing historical snapshot backfill,
    -- not a route for rebuilding or editing an already-finalized document.
    if nullif(btrim(old.final_pdf_path), '') is null
      and (old.document_snapshot is not null or nullif(btrim(old.document_html_snapshot), '') is not null)
      and nullif(btrim(new.final_pdf_path), '') is not null
      and (to_jsonb(new) - array[
        'updated_at', 'final_pdf_path', 'final_pdf_file_name',
        'final_pdf_created_at', 'final_pdf_created_by',
        'document_snapshot', 'document_html_snapshot'
      ]) is not distinct from (to_jsonb(old) - array[
        'updated_at', 'final_pdf_path', 'final_pdf_file_name',
        'final_pdf_created_at', 'final_pdf_created_by',
        'document_snapshot', 'document_html_snapshot'
      ]) then
      return new;
    end if;

    raise exception 'proposal_sent_content_locked' using errcode = '23514';
  elsif old.status = 'cancelled' then
    if new.status is distinct from old.status then
      raise exception 'proposal_status_transition_cancelled_locked' using errcode = '23514';
    end if;
    if (to_jsonb(new) - 'updated_at') is not distinct from (to_jsonb(old) - 'updated_at') then
      return new;
    end if;
    raise exception 'proposal_cancelled_content_locked' using errcode = '23514';
  elsif new.status is not distinct from old.status then
    return new;
  elsif new.status = 'approved' then
    if old.status <> 'pending_approval' and not (
      old.status = 'approved' and (
        old.approved_at is null or coalesce(old.signature_meta #>> '{signature,image}', old.signature_meta ->> 'image', '') = ''
      )
    ) then raise exception 'proposal_status_transition_approval_invalid' using errcode = '23514'; end if;
  elsif new.status = 'returned_for_changes' then
    if old.status <> 'pending_approval' then raise exception 'proposal_status_transition_return_invalid' using errcode = '23514'; end if;
  elsif new.status = 'cancelled' then
    if old.status not in ('draft', 'pending_approval', 'returned_for_changes') then raise exception 'proposal_status_transition_cancel_invalid' using errcode = '23514'; end if;
  elsif new.status = 'pending_approval' then
    if old.status not in ('draft', 'returned_for_changes') then raise exception 'proposal_status_transition_pending_invalid' using errcode = '23514'; end if;
  elsif new.status = 'draft' then
    if old.status <> 'returned_for_changes' then raise exception 'proposal_status_transition_draft_invalid' using errcode = '23514'; end if;
  elsif new.status = 'sent' then
    if old.status <> 'approved'
      or old.approved_at is null
      or coalesce(old.signature_meta #>> '{signature,image}', old.signature_meta ->> 'image', '') = ''
      or new.sent_at is null or new.locked_at is null
      or new.document_snapshot is null or nullif(btrim(new.document_html_snapshot), '') is null
    then raise exception 'proposal_status_transition_sent_invalid' using errcode = '23514'; end if;
  else
    raise exception 'invalid_proposal_agreement_status_transition' using errcode = '23514';
  end if;
  return new;
end;
$$;

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

alter view public.proposals_agreements_directory_view set (security_invoker = true);

grant select on public.proposals_agreements_directory_view to authenticated;
