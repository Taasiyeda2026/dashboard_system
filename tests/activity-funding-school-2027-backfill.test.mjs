import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);

test('school_2027 legacy funding backfill only creates safe central associations', async () => {
  const migration = await readFile(
    new URL('supabase/migrations/20260823173000_backfill_school_2027_activity_funding_sources.sql', ROOT),
    'utf8'
  );

  assert.match(migration, /a\.activity_season = 'school_2027'/);
  assert.match(migration, /nullif\(btrim\(a\.funding\), ''\) is not null/);
  assert.match(migration, /not exists \(\s*select 1\s*from public\.activity_funding_sources existing\s*where existing\.activity_id = a\.id/s);
  assert.match(migration, /fs\.is_active\s*and fs\.name = c\.funding/);
  assert.match(migration, /having count\(\*\) = 1/);
  assert.match(migration, /null::numeric/);
  assert.match(migration, /on conflict \(activity_id, funding_source_id\) do nothing/);
  assert.doesNotMatch(migration, /\bupdate\s+public\.activities\b/i);
  assert.doesNotMatch(migration, /^\s*delete\b/im);
});