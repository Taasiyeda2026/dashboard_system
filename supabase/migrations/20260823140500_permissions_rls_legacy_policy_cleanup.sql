-- Follow-up hardening for the explicit permission source-of-truth migration.
-- Legacy permissive RLS policies can OR with the new policies and bypass the
-- explicit permission predicates, so remove them and narrow table grants.

-- proposals_agreements: keep only the explicit permission policies created by
-- 20260823130000_permissions_ui_source_of_truth.sql.
drop policy if exists proposals_agreements_select_view_only_roles on public.proposals_agreements;
drop policy if exists proposals_agreements_insert_admin_operation_only on public.proposals_agreements;
drop policy if exists proposals_agreements_update_admin_operation_only on public.proposals_agreements;
drop policy if exists proposals_agreements_delete_admin_operation_only on public.proposals_agreements;

-- proposal_agreement_items: remove role/column based legacy policies that would
-- otherwise remain permissive alongside app_can_* permission policies.
drop policy if exists proposal_agreement_items_select_by_proposal_flag on public.proposal_agreement_items;
drop policy if exists proposal_agreement_items_select_view_only_roles on public.proposal_agreement_items;
drop policy if exists proposal_agreement_items_insert_admin_operation_only on public.proposal_agreement_items;
drop policy if exists proposal_agreement_items_insert_by_manage_proposal_flag on public.proposal_agreement_items;
drop policy if exists proposal_agreement_items_update_admin_operation_only on public.proposal_agreement_items;
drop policy if exists proposal_agreement_items_update_by_manage_proposal_flag on public.proposal_agreement_items;
drop policy if exists proposal_agreement_items_delete_admin_operation_only on public.proposal_agreement_items;
drop policy if exists proposal_agreement_items_delete_by_manage_proposal_flag on public.proposal_agreement_items;

-- Remove the historical always-true PUBLIC policy from employee-level workshop
-- distribution history. Authenticated access is governed by the restrictive
-- explicit permission boundary installed by the source-of-truth migration.
drop policy if exists workshop_dist_all on public.workshop_stock_distributions;

-- RLS does not protect TRUNCATE and broad historical grants included privileges
-- the application does not need. Reset client grants to normal DML only.
revoke all on table public.proposals_agreements from public, anon, authenticated;
grant select, insert, update, delete on table public.proposals_agreements to authenticated;

revoke all on table public.proposal_agreement_items from public, anon, authenticated;
grant select, insert, update, delete on table public.proposal_agreement_items to authenticated;

revoke all on table public.workshop_stock_distributions from public, anon, authenticated;
grant select, insert, update, delete on table public.workshop_stock_distributions to authenticated;
