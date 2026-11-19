import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  canReloadTravelAfterAttendanceChange,
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

test('attendance PWA cache bumped to 178 and SW defers reload while forms are open', async () => {
  const sw = await read('attendance/sw.js');
  const index = await read('attendance/index.html');
  const registration = await read('attendance/src/services/sw-registration.service.js');
  assert.match(sw, /const CACHE_VERSION = 178/);
  assert.match(index, /\?v=178/);
  assert.doesNotMatch(index, /\?v=177/);
  assert.match(registration, /document\.querySelector\('form, \.av2-daily-travel, \.av2-expenses-tab'\)/);
});
