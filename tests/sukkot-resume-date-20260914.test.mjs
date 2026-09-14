import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('../supabase/migrations/20260914225500_fix_sukkot_resume_date.sql', import.meta.url), 'utf8');

test('Sukkot 2026 ends on October 3 and school resumes October 4', () => {
  assert.match(migration, /external_key\s*=\s*'GEN-SUKKOT'/);
  assert.match(migration, /end_date\s*=\s*date\s*'2026-10-03'/);
  assert.match(migration, /resume_date\s*=\s*date\s*'2026-10-04'/);
  assert.doesNotMatch(migration, /resume_date\s*=\s*date\s*'2026-10-05'/);
});
