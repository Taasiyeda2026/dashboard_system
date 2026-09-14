import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);
const provenanceMigrationUrl = new URL('supabase/migrations/20260914105000_activity_operational_identity_and_soft_delete.sql', ROOT);
const permanentDeleteMigrationUrl = new URL('supabase/migrations/20260914111000_restore_safe_permanent_activity_delete.sql', ROOT);
const apiUrl = new URL('frontend/src/api.js', ROOT);

test('proposal linkage remains provenance after creation so operational catalog edits are not reverted', async () => {
  const migration = await readFile(provenanceMigrationUrl, 'utf8');

  assert.match(migration, /create or replace function public\.enforce_proposal_activity_catalog_identity\(\)/i);
  assert.match(migration, /if tg_op = 'UPDATE'[\s\S]*new\.proposal_item_id is not distinct from old\.proposal_item_id[\s\S]*return new;/i);
  assert.match(migration, /select \*[\s\S]*from public\.proposal_agreement_items[\s\S]*where id = new\.proposal_item_id/i);
  assert.match(migration, /new\.activity_no := v_canonical_no/i, 'creation/re-link must still canonicalize proposal-linked activities');
});

test('authorized activity deletion is permanent but blocked when operational records already exist', async () => {
  const [migration, api] = await Promise.all([
    readFile(permanentDeleteMigrationUrl, 'utf8'),
    readFile(apiUrl, 'utf8')
  ]);

  assert.match(migration, /create or replace function public\.hard_delete_activity_after_deleted_status\(\)/i);
  assert.match(migration, /security definer/i);
  assert.match(migration, /app_can_delete_activity\(\)/i);
  assert.match(migration, /attendance_records/i);
  assert.match(migration, /activity_completion_approval_uploads/i);
  assert.match(migration, /activity_coordination_dispatch_items/i);
  assert.match(migration, /finance_collection_tracking/i);
  assert.match(migration, /finance_transaction_account_lines/i);
  assert.match(migration, /finance_transaction_account_meetings/i);
  assert.match(migration, /activity_meetings/i);
  assert.match(migration, /course_meeting_cancellations/i);
  assert.match(migration, /course_meeting_instructor_history/i);
  assert.match(migration, /delete from public\.activities[\s\S]*where id = new\.id[\s\S]*row_id = new\.row_id/i);
  assert.match(migration, /create trigger trg_hard_delete_activity_after_deleted_status[\s\S]*after update of status/i);
  assert.match(migration, /revoke delete on table public\.activities from authenticated/i, 'direct client DELETE must stay closed');
  assert.doesNotMatch(migration, /delete from public\.attendance_records/i, 'operational evidence must never be silently deleted');
  assert.doesNotMatch(migration, /delete from public\.finance_transaction_account_/i, 'finance evidence must never be silently deleted');

  // The client keeps using the existing authorized delete signal. The database
  // trigger converts only an eligible draft/unfinalized activity into a hard delete.
  assert.match(api, /deleteActivity:\s*async\s*\(source_row_id\)[\s\S]*\.from\('activities'\)[\s\S]*\.update\(\{ status: DELETED_STATUS \}\)/i);
});
