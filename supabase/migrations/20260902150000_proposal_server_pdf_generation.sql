-- Observable, retryable state for asynchronous Chromium proposal PDFs.
alter table public.proposals_agreements
  add column if not exists final_pdf_generation_status text not null default 'idle',
  add column if not exists final_pdf_generation_error text,
  add column if not exists final_pdf_generation_attempts integer not null default 0;

alter table public.proposals_agreements
  drop constraint if exists proposals_agreements_final_pdf_generation_status_check;
alter table public.proposals_agreements
  add constraint proposals_agreements_final_pdf_generation_status_check
  check (final_pdf_generation_status in ('idle', 'queued', 'generating', 'completed', 'failed'));

comment on column public.proposals_agreements.final_pdf_generation_status is
  'Server-side Chromium PDF job state; approval remains valid when generation fails.';

grant select, update on table public.proposals_agreements to service_role;

-- The PDF worker uses the service-role key. RLS is bypassed for that role, but the
-- existing explicit-permissions trigger must also recognize it.
create or replace function public.guard_proposals_agreements_explicit_permissions()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  has_manage boolean := public.app_current_role() = 'admin' or public.app_can_manage_proposals_agreements();
  has_approve boolean := public.app_current_role() = 'admin' or public.app_can_approve_proposals_agreements();
begin
  if coalesce(auth.role(), '') = 'service_role' then return new; end if;

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
