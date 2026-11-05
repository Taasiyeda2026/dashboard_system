import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { instructorAttendanceError } from '../attendance/src/services/instructor-error.service.js';

const migration = await readFile(
  new URL('../supabase/migrations/20261105020000_stop_legacy_travel_comp_after_nov_cutover.sql', import.meta.url),
  'utf8'
);
const edge = await readFile(
  new URL('../supabase/functions/attendance-travel-compensation/index.ts', import.meta.url),
  'utf8'
);
const myReports = await readFile(
  new URL('../attendance/src/screens/my-reports-screen.js', import.meta.url),
  'utf8'
);
const followup = await readFile(
  new URL('../attendance/src/attendance-followup-runtime-v2.js', import.meta.url),
  'utf8'
);
const control = await readFile(
  new URL('../frontend/src/screens/attendance-control.js', import.meta.url),
  'utf8'
);
const bridge = await readFile(
  new URL('../frontend/src/payroll-attendance-v2-bridge.js', import.meta.url),
  'utf8'
);
const dailyTravel = await readFile(
  new URL('../attendance/src/screens/daily-travel-tab.js', import.meta.url),
  'utf8'
);
const frontendSw = await readFile(new URL('../frontend/sw.js', import.meta.url), 'utf8');
const attendanceSw = await readFile(new URL('../attendance/sw.js', import.meta.url), 'utf8');
const attendanceIndex = await readFile(new URL('../attendance/index.html', import.meta.url), 'utf8');
const config = await readFile(new URL('../frontend/src/config.js', import.meta.url), 'utf8');

test('DB cutover stops legacy compensation create/update for Nov+ without deleting existing rows', () => {
  assert.match(migration, /daily_travel_cutover/);
  assert.match(migration, /report_date >= date '2026-11-01'/);
  assert.match(migration, /av2_attendance_travel_context/);
  assert.match(migration, /av2_prepare_attendance_travel/);
  assert.match(migration, /Never create or delete legacy compensation rows after the daily-travel cutover/);
  assert.match(migration, /attendance_daily_travel_report_required/);
  assert.doesNotMatch(migration, /delete from public\.attendance_travel_compensations/i);
  assert.doesNotMatch(migration, /delete from public\.attendance_records/i);
  assert.doesNotMatch(migration, /update public\.attendance_travel_compensations/i);
});

test('Edge travel compensation refuses Nov+ sources before prepare/reconcile', () => {
  assert.match(edge, /daily_travel_cutover/);
  assert.match(edge, /report_date[\s\S]*>= '2026-11-01'/);
  assert.match(edge, /status: 'not_applicable'/);
});

test('Instructor UI routes Nov+ travel to daily-travel and hides legacy compensation editors', () => {
  assert.match(myReports, /record\.report_date < '2026-11-01' && \(compensation \|\| instructorMinutes !== null\)/);
  assert.match(myReports, /onTravelReport && record\.report_date >= '2026-11-01'/);
  assert.match(followup, /usesDailyTravelPath/);
  assert.match(followup, /date >= '2026-11-01'/);
  assert.match(dailyTravel, /item\.date>='2026-11-01'/);
  assert.match(
    instructorAttendanceError({ message: 'attendance_daily_travel_report_required' }),
    /נסיעות/
  );
});

test('Manager/admin Nov+ review model uses daily travel, not legacy compensation attachment', () => {
  assert.match(bridge, /attendanceDate < '2026-11-01'/);
  assert.match(bridge, /useLegacyTravel/);
  assert.match(control, /txt\(display\.date \|\| row\.date\) < '2026-11-01'/);
  assert.match(control, /needsDailyTravel = \(date,rows=\[\]\) => date >= '2026-11-01'/);
  assert.match(control, /av2_list_daily_travel_for_review|dailyTravelReports/);
});

test('deployable cache markers bumped for attendance + dashboard shells', () => {
  assert.match(frontendSw, /const CACHE_VERSION = 2091;/);
  assert.match(attendanceSw, /const CACHE_VERSION = 149;/);
  assert.match(attendanceIndex, /\?v=149/);
  assert.doesNotMatch(attendanceIndex, /\?v=148/);
  assert.match(config, /attendance-nov-cutover-ui-20261105-v1/);
});
