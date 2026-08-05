import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const featurePath = new URL('../frontend/src/screens/operations-summer-training-matrix.js', import.meta.url);
const cleanupPath = new URL('../frontend/src/screens/operations-authorities-cleanup.js', import.meta.url);
const managementPath = new URL('../frontend/src/screens/operations-management.js', import.meta.url);
const swPath = new URL('../frontend/sw.js', import.meta.url);

const [featureSource, cleanupSource, managementSource, swSource] = await Promise.all([
  readFile(featurePath, 'utf8'),
  readFile(cleanupPath, 'utf8'),
  readFile(managementPath, 'utf8'),
  readFile(swPath, 'utf8')
]);

test('2027 operations hides only period, authorities and completion tabs while preserving 2026 path', () => {
  assert.match(featureSource, /field\.hidden = in2027/);
  assert.match(featureSource, /button\.hidden = in2027/);
  assert.match(featureSource, /\['authorities', 'completion_approval'\]/);
  assert.match(featureSource, /if \(!is2027\(root\) && customTab\)/);
  assert.match(cleanupSource, /data-ops-custom-tab/);
});

test('new 2027 tabs use the existing operations tab structure, styling and pressed state', () => {
  assert.match(featureSource, /button\.className = 'ds-exceptions-tab ds-ops-mgmt-tab'/);
  assert.match(featureSource, /button\.setAttribute\('aria-pressed', 'false'\)/);
  assert.match(featureSource, /active\?\.setAttribute\('aria-pressed', 'true'\)/);
  assert.match(featureSource, /הכשרות סדנאות/);
  assert.match(featureSource, /הכשרות קורסים/);
  assert.match(featureSource, /ערכות דפוס/);
  assert.doesNotMatch(featureSource, /className = 'ds-btn/);
});

test('2027 workshop inventory is based on the 2026 expected balance and existing location distributions', () => {
  assert.match(managementSource, /export function buildWorkshopOpeningStock2027/);
  assert.match(managementSource, /activity_period: ACTIVITY_SEASON_REGULAR, startDate: WORKSHOPS_SUMMER_FROM, endDate: WORKSHOPS_SUMMER_TO/);
  assert.match(managementSource, /activity_period: ACTIVITY_SEASON_SCHOOL_2027, startDate: SCHOOL_2027_FROM, endDate: SCHOOL_2027_TO/);
  assert.match(managementSource, /const expectedBalance = group\.openingStock - usedQuantity - requiredQuantity/);
  assert.match(managementSource, /\$\{isSchool2027 \? 'מלאי פתיחה' : 'כמות קיימת'\}/);
  assert.match(managementSource, /מיקום מלאי הפתיחה/);
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

test('print kit quantity and delivery editing is exposed only to admin and operation_manager', () => {
  assert.match(featureSource, /function canEditOperationsQuantities\(\)/);
  assert.match(featureSource, /roles\.includes\('admin'\) \|\| roles\.includes\('operation_manager'\)/);
  assert.match(featureSource, /editable\s*\? `<input type="number"/);
  assert.match(featureSource, /: `<span class="ops2027-stock-text">/);
  assert.match(featureSource, /editable \? `<button type="button" class="ops2027-cell-button is-yes" data-kit-return/);
  assert.match(featureSource, /editable \? `<button type="button" class="ops2027-cell-button is-no" data-kit-deliver/);
  assert.match(managementSource, /function canEditOperationsInventory\(state = \{\}\)/);
});

test('tables, section headers and empty states are horizontally centered', () => {
  assert.match(featureSource, /ops2027-section \{ width: fit-content; max-width: 100%; margin-inline: auto/);
  assert.match(featureSource, /\.ops2027-table-shell[\s\S]*width: fit-content;[\s\S]*max-width: 100%;[\s\S]*overflow-x: auto;[\s\S]*margin-inline: auto/);
  assert.match(featureSource, /\.ops2027-empty,[\s\S]*width: fit-content; max-width: 100%; margin-inline: auto/);
});

test('2027 new tabs do not render result-count messages and cache version was refreshed', () => {
  assert.match(managementSource, /ops\.period === ACTIVITY_SEASON_SCHOOL_2027 \? '' : `<p class="ds-muted ds-ops-mgmt-count/);
  assert.match(swSource, /const CACHE_VERSION = 1417;/);
});
