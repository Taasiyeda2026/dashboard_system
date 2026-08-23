import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui = fs.readFileSync(new URL('../frontend/src/israa-proposal-items.js', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260824011500_israa_remove_private_activity_draft.sql', import.meta.url), 'utf8');

test('active Israa proposal table exposes activity selection and selected state', () => {
  assert.match(ui, /activitiesTable\(draft, \{ selectable = true \}/);
  assert.match(ui, /העבר לפעילויות/);
  assert.match(ui, /כבר בפעילויות/);
  assert.match(ui, /save_israa_activity_draft/);
});

test('private draft cards expose removal and return to activities after refresh', () => {
  assert.match(ui, /הסר מהפעילויות שלי/);
  assert.match(ui, /remove_israa_activity_draft/);
  assert.match(ui, /israa_reopen_activities_after_reload/);
});

test('draft removal is permission-gated and cannot remove an already shared activity', () => {
  assert.match(migration, /app_can_manage_israa\(\)/);
  assert.match(migration, /israa_activity_already_shared/);
  assert.match(migration, /where israa_tracking_id = p_tracking_id[\s\S]*israa_source_item_id = p_proposal_item_id/);
  assert.match(migration, /selected_activity_drafts = coalesce/);
  assert.match(migration, /grant execute on function public\.remove_israa_activity_draft\(uuid,uuid\) to authenticated, service_role/);
});
