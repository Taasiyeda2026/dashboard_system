import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('../supabase/migrations/20260823193000_israa_private_activity_flow.sql', import.meta.url), 'utf8');
const screen = fs.readFileSync(new URL('../frontend/src/screens/israa-management.js', import.meta.url), 'utf8');

test('Israa sharing is idempotent per tracking item and group and creates domain E rows', () => {
  assert.match(migration, /unique index[\s\S]*israa_tracking_id, israa_source_item_id, israa_group_number/i);
  assert.match(migration, /for v_group in 1\.\.v_quantity loop/i);
  assert.match(migration, /activity_season, activity_domain[\s\S]*'school_2027', 'E'/i);
  assert.match(migration, /on conflict \(israa_tracking_id, israa_source_item_id, israa_group_number\)/i);
});

test('Israa direct edit RPC is restricted to provenance-marked domain E activities', () => {
  assert.match(migration, /where row_id = p_row_id and activity_domain = 'E' and israa_tracking_id is not null/i);
  assert.match(migration, /if not public\.app_can_manage_israa\(\)/i);
  assert.doesNotMatch(migration, /can_edit_direct\s*=/i);
});

test('Israa permission uses the canonical permission helpers without a pinned employee id', () => {
  assert.match(migration, /public\.app_current_role\(\) = 'admin'/);
  assert.match(migration, /public\.app_has_permission\('view_israa_management'\)/);
  assert.doesNotMatch(migration, /3030/);
});

test('sharing projects the operational proposal and tracking fields into activities', () => {
  for (const field of ['authority_id', 'school_id', 'contact_name', 'contact_phone', 'contact_email', 'activity_no', 'gefen_number', 'sessions', 'price', 'funding']) {
    assert.match(migration, new RegExp(`\\b${field}\\b`));
  }
});

test('Israa activity editing reuses the shared activity drawer and binder', () => {
  assert.match(screen, /activityWorkDrawerHtml\(row/);
  assert.match(screen, /bindActivityEditForm\(mgmt/);
  assert.doesNotMatch(screen, /function activityFields\(/);
});

test('draft type comes from the proposal item and is normalized without a course fallback', () => {
  assert.match(migration, /normalize_israa_activity_type\(coalesce\(nullif\(p_draft->>'activity_type', ''\), v_item->>'item_type'\)\)/);
  assert.doesNotMatch(migration, /'activity_type', coalesce\([^\n]+, 'course'\)/);
});

test('share revalidates the current tracking snapshot and protects provenance writes', () => {
  assert.match(migration, /jsonb_array_elements\(coalesce\(v_tracking\.proposal_items/);
  assert.match(migration, /security invoker[\s\S]*israa_provenance_write_forbidden/i);
  assert.match(migration, /pai\.proposal_agreement_id = t\.proposal_agreement_id/);
});

test('typed activity fields use explicit PostgreSQL casts', () => {
  for (const cast of ["::bigint", "::date", "::time"]) assert.match(migration, new RegExp(cast));
});

test('existing Y proposal guard remains and only permits a validated Israa source exception', () => {
  assert.match(migration, /if new\.israa_tracking_id is not null or new\.israa_source_item_id is not null/i);
  assert.match(migration, /if coalesce\(v_domain,''\) <> 'Y' then raise exception 'proposal_domain_not_routed_to_activities'/i);
});
