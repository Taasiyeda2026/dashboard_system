import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  HEBREW_ACTIVITY_TYPES,
  getDbTypesForReportType,
  normalizeAttendanceReportType,
} from '../attendance/src/services/activities-report.helpers.js';

const attendanceServiceSource = await readFile(
  new URL('../attendance/src/services/attendance.service.js', import.meta.url),
  'utf8',
);
const previewSource = await readFile(
  new URL('../attendance/src/preview/preview-mode.js', import.meta.url),
  'utf8',
);
const swSource = await readFile(new URL('../attendance/sw.js', import.meta.url), 'utf8');
const indexSource = await readFile(new URL('../attendance/index.html', import.meta.url), 'utf8');

test('Attendance exposes one workshop type while preserving legacy summer-workshop compatibility', () => {
  assert.ok(HEBREW_ACTIVITY_TYPES.includes('סדנה'));
  assert.ok(!HEBREW_ACTIVITY_TYPES.includes('סדנאות קיץ'));
  assert.equal(normalizeAttendanceReportType('סדנאות קיץ'), 'סדנה');
  assert.deepEqual(getDbTypesForReportType('סדנה'), ['workshop']);
  assert.deepEqual(getDbTypesForReportType('סדנאות קיץ'), ['workshop']);

  assert.match(attendanceServiceSource, /LEGACY_SUMMER_WORKSHOP = 'סדנאות קיץ'/);
  assert.match(attendanceServiceSource, /activity_type: activityType/);
  assert.doesNotMatch(previewSource, /'סדנה','סדנאות קיץ'/);
  assert.match(swSource, /const CACHE_VERSION = 42;/);
  assert.match(indexSource, /\?v=42/);
});
