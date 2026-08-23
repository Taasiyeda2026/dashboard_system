import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../supabase/migrations/20260823140500_permissions_rls_legacy_policy_cleanup.sql', import.meta.url),
  'utf8'
);

test('cleanup removes legacy permissive proposal policies', () => {
  for (const policy of [
    'proposals_agreements_select_view_only_roles',
    'proposals_agreements_insert_admin_operation_only',
    'proposals_agreements_update_admin_operation_only',
    'proposals_agreements_delete_admin_operation_only',
    'proposal_agreement_items_select_by_proposal_flag',
    'proposal_agreement_items_select_view_only_roles',
    'proposal_agreement_items_insert_admin_operation_only',
    'proposal_agreement_items_insert_by_manage_proposal_flag',
    'proposal_agreement_items_update_admin_operation_only',
    'proposal_agreement_items_update_by_manage_proposal_flag',
    'proposal_agreement_items_delete_admin_operation_only',
    'proposal_agreement_items_delete_by_manage_proposal_flag'
  ]) {
    assert.match(migration, new RegExp(`drop policy if exists ${policy}\\b`));
  }
});

test('cleanup removes public workshop bypass and narrows client grants', () => {
  assert.match(migration, /drop policy if exists workshop_dist_all\b/);
  assert.match(migration, /revoke all on table public\.workshop_stock_distributions from public, anon, authenticated;/);
  assert.match(migration, /grant select, insert, update, delete on table public\.workshop_stock_distributions to authenticated;/);
  assert.doesNotMatch(migration, /grant\s+truncate|grant\s+all/i);
});
