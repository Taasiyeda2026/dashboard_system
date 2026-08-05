import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const controllerPath = new URL('../frontend/src/screens/operations-2027-loading-controller.js', import.meta.url);
const cleanupPath = new URL('../frontend/src/screens/operations-authorities-cleanup.js', import.meta.url);
const managementPath = new URL('../frontend/src/screens/operations-management.js', import.meta.url);
const swPath = new URL('../frontend/sw.js', import.meta.url);

const [controllerSource, cleanupSource, managementSource, swSource] = await Promise.all([
  readFile(controllerPath, 'utf8'),
  readFile(cleanupPath, 'utf8'),
  readFile(managementPath, 'utf8'),
  readFile(swPath, 'utf8')
]);

test('2027 operations preserves native tabs and adds custom tabs through one controller', () => {
  assert.match(cleanupSource, /operations-2027-remaining-fix\.js/);
  assert.match(cleanupSource, /operations-2027-loading-controller\.js/);
  assert.doesNotMatch(cleanupSource, /operations-2027-training-kit-history-fix\.js/);
  assert.doesNotMatch(cleanupSource, /operations-2027-custom-tabs-click-fix\.js/);
});

test('new 2027 tabs use the existing operations tab structure and pressed state', () => {
  assert.match(controllerSource, /button\.className = 'ds-exceptions-tab ds-ops-mgmt-tab'/);
  assert.match(controllerSource, /button\.setAttribute\('aria-pressed', 'false'\)/);
  assert.match(controllerSource, /button\.setAttribute\('aria-pressed', active \? 'true' : 'false'\)/);
  assert.match(controllerSource, /הכשרות סדנאות/);
  assert.match(controllerSource, /הכשרות קורסים/);
  assert.match(controllerSource, /ערכות דפוס/);
  assert.doesNotMatch(controllerSource, /className = 'ds-btn/);
});

test('2027 workshop inventory remains based on the 2026 closing balance and existing locations', () => {
  assert.match(managementSource, /export function buildWorkshopOpeningStock2027/);
  assert.match(managementSource, /activity_period: ACTIVITY_SEASON_REGULAR, startDate: WORKSHOPS_SUMMER_FROM, endDate: WORKSHOPS_SUMMER_TO/);
  assert.match(managementSource, /activity_period: ACTIVITY_SEASON_SCHOOL_2027, startDate: SCHOOL_2027_FROM, endDate: SCHOOL_2027_TO/);
  assert.match(managementSource, /const expectedBalance = group\.openingStock - usedQuantity - requiredQuantity/);
  assert.match(managementSource, /מיקום מלאי הפתיחה/);
});

test('print kit inventory shows only requires_print_kit courses and no requirement toggle', () => {
  assert.match(controllerSource, /courses\.filter\(\(course\) => course\?\.requires_print_kit === true\)/);
  assert.doesNotMatch(controllerSource, /data-kit-required-toggle/);
  assert.doesNotMatch(controllerSource, /set_course_print_kit_requirement/);
});

test('editing permission is verified once by the server and write RPCs are preserved', () => {
  assert.match(controllerSource, /loadOperations2027Source\('edit-permission'/);
  assert.match(controllerSource, /rpc\('app_is_admin_or_operation_manager'\)/);
  assert.match(controllerSource, /set_course_print_kit_stock/);
  assert.match(controllerSource, /deliver_course_print_kit/);
  assert.match(controllerSource, /return_course_print_kit/);
});

test('tables, narrow matrix columns and centered symbols are rendered directly', () => {
  assert.match(controllerSource, /ops2027-section \{ width: fit-content; max-width: 100%; margin-inline: auto/);
  assert.match(controllerSource, /ops2027-table-shell \{ display: block; width: fit-content; max-width: 100%; overflow-x: auto; margin-inline: auto/);
  assert.match(controllerSource, /ops2027-print-kit-matrix \.ops2027-matrix-col \{ width: 72px/);
  assert.match(controllerSource, /display: inline-grid; place-items: center/);
});

test('2027 tabs keep the result count hidden and cache version is refreshed', () => {
  assert.match(managementSource, /ops\.period === ACTIVITY_SEASON_SCHOOL_2027 \? '' : `<p class="ds-muted ds-ops-mgmt-count/);
  assert.match(swSource, /const CACHE_VERSION = 1423;/);
});
