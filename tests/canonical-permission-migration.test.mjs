import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(new URL('../supabase/migrations/20260823150000_canonical_permission_hierarchy.sql', import.meta.url), 'utf8');

test('permission migration records audits before any user backfill', () => {
  const audit = sql.indexOf("insert into public.permission_migration_audit");
  const firstUpdate = sql.indexOf('update public.users');
  assert.ok(audit >= 0 && firstUpdate > audit);
  for (const finding of [
    'create_activity_granted_only_by_request_edit',
    'can_review_requests_column_conflict',
    'legacy_proposals_alias_only'
  ]) assert.match(sql, new RegExp(finding));
});

test('permission migration backfills create requests and canonicalizes review without proposal alias promotion', () => {
  assert.match(sql, /jsonb_build_object\('can_request_create_activity', 'yes'\)/);
  assert.match(sql, /'can_review_requests'.*can_review_requests_2/s);
  assert.match(sql, /set can_review_requests = lower\(coalesce\(permissions->>'can_review_requests'/);
  assert.doesNotMatch(sql, /'view_proposals_agreements'\s*,\s*permissions->>'view_proposals'/);
});

test('database permission helper enforces parents and retains only supported aliases', () => {
  for (const key of ['view_activities', 'view_instructors', 'view_operations_management', 'view_workshop_stock', 'view_catalog', 'finance_access']) {
    assert.match(sql, new RegExp(key));
  }
  for (const alias of ['can_request_edit_2', 'can_review_requests_2', 'view_inventory', 'view_finance']) {
    assert.match(sql, new RegExp(alias));
  }
  assert.doesNotMatch(sql, /coalesce\(permissions->>flag, permissions->>'view_proposals'\)/);
});
