import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);
const migrationUrl = new URL('supabase/migrations/20260914105000_activity_operational_identity_and_soft_delete.sql', ROOT);
const apiUrl = new URL('frontend/src/api.js', ROOT);
const binderUrl = new URL('frontend/src/screens/shared/bind-activity-edit-form.js', ROOT);

test('proposal linkage remains provenance after creation so operational catalog edits are not reverted', async () => {
  const migration = await readFile(migrationUrl, 'utf8');

  assert.match(migration, /create or replace function public\.enforce_proposal_activity_catalog_identity\(\)/i);
  assert.match(migration, /if tg_op = 'UPDATE'[\s\S]*new\.proposal_item_id is not distinct from old\.proposal_item_id[\s\S]*return new;/i);
  assert.match(migration, /select \*[\s\S]*from public\.proposal_agreement_items[\s\S]*where id = new\.proposal_item_id/i);
  assert.match(migration, /new\.activity_no := v_canonical_no/i, 'creation/re-link must still canonicalize proposal-linked activities');
});

test('activity deletion is soft-delete only and no longer converts deleted status into physical DELETE', async () => {
  const [migration, api, binder] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(apiUrl, 'utf8'),
    readFile(binderUrl, 'utf8')
  ]);

  assert.match(migration, /drop trigger if exists trg_hard_delete_activity_after_deleted_status on public\.activities/i);
  assert.match(migration, /drop function if exists public\.hard_delete_activity_after_deleted_status\(\)/i);
  assert.match(migration, /drop policy if exists activities_delete_admin_operation_only on public\.activities/i);
  assert.match(migration, /revoke delete on table public\.activities from authenticated/i);

  assert.match(api, /deleteActivity:\s*async\s*\(source_row_id\)[\s\S]*\.from\('activities'\)[\s\S]*\.update\(\{ status: DELETED_STATUS \}\)/i);
  assert.match(binder, /הפעילות תוסתר מהמסכים ולא תימחק פיזית מהמערכת/);
});
