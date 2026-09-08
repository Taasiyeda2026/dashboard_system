-- Proposal managers can create a school contact while composing a proposal.
-- Keep contact update/delete restricted to the existing contact-manager roles;
-- this policy restores only the insert capability used by the proposal flow.

drop policy if exists contacts_schools_insert_managers
on public.contacts_schools;

create policy contacts_schools_insert_managers
on public.contacts_schools
for insert
to authenticated
with check (
  public.app_is_admin_or_operation_manager()
  or public.app_can_manage_proposals_agreements()
);

