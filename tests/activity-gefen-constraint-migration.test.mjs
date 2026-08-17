import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('exists_in_gefen migration removes only the legacy funding dependency', async () => {
  const sql = await readFile(
    new URL('../supabase/migrations/20260815120000_decouple_exists_in_gefen_from_funding.sql', import.meta.url),
    'utf8'
  );

  assert.match(sql, /alter table public\.activities[\s\S]*drop constraint if exists activities_gefen_exists_requires_funding/i);
  assert.doesNotMatch(sql, /drop\s+column|delete\s+from|update\s+public\.activities|truncate/i);
  assert.doesNotMatch(sql, /is_gefen_funded\s*=|exists_in_gefen\s*=/i);
});
