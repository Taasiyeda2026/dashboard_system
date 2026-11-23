import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  canReloadTravelAfterAttendanceChange,
  pickDefaultTravelDay,
  shouldRefreshTravelDays,
} from '../attendance/src/services/travel-readiness-sync.js';

const read = (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('travel days refresh when forced, empty, or marked stale after attendance change', () => {
  assert.equal(shouldRefreshTravelDays({ force: true, dayOptionsLength: 6 }), true);
  assert.equal(shouldRefreshTravelDays({ dayOptionsLength: 0 }), true);
  assert.equal(shouldRefreshTravelDays({ dayOptionsLength: 4, attendanceContextStale: true }), true);
  assert.equal(shouldRefreshTravelDays({ dayOptionsLength: 4, attendanceContextStale: false }), false);
});

test('auto-reload after attendance change is blocked while a travel draft is dirty or saving', () => {
  assert.equal(canReloadTravelAfterAttendanceChange({
    draftDirty: false, saving: false, loading: false, uncertainSave: false, panelHidden: false,
  }), true);
  assert.equal(canReloadTravelAfterAttendanceChange({
    draftDirty: true, panelHidden: false,
  }), false);
  assert.equal(canReloadTravelAfterAttendanceChange({
    saving: true, panelHidden: false,
  }), false);
  assert.equal(canReloadTravelAfterAttendanceChange({
    uncertainSave: true, panelHidden: false,
  }), false);
  assert.equal(canReloadTravelAfterAttendanceChange({
    loading: true, panelHidden: false,
  }), false);
  assert.equal(canReloadTravelAfterAttendanceChange({
    panelHidden: true,
  }), false);
});

test('daily travel tab exports invalidateAttendanceContext and refreshes stale dayOptions', async () => {
  const tab = await read('attendance/src/screens/daily-travel-tab.js');
  assert.match(tab, /from '\.\.\/services\/travel-readiness-sync\.js'/);
  assert.match(tab, /attendanceContextStale\s*=\s*false/);
  assert.match(tab, /function invalidateAttendanceContext\(/);
  assert.match(tab, /shouldRefreshTravelDays\(/);
  assert.match(tab, /canReloadTravelAfterAttendanceChange\(/);
  assert.match(tab, /return \{panel,load,setDate,dateInput:dateField\.input,invalidateAttendanceContext\}/);
  assert.match(tab, /Never tear down unsaved leg inputs/);
  assert.match(tab, /await load\(\{force:!draftGuard\.dirty\}\)/);
});

test('new report invalidates travel readiness after verified attendance create/update', async () => {
  const screen = await read('attendance/src/screens/new-report-screen.js');
  assert.match(screen, /function notifyTravelAttendanceChanged\(/);
  assert.match(screen, /dailyTravel\?\.invalidateAttendanceContext\?\.\(\)/);
  assert.match(screen, /const record = await createRecord\([\s\S]*?notifyTravelAttendanceChanged\(\)/);
  assert.match(screen, /function finishSuccessfulSave[\s\S]*?notifyTravelAttendanceChanged\(\)/);
  assert.match(screen, /successBanner\.textContent = 'דיווח הנוכחות נשמר בהצלחה'/);
  assert.match(screen, /הדיווח נשמר בהצלחה/);
});

test('my-reports keeps attendance rows when daily travel load fails', async () => {
  const screen = await read('attendance/src/screens/my-reports-screen.js');
  assert.match(screen, /let travelLoadError\s*=\s*null/);
  assert.match(screen, /dailyTravelReports=await getDailyTravelReports/);
  assert.match(screen, /travelLoadError=error/);
  assert.match(screen, /דיווחי הנוכחות מוצגים, אך לא ניתן לטעון כעת את סיכום הנסיעות/);
  assert.match(screen, /getMonthRecords\(instructor\.empId, year, month\)/);
});

test('home keeps attendance summary when daily travel load fails', async () => {
  const home = await read('attendance/src/screens/home-screen.js');
  assert.match(home, /travelReports=await getDailyTravelReports/);
  assert.match(home, /catch\{\s*travelReports=\[\]/);
  assert.match(home, /getMonthRecords\(instructor\.empId, year, month\)/);
});

test('pickDefaultTravelDay prefers ready missing over not-ready requested/today', () => {
  const days = [
    { date: '2026-11-30', ready: false, review_status: 'missing' },
    { date: '2026-11-22', ready: false, review_status: 'missing' },
    { date: '2026-11-19', ready: true, review_status: 'missing' },
    { date: '2026-11-05', ready: true, review_status: 'pending_review' },
    { date: '2026-11-04', ready: true, review_status: 'pending_review' },
  ];
  assert.equal(pickDefaultTravelDay(days, '2026-11-22')?.date, '2026-11-19');
  assert.equal(pickDefaultTravelDay(days, '2026-11-05')?.date, '2026-11-05');
  assert.equal(pickDefaultTravelDay(days, '2026-11-01')?.date, '2026-11-19');
  assert.equal(pickDefaultTravelDay([
    { date: '2026-11-22', ready: false, review_status: 'missing' },
    { date: '2026-11-10', ready: true, review_status: 'rejected' },
  ], '2026-11-22')?.date, '2026-11-10');
  assert.equal(pickDefaultTravelDay([
    { date: '2026-11-22', ready: false, review_status: 'missing' },
  ], '2026-11-22')?.date, '2026-11-22');
  assert.equal(pickDefaultTravelDay([], '2026-11-22'), null);
});

test('attendance PWA cache bumped to 179 and SW defers reload while forms are open', async () => {
  const sw = await read('attendance/sw.js');
  const index = await read('attendance/index.html');
  const registration = await read('attendance/src/services/sw-registration.service.js');
  assert.match(sw, /const CACHE_VERSION = 183/);
  assert.match(index, /\?v=183/);
  assert.doesNotMatch(index, /\?v=178/);
  assert.match(registration, /document\.querySelector\('form, \.av2-daily-travel, \.av2-expenses-tab'\)/);
});

test('create/update/delete attendance always invalidate the month records cache', async () => {
  const service = await read('attendance/src/services/attendance.service.js');
  assert.match(service, /export async function createRecord[\s\S]*invalidateAttendanceCache\(empId\)/);
  assert.match(service, /export async function updateRecord[\s\S]*invalidateAttendanceCache\(empId\)/);
  assert.match(service, /export async function deleteRecord[\s\S]*invalidateAttendanceCache\(empId\)/);
  assert.match(service, /editRecordId[\s\S]*updateRecord\(editRecordId/);
});

test('my-reports renders attendance rows from getMonthRecords even when travel side-load fails', async () => {
  const screen = await read('attendance/src/screens/my-reports-screen.js');
  const load = screen.slice(screen.indexOf('async function loadAndRender'), screen.indexOf('function buildDeletedTravelNotice'));
  assert.match(load, /getMonthRecords\(instructor\.empId, year, month\)/);
  assert.match(load, /travelLoadError=error/);
  assert.match(load, /const sorted = \[\.\.\.sourceRecords\]\.sort/);
  assert.match(load, /contentArea\.append\(listWrap/);
  assert.match(load, /if \(travelLoadError \|\| expenseLoadError\)/);
});

test('mobile and desktop attendance shells stay wired for the travel tab', async () => {
  const index = await read('attendance/index.html');
  const tab = await read('attendance/src/screens/daily-travel-tab.js');
  assert.match(index, /mobile-app-theme\.css\?v=183/);
  assert.match(index, /desktop-app-theme\.css\?v=183/);
  assert.match(index, /report-tabs-responsive-typography\.css\?v=183/);
  assert.match(tab, /pickDefaultTravelDay\(/);
  assert.match(tab, /av2-report__travel-tab/);
  assert.match(tab, /role', 'tabpanel'/);
});
