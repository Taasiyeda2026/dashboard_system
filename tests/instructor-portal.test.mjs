import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { instructorActivities, monthlyInstructorSummary, instructorScheduleRows } from '../frontend/src/screens/instructor-portal/portal-data.js';
import { organizationalEventsForDate, organizationalCalendarDayLabel } from '../frontend/src/screens/instructor-portal/calendar-events.js';
import { courseScheduleTableHtml } from '../frontend/src/screens/shared/instructor-course-schedule-view.js';
import { activityWorkDrawerHtml } from '../frontend/src/screens/shared/activity-detail-html.js';

const stateA = { user: { emp_id: 'A-1', role: 'instructor' } };
const basicRows = [
  { RowID: 'one', emp_id: 'A-1', activity_name: 'של א', activity_type: 'סדנה', start_date: '2026-09-02' },
  { RowID: 'two', emp_id: 'B-1', activity_name: 'של ב', activity_type: 'קורס', start_date: '2026-09-03' },
  { RowID: 'three', emp_id: 'B-1', emp_id_2: 'A-1', activity_name: 'מדריך שני', activity_type: 'סדנה', start_date: '2026-09-04' }
];

test('dashboard defines exactly the six requested shortcuts and reuses configured external links', () => {
  const source = fs.readFileSync(new URL('../frontend/src/screens/instructor-portal/dashboard.js', import.meta.url), 'utf8');
  assert.equal((source.match(/action: '/g) || []).length, 6);
  for (const label of ['סידור עבודה', 'לוח שנה', 'מערכת נוכחות', 'מצגות', 'דיווחים', 'הפעילויות שלי']) assert.match(source, new RegExp(label));
  assert.match(source, /config\.instructorAttendanceUrl/);
  assert.match(source, /config\.instructorPresentationsUrl/);
});

test('portal selectors include primary and secondary assignments and exclude another instructor', () => {
  assert.deepEqual(instructorActivities(basicRows, stateA).map((row) => row.RowID), ['one', 'three']);
  assert.equal(monthlyInstructorSummary(basicRows, stateA, '2026-09').total, 2);
});

test('work schedule reuses ready-course source and scopes it to authenticated instructor IDs', () => {
  const dates = ['2026-09-06', '2026-09-13'];
  const make = (id, empId) => ({ RowID: id, emp_id: empId, instructor_name: empId, activity_season: 'school_2027', activity_type: 'קורס', status: 'פתוח', activity_name: id, authority: 'רשות', school: 'בית ספר', sessions: 2, start_date: dates[0], end_date: dates[1], start_time: '14:00', end_time: '15:00', date_1: dates[0], date_2: dates[1] });
  assert.deepEqual(instructorScheduleRows([make('mine', 'A-1'), make('other', 'B-1')], stateA).map((row) => row.name), ['mine']);
});

test('organizational calendar combines all sectors and birthdays without instructor-sector filtering', () => {
  const sectors = ['general', 'jewish', 'arab', 'druze'];
  const rows = sectors.map((calendar_sector) => ({ start_date: '2026-09-08', end_date: '2026-09-08', title: calendar_sector, category: 'holiday', calendar_sector, is_active: true }));
  const events = organizationalEventsForDate(rows, [{ employee_name: 'נועה', birth_month: 9, birth_day: 8 }], '2026-09-08');
  assert.equal(events.length, 5);
  sectors.forEach((sector) => assert.ok(events.some((event) => event.title === sector)));
  assert.match(organizationalCalendarDayLabel(events), /יום הולדת לנועה/);
});

test('manager and instructor schedules consume the same responsive course table renderer', () => {
  const operationSource = fs.readFileSync(new URL('../frontend/src/screens/operations-management.js', import.meta.url), 'utf8');
  assert.match(operationSource, /courseScheduleTableHtml\(readyRows/);
  const html = courseScheduleTableHtml([{ key: 'one', name: 'קורס', authority: 'רשות', school: 'בית ספר', instructorNames: ['א'], weekday: 'ראשון', timeRange: '14:00–15:00', startDate: '2026-09-01', endDate: '2026-09-08', grade: 'ה', sessionsCount: 2, dates: ['2026-09-01', '2026-09-08'] }]);
  assert.match(html, /ds-ops-course-schedule-table/);
  assert.match(html, /data-ops-course-dates-toggle/);
  assert.match(html, /course-schedule-desktop/);
  assert.match(html, /course-schedule-mobile-card/);
});

test('portal calendar stays a seven-column grid with compact mobile day details', () => {
  const source = fs.readFileSync(new URL('../frontend/src/screens/instructor-portal/calendar.js', import.meta.url), 'utf8');
  assert.match(source, /ds-cal-grid/);
  assert.match(source, /ds-interactive-card--day-cell|variant: 'day-cell'/);
  assert.match(source, /ui\?\.openDrawer/);
});

test('my activities provides mobile cards that open the shared activity drawer', () => {
  const source = fs.readFileSync(new URL('../frontend/src/screens/instructor-portal/my-activities.js', import.meta.url), 'utf8');
  assert.match(source, /portal-activities-mobile/);
  assert.match(source, /portal-activity-card/);
  assert.match(source, /activityWorkDrawerHtml/);
});

test('instructor navigation keeps portal areas and omits approvals and guidelines from visible nav', () => {
  const source = fs.readFileSync(new URL('../frontend/src/main.js', import.meta.url), 'utf8');
  const sidebar = source.slice(source.indexOf('const instructorSidebarItems'), source.indexOf('const regularNav'));
  assert.doesNotMatch(sidebar, /instructor-completion-approvals|instructor-guidelines/);
  assert.match(sidebar, /instructor-dashboard/);
  assert.match(sidebar, /instructor-work-schedule/);
});

test('instructor activity drawer is shared, read-only, includes contact, and omits admin actions', () => {
  const html = activityWorkDrawerHtml({ RowID: '1', activity_name: 'סדנה', activity_type: 'סדנה', school: 'בית ספר', authority: 'רשות', contact_name: 'נועה', contact_phone: '0501234567' }, { instructorLimited: true, canEdit: false, canDirectEdit: false, canRequestEdit: false, canDeleteActivity: false, exportAction: false });
  assert.match(html, /נועה/);
  assert.doesNotMatch(html, /data-action="edit"|data-action="delete"|data-action="save"/);
});

test('reports is a placeholder and does not load completion approvals', () => {
  const source = fs.readFileSync(new URL('../frontend/src/screens/instructor-portal/reports.js', import.meta.url), 'utf8');
  assert.match(source, /האזור ייפתח בהמשך/);
  assert.doesNotMatch(source, /completion|approval/i);
});
