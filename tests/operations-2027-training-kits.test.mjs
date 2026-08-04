import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const featurePath = new URL('../frontend/src/screens/operations-summer-training-matrix.js', import.meta.url);
const cleanupPath = new URL('../frontend/src/screens/operations-authorities-cleanup.js', import.meta.url);
const migrationPath = new URL('../supabase/migrations/20260804221500_operations_2027_training_and_print_kits.sql', import.meta.url);

const [featureSource, cleanupSource, migrationSource] = await Promise.all([
  readFile(featurePath, 'utf8'),
  readFile(cleanupPath, 'utf8'),
  readFile(migrationPath, 'utf8')
]);

test('2027 operations tabs and labels are present', () => {
  assert.match(featureSource, /הכשרות סדנאות/);
  assert.match(featureSource, /הכשרות קורסים/);
  assert.match(featureSource, /ערכות דפוס/);
  assert.match(featureSource, /מלאי סדנאות/);
  assert.match(featureSource, /\['authorities', 'completion_approval'\]/);
  assert.match(cleanupSource, /מלאי סדנאות/);
  assert.match(cleanupSource, /data-ops-custom-tab/);
});

test('course matrices are derived only from assigned 2027 activities', () => {
  assert.match(featureSource, /\.eq\('activity_season', SCHOOL_2027\)/);
  assert.match(featureSource, /\.eq\('activity_type', 'course'\)/);
  assert.match(featureSource, /if \(!base\.assignments\.has\(key\)\) return ''/);
  assert.match(featureSource, /relevantInstructors = base\.instructors\.filter/);
});

test('print kit inventory uses compact tables and atomic RPC operations', () => {
  assert.match(featureSource, /width: fit-content/);
  assert.match(featureSource, /width: max-content !important/);
  assert.match(featureSource, /set_course_print_kit_requirement/);
  assert.match(featureSource, /set_course_print_kit_stock/);
  assert.match(featureSource, /deliver_course_print_kit/);
  assert.match(featureSource, /return_course_print_kit/);
  assert.match(featureSource, /אין מלאי/);
});

test('database migration protects stock and distribution writes', () => {
  assert.match(migrationSource, /check \(warehouse_quantity >= 0\)/);
  assert.match(migrationSource, /unique \(course_id, instructor_name\)/i);
  assert.match(migrationSource, /for update;/i);
  assert.match(migrationSource, /security definer/gi);
  assert.match(migrationSource, /set search_path = public/gi);
  assert.match(migrationSource, /app_is_admin_or_operation_manager/);
  assert.match(migrationSource, /grant execute .* to authenticated/gi);
});
