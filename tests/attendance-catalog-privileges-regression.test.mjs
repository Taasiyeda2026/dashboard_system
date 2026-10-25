import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const instructorMigration = readFileSync(
  new URL('../supabase/migrations/20261025231914_secure_attendance_authority_and_canonical_search_20261026.sql', import.meta.url),
  'utf8',
);
const helperMigration = readFileSync(
  new URL('../supabase/migrations/20261025232053_restrict_attendance_catalog_helpers_to_signed_in_20261026.sql', import.meta.url),
  'utf8',
);
const instructorService = readFileSync(
  new URL('../attendance/src/services/activities.service.js', import.meta.url),
  'utf8',
);

test('instructor-school lookup is scoped to the signed-in instructor', () => {
  assert.match(instructorMigration, /u\.auth_user_id = auth\.uid\(\)/);
  assert.match(instructorMigration, /u\.is_active = true/);
  assert.match(instructorMigration, /v_current_emp_id <> p_emp_id/);
  assert.match(instructorMigration, /RETURN ''\[\]''::jsonb/);
  assert.match(instructorService, /rpc\('av2_get_authority_school_list'/);
});

test('attendance search requires an active signed-in application user', () => {
  assert.match(instructorMigration, /EXISTS \(SELECT 1 FROM public\.users u WHERE u\.auth_user_id = auth\.uid\(\) AND u\.is_active = true\)/);
  assert.match(instructorMigration, /REVOKE EXECUTE ON FUNCTION public\.av2_search_canonical_activities/);
  assert.match(instructorMigration, /TO authenticated, service_role/);
});

test('all four attendance catalogs reject anonymous direct RPC execution', () => {
  assert.match(instructorMigration, /REVOKE EXECUTE ON FUNCTION public\.av2_get_authority_school_list/);
  assert.match(helperMigration, /REVOKE EXECUTE ON FUNCTION public\.av2_get_all_authority_school_list/);
  assert.match(helperMigration, /REVOKE EXECUTE ON FUNCTION public\.av2_get_distinct_activity_types/);
  assert.match(instructorService, /rpc\('av2_get_all_authority_school_list'/);
  assert.doesNotMatch(helperMigration, /premium_questionnaire_create_class/);
});
