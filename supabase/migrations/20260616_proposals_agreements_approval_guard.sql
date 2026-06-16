-- Enforce proposal/agreement approval permissions at the database layer.
-- UI checks are not sufficient because the frontend talks directly to Supabase.

alter table public.users
  add column if not exists approve_proposals_agreements boolean;

create or replace function public.app_can_approve_proposals_agreements()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.app_current_role() = 'admin'
    or public.app_has_permission('approve_proposals_agreements'),
    false
  )
$$;

revoke all on function public.app_can_approve_proposals_agreements() from public;
grant execute on function public.app_can_approve_proposals_agreements() to authenticated;

create or replace function public.guard_proposals_agreements_approval_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.app_can_approve_proposals_agreements() and (
    new.status = 'approved'
    or new.approved_by is distinct from old.approved_by
    or new.approved_at is distinct from old.approved_at
    or new.signature_meta is distinct from old.signature_meta
  ) then
    raise exception 'proposals_agreements_approval_forbidden'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_proposals_agreements_approval_update() from public;

drop trigger if exists trg_guard_proposals_agreements_approval_update on public.proposals_agreements;
create trigger trg_guard_proposals_agreements_approval_update
before update on public.proposals_agreements
for each row
execute function public.guard_proposals_agreements_approval_update();
