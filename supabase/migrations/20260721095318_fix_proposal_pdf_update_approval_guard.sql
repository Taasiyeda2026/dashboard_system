-- Allow users who can manage proposals to save final PDF metadata on an
-- already-approved proposal, without granting them approval permission.
--
-- Previously, any UPDATE of a row whose status was already 'approved' was
-- treated as a new approval action. This blocked updates to final_pdf_* and
-- document snapshot fields for non-approvers after the PDF was uploaded.

create or replace function public.guard_proposals_agreements_approval_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.app_can_approve_proposals_agreements() and (
    (
      new.status = 'approved'
      and new.status is distinct from old.status
    )
    or new.approved_by is distinct from old.approved_by
    or new.approved_at is distinct from old.approved_at
    or new.signature_meta is distinct from old.signature_meta
  ) then
    raise exception 'proposals_agreements_approval_forbidden'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

comment on function public.guard_proposals_agreements_approval_update() is
'Allows ordinary updates to already-approved proposals, including final PDF metadata, while still restricting transitions to approved and changes to approval/signature fields.';
