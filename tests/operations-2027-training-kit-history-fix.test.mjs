import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const wrapperUrl = new URL('../frontend/src/screens/operations-authorities-cleanup.js', import.meta.url);
const controllerUrl = new URL('../frontend/src/screens/operations-2027-loading-controller.js', import.meta.url);
const swUrl = new URL('../frontend/sw.js', import.meta.url);

const [wrapperSource, controllerSource, swSource] = await Promise.all([
  readFile(wrapperUrl, 'utf8'),
  readFile(controllerUrl, 'utf8'),
  readFile(swUrl, 'utf8')
]);

test('operations wrapper loads the single Operations 2027 controller', () => {
  assert.match(wrapperSource, /operations-2027-loading-controller\.js/);
  assert.doesNotMatch(wrapperSource, /operations-2027-training-kit-history-fix\.js/);
});

test('course training uses all active instructors and all active courses', () => {
  assert.match(controllerSource, /from\(INSTRUCTOR_TABLE\)/);
  assert.match(controllerSource, /isActiveInstructor\(row\.active\)/);
  assert.match(controllerSource, /from\(COURSE_TABLE\)[\s\S]*\.eq\('is_active', true\)/);
  assert.match(controllerSource, /rows: data\.instructors,[\s\S]*columns: data\.courses/);
});

test('kit view separates active instructors from inactive holders', () => {
  assert.match(controllerSource, /courses\.filter\(\(course\) => course\?\.requires_print_kit === true\)/);
  assert.match(controllerSource, /inactiveNames/);
  assert.match(controllerSource, /מדריכים פעילים/);
  assert.match(controllerSource, /מדריכים לא פעילים שמחזיקים ערכה/);
});

test('editing permission is cached and existing writes bind their controls', () => {
  assert.match(controllerSource, /loadOperations2027Source\('edit-permission'/);
  assert.match(controllerSource, /rpc\('app_is_admin_or_operation_manager'\)/);
  assert.match(controllerSource, /data-ops-course-training-toggle/);
  assert.match(controllerSource, /data-ops-kit-deliver/);
  assert.match(controllerSource, /data-ops-kit-return/);
});

test('service worker cache version is current', () => {
  assert.match(swSource, /const CACHE_VERSION = 1419;/);
});
