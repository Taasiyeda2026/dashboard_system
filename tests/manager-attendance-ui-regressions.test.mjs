import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calendarPresentationTitle, dedupeSchoolCalendarOccurrences } from '../frontend/src/screens/shared/school-calendar-logic.js';
import { distinctAttendanceWorkDays, reportPresentation } from '../attendance/src/components/report-summary-row.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('manager navigation force-renders dashboard and clears pending workspace state', () => {
  const board = read('frontend/src/manager-board-runtime.js');
  const main = read('frontend/src/main.js');
  assert.match(board, /forceDashboardRender/);
  assert.match(board, /admin_management_pending_manager_tab/);
  assert.match(board, /route: 'dashboard', force: true/);
  assert.match(main, /route === state\.route && !force/);
});

test('manager board publishes canonical period month and school year context', () => {
  const board = read('frontend/src/manager-board-runtime.js');
  const workspace = read('frontend/src/manager-board-workspace-runtime.js');
  const tracking = read('frontend/src/manager-board-employee-file-tracking-runtime.js');
  assert.match(board, /data-manager-board-period/);
  assert.match(board, /data-manager-board-month/);
  assert.match(board, /data-manager-board-school-year/);
  assert.match(workspace, /dataset\?\.managerBoardPeriod/);
  assert.match(tracking, /dataset\?\.managerBoardSchoolYear/);
});

test('tracking re-entry invalidates ready snapshot and roster cache', () => {
  const workspace = read('frontend/src/manager-board-workspace-runtime.js');
  const tracking = read('frontend/src/manager-board-employee-file-tracking-runtime.js');
  assert.match(workspace, /rosterCache\.delete/);
  assert.match(workspace, /manager-board:tracking-invalidate/);
  assert.doesNotMatch(tracking, /state === 'loading' \|\| state === 'true'/);
  assert.match(tracking, /employeeFileTrackingReady = ''/);
});

test('workshop milestone is rendered by domain logic without copy-fix runtime', () => {
  const board = read('frontend/src/manager-board-runtime.js');
  const index = read('index.html');
  assert.match(board, /type\.includes\('workshop'\).*return 'סדנה'/);
  assert.doesNotMatch(index, /manager-board-copy-fixes-runtime/);
});

test('calendar sector stays in data but is removed and equivalent occurrences are deduplicated', () => {
  const rows = [
    { title: 'ראש השנה · יהודי', calendar_sector: 'jewish', start_date: '2026-09-12', end_date: '2026-09-13' },
    { title: 'ראש השנה · ערבי', calendar_sector: 'arab', start_date: '2026-09-12', end_date: '2026-09-13' }
  ];
  assert.equal(calendarPresentationTitle(rows[0].title), 'ראש השנה');
  assert.equal(dedupeSchoolCalendarOccurrences(rows).length, 1);
  assert.equal(rows[0].calendar_sector, 'jewish');
});

test('accent palette uses semantic clean red and balanced pink independently of danger', () => {
  const palette = read('frontend/src/accent-picker.js');
  const main = read('frontend/src/main.js');
  assert.match(palette, /red:\s+\{ accent: '#c62828'/);
  assert.match(palette, /pink:\s+\{ accent: '#d94f70'/);
  assert.match(main, /data-accent="red"[^>]+title="אדום"/);
  assert.match(main, /data-accent="pink"[^>]+title="ורוד"/);
});

test('attendance work-day KPI counts distinct source dates and ignores generated rows', () => {
  const rows = [
    { id: 'a', report_date: '2026-09-01' },
    { id: 'b', report_date: '2026-09-01' },
    { id: 'c', report_date: '2026-09-02' },
    { id: 'g', report_date: '2026-09-03', generation_kind: 'travel_time_cancellation' }
  ];
  assert.equal(distinctAttendanceWorkDays(rows), 2);
});

test('attendance presentation removes repeated school and keeps distinct hierarchy', () => {
  assert.deepEqual(reportPresentation({ activity_name_snapshot: 'מקיף א', school_name_snapshot: 'מקיף א', authority_name_snapshot: 'חיפה' }), {
    activity: 'מקיף א', secondary: 'חיפה'
  });
  assert.equal(reportPresentation({ activity_name_snapshot: 'ביומימיקרי — מקיף אבו גוש — אבו גוש', school_name_snapshot: 'מקיף אבו גוש', authority_name_snapshot: 'אבו גוש' }).activity, 'ביומימיקרי');
});

test('home attendance click expands details and edit remains an explicit permitted action', () => {
  const row = read('attendance/src/components/report-summary-row.js');
  assert.match(row, /toggle\.addEventListener\('click'/);
  assert.match(row, /options\.editable && typeof options\.onEdit === 'function'/);
  assert.match(row, /edit\.textContent = 'עריכה'/);
  assert.doesNotMatch(row, /toggle\.addEventListener\('click',[\s\S]{0,120}options\.onEdit/);
});
