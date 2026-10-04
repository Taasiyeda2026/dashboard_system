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
  attendanceTimesFromActivity,
} from '../attendance/src/services/activities-report.helpers.js';

const newReportSource = await readFile(new URL('../attendance/src/screens/new-report-screen.js', import.meta.url), 'utf8');
const reportsSource = await readFile(new URL('../attendance/src/screens/my-reports-screen.js', import.meta.url), 'utf8');
const activitiesServiceSource = await readFile(new URL('../attendance/src/services/activities.service.js', import.meta.url), 'utf8');
const attendanceServiceSource = await readFile(new URL('../attendance/src/services/attendance.service.js', import.meta.url), 'utf8');
const trainingRuntimeSource = await readFile(new URL('../attendance/src/training-report-ui-runtime.js', import.meta.url), 'utf8');
const courseDashboardRuntimeSource = await readFile(new URL('../attendance/src/course-dashboard-choice-runtime.js', import.meta.url), 'utf8');
const searchableSelectSource = await readFile(new URL('../attendance/src/components/searchable-select.js', import.meta.url), 'utf8');
const courseChoiceMigration = await readFile(new URL('../supabase/migrations/20261005000500_attendance_dashboard_course_choice.sql', import.meta.url), 'utf8');
const swSource = await readFile(new URL('../attendance/sw.js', import.meta.url), 'utf8');
const indexSource = await readFile(new URL('../attendance/index.html', import.meta.url), 'utf8');

test('Attendance report type list treats Zoom as training mode, not an activity type', () => {
  assert.equal(ONLINE_REPORT_TYPE, 'זום'); // legacy record compatibility only
  assert.equal(OPERATIONS_REPORT_TYPE, 'תפעול');
  assert.ok(!HEBREW_ACTIVITY_TYPES.includes('זום'));
  assert.ok(!HEBREW_ACTIVITY_TYPES.includes('מקוון'));
  assert.equal(normalizeAttendanceReportType('מקוון'), 'זום');

  assert.equal(getDbTypesForReportType('ביטול זמן'), null);
  assert.deepEqual(getDbTypesForReportType('הכשרה'), ['course', 'tour']);
  assert.equal(getDbTypesForReportType('זום'), null);
  assert.deepEqual(getDbTypesForReportType('חדר בריחה'), ['escape_room']);
  assert.deepEqual(getDbTypesForReportType('סדנה'), ['workshop']);
  assert.deepEqual(getDbTypesForReportType('סיור'), ['tour']);
  assert.deepEqual(getDbTypesForReportType('קורס'), ['course']);
  assert.deepEqual(getDbTypesForReportType('תפעול'), []);
  assert.ok(OPEN_FIELD_REPORT_TYPES.includes('תפעול'));
});

test('Workshop uses dashboard hours while course adds 15 minutes per full 45-minute block', () => {
  assert.deepEqual(
    attendanceTimesFromActivity({ start_time: '08:30', end_time: '10:00' }, 'סדנה'),
    { startTime: '08:30', endTime: '10:00' },
  );
  assert.deepEqual(
    attendanceTimesFromActivity({ start_time: '08:30', end_time: '10:00' }, 'קורס'),
    { startTime: '08:15', endTime: '10:15' },
  );
  assert.deepEqual(
    attendanceTimesFromActivity({ start_time: '12:00:00', end_time: '13:00:00' }, 'קורס'),
    { startTime: '11:45', endTime: '13:00' },
  );
  assert.deepEqual(
    attendanceTimesFromActivity({ start_time: '', end_time: '13:00' }, 'קורס'),
    { startTime: '', endTime: '' },
  );
  assert.match(newReportSource, /AUTO_TIME_REPORT_TYPES = new Set\(\[COURSE_REPORT_TYPE, WORKSHOP_REPORT_TYPE\]\)/);
  assert.match(newReportSource, /attendanceTimesFromActivity\(activity, getReportType\(\)\)/);
  assert.match(newReportSource, /startPicker\.setValue\(startTime\)/);
  assert.match(newReportSource, /endPicker\.setValue\(endTime\)/);
});

test('Training uses the global course/tour catalog and strips assignment location metadata', () => {
  assert.match(activitiesServiceSource, /effectiveLimit = trainingSearch \? Math\.max\(Number\(limit\) \|\| 0, 1000\)/);
  assert.match(activitiesServiceSource, /row_id: `training-catalog:\$\{key\}`/);
  assert.match(activitiesServiceSource, /authority_id: null/);
  assert.match(activitiesServiceSource, /single_school_id: null/);
  assert.match(activitiesServiceSource, /__attendanceTrainingCatalog: true/);
  assert.match(trainingRuntimeSource, /A training report chooses training content by name only/);
  assert.match(trainingRuntimeSource, /authorityWrap\.hidden = true/);
  assert.match(trainingRuntimeSource, /schoolMount\.hidden = true/);
});

test('Course reporting uses the selected date dashboard row and does not add a class field', () => {
  assert.match(courseChoiceMigration, /av2_get_current_instructor_activity_choices_for_date/);
  assert.match(courseChoiceMigration, /av2_get_instructor_activities_for_date\(v_emp_id, p_date\)/);
  assert.match(courseChoiceMigration, /'grade', a\.grade/);
  assert.match(courseChoiceMigration, /'class_group', a\.class_group/);
  assert.match(courseDashboardRuntimeSource, /av2_get_current_instructor_activity_choices_for_date/);
  assert.match(courseDashboardRuntimeSource, /ambiguousAtSchool && cls/);
  assert.match(courseDashboardRuntimeSource, /`כיתה \$\{cls\}`/);
  assert.match(courseDashboardRuntimeSource, /ambiguousAtSchool && time/);
  assert.match(courseDashboardRuntimeSource, /av2:set-options/);
  assert.match(searchableSelectSource, /wrap\.addEventListener\('av2:set-options'/);
  assert.doesNotMatch(courseDashboardRuntimeSource, /createSelectField|createInputField/);
  assert.match(indexSource, /course-dashboard-choice-runtime\.js\?v=107/);
});

test('Legacy Zoom data remains normalized while the current UI removes Zoom from activity-type choices', () => {
  assert.match(attendanceServiceSource, /LEGACY_ONLINE_LABEL = 'מקוון'/);
  assert.match(attendanceServiceSource, /ZOOM_LABEL = 'זום'/);
  assert.match(attendanceServiceSource, /activityType === ZOOM_LABEL \|\| usesPublicTransport/);

  assert.match(reportsSource, /ONLINE_REPORT_TYPE, OPERATIONS_REPORT_TYPE/);
  assert.match(reportsSource, /isOperations \? 'פרטי תפעול \*' : 'שם פעילות'/);
  assert.match(reportsSource, /kmField\.input\.disabled = true/);
  assert.match(reportsSource, /roundtrip_km:\s*isZoom \? 0/);

  assert.match(trainingRuntimeSource, /const ZOOM_LABEL = 'זום'/);
  assert.match(trainingRuntimeSource, /option\.value === 'online'/);
  assert.match(trainingRuntimeSource, /removeZoomAsActivityType/);
  assert.match(indexSource, /training-report-ui-runtime\.js\?v=107/);
});

test('Attendance cache is synchronized for the training and dashboard-choice release', () => {
  assert.match(swSource, /const CACHE_VERSION = 107;/);
  assert.match(indexSource, /\?v=107/);
  assert.doesNotMatch(indexSource, /\?v=106/);
});