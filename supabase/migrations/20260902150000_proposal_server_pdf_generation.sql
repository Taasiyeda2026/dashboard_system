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
begin
  if coalesce(auth.role(), '') = 'service_role' then return new; end if;
  if public.app_current_role() = 'admin' then return new; end if;
  if public.app_can_manage_proposals_agreements() then
    if (new.status = 'approved' and new.status is distinct from old.status)
      or new.approved_by is distinct from old.approved_by
      or new.approved_at is distinct from old.approved_at
      or new.signature_meta is distinct from old.signature_meta then
      if not public.app_can_approve_proposals_agreements() then
        raise exception 'proposals_agreements_approval_forbidden' using errcode = '42501';
      end if;
    end if;
    return new;
  end if;
  raise exception 'proposals_agreements_manage_forbidden' using errcode = '42501';
end;
$$;
