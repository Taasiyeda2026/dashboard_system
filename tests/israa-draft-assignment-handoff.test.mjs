import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20260917211500_israa_draft_assignment_handoff.sql', import.meta.url),
  'utf8'
);

test('Israa private draft persists the selected instructor identity', () => {
  assert.match(migration, /'emp_id',\s*v_instructor_emp_id/);
  assert.match(migration, /'instructor_name',\s*v_instructor_name/);
  assert.match(migration, /contacts_instructors[\s\S]*active/);
});

test('publishing Israa activity creates a scheduling draft rather than an official assignment', () => {
  assert.match(migration, /draft_emp_id,\s*draft_instructor_name,\s*draft_created_at,\s*draft_created_by/);
  assert.match(migration, /v_draft_emp_id,\s*v_draft_instructor_name/);
  assert.doesNotMatch(migration, /insert into public\.activities\s*\([\s\S]{0,900}\bemp_id\s*,\s*instructor_name\b/);
});

test('re-sharing only refreshes the draft while there is no approved instructor', () => {
  assert.match(migration, /when public\.activities\.emp_id is null then excluded\.draft_emp_id/);
  assert.match(migration, /when public\.activities\.emp_id is null then excluded\.draft_instructor_name/);
});
