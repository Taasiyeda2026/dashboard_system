import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('../supabase/migrations/20260823193000_israa_private_activity_flow.sql', import.meta.url), 'utf8');

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

test('existing Y proposal guard remains and only permits a validated Israa source exception', () => {
  assert.match(migration, /if new\.israa_tracking_id is not null then/i);
  assert.match(migration, /if coalesce\(v_domain,''\) <> 'Y' then raise exception 'proposal_domain_not_routed_to_activities'/i);
});
