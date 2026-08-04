import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationPath = new URL('../supabase/migrations/20260804120000_normalize_school_2027_activity_districts.sql', import.meta.url);

test('school 2027 district migration is scoped to school_2027 updates only', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /where\s+act\.activity_season\s*=\s*'school_2027'/i);
  assert.match(sql, /if\s+new\.activity_season\s+is\s+distinct\s+from\s+'school_2027'\s+then\s+return\s+new;/i);
  const updateStatements = [...sql.matchAll(/update\s+public\.activities[\s\S]*?;/gi)].map((match) => match[0]);
  assert.ok(updateStatements.length >= 1);
  for (const statement of updateStatements) {
    assert.match(statement, /activity_season\s*=\s*'school_2027'/i);
    assert.doesNotMatch(statement, /activity_season\s*=\s*'(?:2026|summer_2026)'/i);
  }
  assert.doesNotMatch(sql, /create\s+table[\s\S]*backup/i);
});

test('school 2027 district trigger normalizes authorities and clears unresolved districts', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /new\.district\s*:=\s*v_district/i);
  assert.match(sql, /before\s+insert\s+or\s+update\s+of\s+authority_id,\s*authority,\s*activity_season/i);
  assert.match(sql, /public\.normalize_operational_district\(a\.district\)/i);
  assert.doesNotMatch(sql, /authority_district_map/i);
});
