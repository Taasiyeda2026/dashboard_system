import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const featurePath = new URL('../frontend/src/screens/operations-summer-training-matrix.js', import.meta.url);
const cleanupPath = new URL('../frontend/src/screens/operations-authorities-cleanup.js', import.meta.url);
const managementPath = new URL('../frontend/src/screens/operations-management.js', import.meta.url);
const configPath = new URL('../frontend/src/config.js', import.meta.url);
const swPath = new URL('../frontend/sw.js', import.meta.url);
const migrationPath = new URL('../supabase/migrations/20260804221500_operations_2027_training_and_print_kits.sql', import.meta.url);

const [featureSource, cleanupSource, managementSource, configSource, swSource, migrationSource] = await Promise.all([
  readFile(featurePath, 'utf8'),
  readFile(cleanupPath, 'utf8'),
  readFile(managementPath, 'utf8'),
  readFile(configPath, 'utf8'),
  readFile(swPath, 'utf8'),
  readFile(migrationPath, 'utf8')
]);

test('2027 operations hides only period, authorities and completion tabs while preserving 2026 path', () => {
  assert.match(featureSource, /field\.hidden = in2027/);
  assert.match(featureSource, /button\.hidden = in2027/);
  assert.match(featureSource, /\['authorities', 'completion_approval'\]/);
  assert.match(featureSource, /if \(!is2027\(root\) && customTab\)/);
  assert.match(cleanupSource, /data-ops-custom-tab/);
});

test('new 2027 tabs use the existing operations tab class and labels', () => {
  assert.match(featureSource, /button\.className = 'ds-ops-mgmt-tab'/);
  assert.match(featureSource, /הכשרות סדנאות/);
  assert.match(featureSource, /הכשרות קורסים/);
  assert.match(featureSource, /ערכות דפוס/);
  assert.doesNotMatch(featureSource, /className = 'ds-btn/);
});

test('2027 workshop inventory remains the native workshops inventory backed by 2026 source data and location rows', () => {
  assert.match(featureSource, /const workshopTab = root\.querySelector\('\[data-ops-tab="workshops"\]'\)/);
  assert.match(managementSource, /api\.adminLists\(\)/);
  assert.match(managementSource, /api\.workshopStockDistributions/);
  assert.match(managementSource, /workshopMetricsRows\(activitiesRowsForRequiredInventory, stockMap, catalogRows, workshopStockDistributions/);
  assert.match(managementSource, /stockLocationSummaryRows/);
  assert.match(managementSource, /סיכום מיקום מלאי/);
});

test('print kit inventory shows only requires_print_kit courses and no kit yes-no column', () => {
  assert.match(featureSource, /const requiredCourses = base\.courses\.filter\(\(course\) => course\.requires_print_kit === true\)/);
  assert.match(featureSource, /requiredCourses\.map\(\(course\)/);
  assert.doesNotMatch(featureSource, /data-kit-required-toggle/);
  assert.doesNotMatch(featureSource, /set_course_print_kit_requirement/);
  assert.doesNotMatch(featureSource, /<th class="ops2027-toggle-col">ערכות<\/th>/);
});

test('print kit quantity editing is exposed only to admin and operation_manager', () => {
  assert.match(featureSource, /function currentStoredUser\(\)/);
  assert.match(featureSource, /function canEditOperationsQuantities\(\)/);
  assert.match(featureSource, /roles\.includes\('admin'\) \|\| roles\.includes\('operation_manager'\)/);
  assert.match(featureSource, /editable\s*\? `<input type="number"/);
  assert.match(featureSource, /: `<span class="ops2027-stock-text">/);
  assert.match(managementSource, /function canEditOperationsInventory\(state = \{\}\)/);
  assert.match(managementSource, /roles\.includes\('admin'\) \|\| roles\.includes\('operation_manager'\)/);
});

test('tables and empty states are compact and RTL aligned', () => {
  assert.match(featureSource, /width: fit-content/);
  assert.match(featureSource, /max-width: 100%/);
  assert.match(featureSource, /overflow-x: auto/);
  assert.match(featureSource, /margin-inline-start: 0/);
  assert.match(featureSource, /\.ops2027-empty,[\s\S]*width: fit-content/);
});

test('database migration protects stock and distribution writes without adding new schema work', () => {
  assert.match(migrationSource, /check \(warehouse_quantity >= 0\)/);
  assert.match(migrationSource, /unique \(course_id, instructor_name\)/i);
  assert.match(migrationSource, /for update;/i);
  assert.match(migrationSource, /security definer/gi);
  assert.match(migrationSource, /app_is_admin_or_operation_manager/);
});

test('deployable frontend cache markers were refreshed', () => {
  assert.match(configSource, /pr1333-ops2027-fixes-20260805-v1/);
  assert.match(swSource, /const CACHE_VERSION = 1395;/);
});
