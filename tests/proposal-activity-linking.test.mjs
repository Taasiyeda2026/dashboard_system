import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);

test('proposal quantity creates one linked 2027 activity per group using catalog fields', async () => {
  const [runtime, featureLoaders, initialMigration, fixMigration] = await Promise.all([
    readFile(new URL('frontend/src/proposal-activity-linking.js', ROOT), 'utf8'),
    readFile(new URL('frontend/src/feature-loaders.js', ROOT), 'utf8'),
    readFile(new URL('supabase/migrations/20260727190000_create_activities_from_proposal_items.sql', ROOT), 'utf8'),
    readFile(new URL('supabase/migrations/20260727203000_fix_proposal_activity_quantity_and_catalog.sql', ROOT), 'utf8')
  ]);

  assert.match(featureLoaders, /import\('\.\/proposal-activity-linking\.js'\)/);

  assert.match(runtime, /create_activity_from_proposal_item/);
  assert.match(runtime, /data-create-activity-from-proposal-item/);
  assert.match(runtime, /quotedActivityCount/);
  assert.match(runtime, /created_count/);
  assert.match(runtime, /מתוך \$\{requiredCount\} פעילויות נוצרו/);
  assert.doesNotMatch(runtime, /data-activity-gefen-column/);
  assert.doesNotMatch(runtime, /מימון גפ״ן/);
  assert.doesNotMatch(runtime, /קיים בגפ״ן/);
  assert.doesNotMatch(runtime, /מספר הזמנת גפ״ן/);
  assert.doesNotMatch(runtime, /enhanceActivityTable/);
  assert.doesNotMatch(runtime, /renderActivityGefenCell/);
  assert.match(runtime, /proposal_item_sequence/);
  assert.doesNotMatch(runtime, /proposal_linked_documents/);
  assert.doesNotMatch(runtime, /אישור גפ״ן קיים/);
  assert.doesNotMatch(runtime, /activity_gefen_links/);

  assert.match(initialMigration, /add column if not exists proposal_agreement_id uuid/);
  assert.match(initialMigration, /add column if not exists proposal_item_id uuid/);
  assert.match(initialMigration, /add column if not exists is_gefen_funded boolean/);
  assert.match(initialMigration, /add column if not exists exists_in_gefen boolean/);
  assert.match(initialMigration, /add column if not exists gefen_order_number text/);

  assert.match(fixMigration, /add column if not exists proposal_item_sequence integer/);
  assert.match(fixMigration, /drop index if exists public\.activities_proposal_item_id_uidx/);
  assert.match(fixMigration, /activities_proposal_item_sequence_uidx/);
  assert.match(fixMigration, /proposal_item_required_activity_count/);
  assert.match(fixMigration, /generate_series\(2, s\.required_count\)/);
  assert.match(fixMigration, /when v_item\.unit_price is not null then round\(v_item\.unit_price\)::bigint/);
  assert.match(fixMigration, /l\.category = 'activity_names'/);
  assert.match(fixMigration, /v_activity_type := 'course'/);
  assert.match(fixMigration, /v_activity_family := 'program'/);
  assert.match(fixMigration, /v_short_name := coalesce\(v_catalog_name/);
  assert.match(fixMigration, /activity_season = 'school_2027'/);
  assert.match(fixMigration, /security invoker/i);
  assert.match(fixMigration, /grant execute on function public\.create_activity_from_proposal_item\(uuid\) to authenticated/);
  assert.doesNotMatch(fixMigration, /create table\s+public\.activity_gefen_links/i);
});
