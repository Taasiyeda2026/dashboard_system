import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  HEBREW_ACTIVITY_TYPES,
  ONLINE_REPORT_TYPE,
  OPERATIONS_REPORT_TYPE,
  OPEN_FIELD_REPORT_TYPES,
  getDbTypesForReportType,
  normalizeAttendanceReportType,
} from '../attendance/src/services/activities-report.helpers.js';

const newReportSource = await readFile(new URL('../attendance/src/screens/new-report-screen.js', import.meta.url), 'utf8');
const reportsSource = await readFile(new URL('../attendance/src/screens/my-reports-screen.js', import.meta.url), 'utf8');
const attendanceServiceSource = await readFile(new URL('../attendance/src/services/attendance.service.js', import.meta.url), 'utf8');
const previewSource = await readFile(new URL('../attendance/src/preview/preview-mode.js', import.meta.url), 'utf8');
const swSource = await readFile(new URL('../attendance/sw.js', import.meta.url), 'utf8');
const indexSource = await readFile(new URL('../attendance/index.html', import.meta.url), 'utf8');

test('Attendance report type list uses Zoom and keeps canonical activity filtering rules', () => {
  assert.equal(ONLINE_REPORT_TYPE, 'זום');
  assert.equal(OPERATIONS_REPORT_TYPE, 'תפעול');
  assert.ok(HEBREW_ACTIVITY_TYPES.includes('זום'));
  assert.ok(!HEBREW_ACTIVITY_TYPES.includes('מקוון'));
  assert.equal(normalizeAttendanceReportType('מקוון'), 'זום');

  assert.equal(getDbTypesForReportType('ביטול זמן'), null);
  assert.equal(getDbTypesForReportType('הכשרה'), null);
  assert.equal(getDbTypesForReportType('זום'), null);
  assert.deepEqual(getDbTypesForReportType('חדר בריחה'), ['escape_room']);
  assert.deepEqual(getDbTypesForReportType('סדנה'), ['workshop']);
  assert.deepEqual(getDbTypesForReportType('סיור'), ['tour']);
  assert.deepEqual(getDbTypesForReportType('קורס'), ['course']);
  assert.deepEqual(getDbTypesForReportType('תפעול'), []);
  assert.ok(OPEN_FIELD_REPORT_TYPES.includes('תפעול'));
});

test('New report supports all-activity choices, operations details and zero-travel Zoom', () => {
  assert.match(newReportSource, /ALL_CANONICAL_REPORT_TYPES[\s\S]*ביטול זמן[\s\S]*TRAINING_REPORT_TYPE[\s\S]*ONLINE_REPORT_TYPE/);
  assert.match(newReportSource, /searchCanonicalActivities\(\{[\s\S]*reportType/);
  assert.match(newReportSource, /label:\s*'פרטי תפעול \*'/);
  assert.match(newReportSource, /setLocationFieldsVisible\(false\)/);
  assert.match(newReportSource, /activity_id:\s*isOpen \? null/);
  assert.match(newReportSource, /newType === ONLINE_REPORT_TYPE[\s\S]*value = '0'[\s\S]*disabled = true/);
  assert.match(newReportSource, /if \(isOnline\)[\s\S]*kmValue = 0/);
});

test('Attendance service and edit flow enforce the same Zoom and operations rules', () => {
  assert.match(attendanceServiceSource, /LEGACY_ONLINE_LABEL = 'מקוון'/);
  assert.match(attendanceServiceSource, /ZOOM_LABEL = 'זום'/);
  assert.match(attendanceServiceSource, /activityType === ZOOM_LABEL \? \{ roundtrip_km: 0 \}/);
  assert.match(attendanceServiceSource, /return \[\.\.\.FALLBACK_ACTIVITY_TYPES\]/);

  assert.match(reportsSource, /ONLINE_REPORT_TYPE, OPERATIONS_REPORT_TYPE/);
  assert.match(reportsSource, /isOperations \? 'פרטי תפעול \*' : 'שם פעילות'/);
  assert.match(reportsSource, /kmField\.input\.disabled = true/);
  assert.match(reportsSource, /roundtrip_km:\s*isZoom \? 0/);
  assert.match(reportsSource, /authority_name_snapshot:\s*isOperations \? null/);

  assert.match(previewSource, /'זום'/);
  assert.doesNotMatch(previewSource, /previewActivityTypes\(\)[\s\S]*'מקוון'/);
});

test('Attendance cache is synchronized for the report type behavior release', () => {
  assert.match(swSource, /const CACHE_VERSION = 39;/);
  assert.match(indexSource, /\?v=39/);
  assert.doesNotMatch(indexSource, /\?v=38/);
});
