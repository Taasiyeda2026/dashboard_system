import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);

test('proposal items create one linked 2027 activity with simple Gefen fields', async () => {
  const [runtime, entry, migration] = await Promise.all([
    readFile(new URL('frontend/src/proposal-activity-linking.js', ROOT), 'utf8'),
    readFile(new URL('frontend/src/main-with-proposal-pdf-hotfix.js', ROOT), 'utf8'),
    readFile(new URL('supabase/migrations/20260727190000_create_activities_from_proposal_items.sql', ROOT), 'utf8')
  ]);

  assert.match(entry, /import '\.\/proposal-activity-linking\.js';/);

  assert.match(runtime, /create_activity_from_proposal_item/);
  assert.match(runtime, /data-create-activity-from-proposal-item/);
  assert.match(runtime, /מימון גפ״ן/);
  assert.match(runtime, /קיים בגפ״ן/);
  assert.match(runtime, /מספר הזמנת גפ״ן/);
  assert.match(runtime, /proposal_linked_documents/);
  assert.match(runtime, /activity_season/);
  assert.doesNotMatch(runtime, /activity_gefen_links/);

  assert.match(migration, /add column if not exists proposal_agreement_id uuid/);
  assert.match(migration, /add column if not exists proposal_item_id uuid/);
  assert.match(migration, /add column if not exists is_gefen_funded boolean/);
  assert.match(migration, /add column if not exists exists_in_gefen boolean/);
  assert.match(migration, /add column if not exists gefen_order_number text/);
  assert.match(migration, /create unique index if not exists activities_proposal_item_id_uidx/);
  assert.match(migration, /activity_season = 'school_2027'/);
  assert.match(migration, /security invoker/i);
  assert.match(migration, /grant execute on function public\.create_activity_from_proposal_item\(uuid\) to authenticated/);
  assert.doesNotMatch(migration, /create table\s+public\.activity_gefen_links/i);
});
