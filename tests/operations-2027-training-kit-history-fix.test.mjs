import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const wrapperUrl = new URL('../frontend/src/screens/operations-authorities-cleanup.js', import.meta.url);
const featureUrl = new URL('../frontend/src/screens/operations-2027-training-kit-history-fix.js', import.meta.url);
const swUrl = new URL('../frontend/sw.js', import.meta.url);

const [wrapperSource, featureSource, swSource] = await Promise.all([
  readFile(wrapperUrl, 'utf8'),
  readFile(featureUrl, 'utf8'),
  readFile(swUrl, 'utf8')
]);

test('operations wrapper loads the focused training and kit history fix', () => {
  assert.match(wrapperSource, /operations-2027-training-kit-history-fix\.js/);
});

test('course training uses all active instructors and all active courses instead of current assignments only', () => {
  assert.match(featureSource, /from\(INSTRUCTOR_TABLE\)/);
  assert.match(featureSource, /normalize\(row\?\.active\) === 'yes'/);
  assert.match(featureSource, /instructors\.filter\(\(row\) => row\.active\)/);
  assert.match(featureSource, /from\(COURSE_TABLE\)[\s\S]*\.eq\('is_active', true\)/);
  assert.match(featureSource, /כל המדריכים הפעילים מול כל הקורסים הפעילים/);
});

test('kit view includes inactive kit items and separates active instructors from inactive holders', () => {
  assert.match(featureSource, /select\('id, short_name, full_name, gefen_number, sort_order, is_active, requires_print_kit'\)[\s\S]*\.eq\('requires_print_kit', true\)/);
  assert.match(featureSource, /inactiveHolders/);
  assert.match(featureSource, /מדריכים פעילים/);
  assert.match(featureSource, /מדריכים לא פעילים שמחזיקים ערכה/);
});

test('editing permission is verified by the server and clickable controls bind their events', () => {
  assert.match(featureSource, /rpc\('app_is_admin_or_operation_manager'\)/);
  assert.match(featureSource, /data-history-training-toggle/);
  assert.match(featureSource, /data-history-kit-deliver/);
  assert.match(featureSource, /data-history-kit-return/);
  assert.match(featureSource, /addEventListener\('click'/);
});

test('service worker cache version is current', () => {
  assert.match(swSource, /const CACHE_VERSION = 1417;/);
});
