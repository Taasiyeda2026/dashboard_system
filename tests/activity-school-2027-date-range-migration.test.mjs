import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const migration = await fs.readFile(
  new URL('../supabase/migrations/20260914124500_guard_school_2027_activity_dates_and_catalog_labels.sql', import.meta.url),
  'utf8'
);

test('school_2027 date guard rejects every persisted activity date outside the active school year', () => {
  assert.match(migration, /guard_school_2027_activity_date_range/i);
  assert.match(migration, /date '2026-09-01'/i);
  assert.match(migration, /date '2027-08-31'/i);
  assert.match(migration, /new\.start_date/);
  assert.match(migration, /new\.end_date/);
  for (let index = 1; index <= 35; index += 1) {
    assert.match(migration, new RegExp(`new\\.date_${index}(?:[,\\n])`));
  }
  assert.match(migration, /school_2027_date_out_of_range/);
});

test('activity picker labels are aligned to the operational Gefen short name used on save', () => {
  assert.match(migration, /update public\.lists l/i);
  assert.match(migration, /from public\.proposal_gefen_courses p/i);
  assert.match(migration, /l\.category = 'activity_names'/i);
  assert.match(migration, /activity_name = trim\(p\.short_name\)/i);
  assert.match(migration, /label = trim\(p\.short_name\)/i);
  assert.match(migration, /label_he = trim\(p\.short_name\)/i);
});
