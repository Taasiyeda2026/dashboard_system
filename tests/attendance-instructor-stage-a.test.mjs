import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { instructorAttendanceError } from '../attendance/src/services/instructor-error.service.js';
import { canEditMonth, editBlockReason } from '../attendance/src/services/month-gate.service.js';

const migration = await readFile(
  new URL('../supabase/migrations/20261105003000_attendance_daily_travel_cutover_1101_grandfather.sql', import.meta.url),
  'utf8'
);
const newReport = await readFile(new URL('../attendance/src/screens/new-report-screen.js', import.meta.url), 'utf8');
const dailyTab = await readFile(new URL('../attendance/src/screens/daily-travel-tab.js', import.meta.url), 'utf8');
const historical = await readFile(new URL('../attendance/src/services/historical-display.service.js', import.meta.url), 'utf8');
const sw = await readFile(new URL('../attendance/sw.js', import.meta.url), 'utf8');
const indexHtml = await readFile(new URL('../attendance/index.html', import.meta.url), 'utf8');

test('instructor errors explain locked months in Hebrew without raw codes', () => {
  const locked = instructorAttendanceError({ message: 'attendance_month_locked', code: '42501' });
  assert.match(locked, /נעול לעריכה/);
  assert.match(locked, /פתיחה מחדש|למנהל/);
  assert.doesNotMatch(locked, /42501|attendance_month_locked/);
  assert.match(
    instructorAttendanceError({ message: 'Failed to fetch' }),
    /תקשורת/
  );
});

test('submitted month blocks attendance travel and expense edits until reopen', () => {
  const now = new Date(2026, 10, 5); // 5 Nov 2026 local
  assert.equal(canEditMonth(2026, 10, { status: 'submitted' }, now), false);
  assert.equal(canEditMonth(2026, 10, { status: 'reopened' }, now), true);
  assert.equal(canEditMonth(2026, 11, null, now), true);
  assert.match(editBlockReason(2026, 10, { status: 'submitted' }, now), /נסיעות והוצאות/);
});

test('daily travel cutover is 2026-11-01 across instructor UI and Stage A migration', () => {
  assert.match(newReport, /DAILY_TRAVEL_START_DATE = '2026-11-01'/);
  assert.match(dailyTab, /isLegacyDay=date=>String\(date\|\|''\)<'2026-11-01'/);
  assert.match(historical, /HISTORICAL_TRAVEL_CUTOFF = '2026-11-01'/);
  assert.match(migration, /report_date < date '2026-11-01'/);
  assert.match(migration, /attendance_daily_travel_cutover_grandfather/);
  assert.match(migration, /attendance_independent_expense_cutover_grandfather/);
  assert.doesNotMatch(migration, /delete from public\.attendance_records/i);
  assert.doesNotMatch(migration, /update public\.attendance_records/i);
});

test('attendance cache markers bumped for Stage A instructor release', () => {
  // Stage A shipped at 147; systemic B–E continues on the same branch and bumps further.
  assert.match(sw, /const CACHE_VERSION = 148;/);
  assert.match(indexHtml, /\?v=148/);
  assert.doesNotMatch(indexHtml, /\?v=147/);
});
