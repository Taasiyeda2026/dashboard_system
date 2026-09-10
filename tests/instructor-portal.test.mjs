import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { instructorActivities, monthlyInstructorSummary, instructorScheduleRows } from '../frontend/src/screens/instructor-portal/portal-data.js';
import { INSTRUCTOR_CALENDAR_ACTIVE_PERIOD, clampInstructorCalendarMonth, instructorActivityEventsForDate, moveInstructorCalendarMonth, organizationalEventsForDate, organizationalCalendarDayLabel } from '../frontend/src/screens/instructor-portal/calendar-events.js';
import { courseScheduleTableHtml } from '../frontend/src/screens/shared/instructor-course-schedule-view.js';
import { activityWorkDrawerHtml } from '../frontend/src/screens/shared/activity-detail-html.js';

const stateA = { user: { emp_id: 'A-1', role: 'instructor' } };
const basicRows = [
  { RowID: 'one', emp_id: 'A-1', activity_name: 'של א', activity_type: 'סדנה', start_date: '2026-09-02' },
  { RowID: 'two', emp_id: 'B-1', activity_name: 'של ב', activity_type: 'קורס', start_date: '2026-09-03' },
  { RowID: 'three', emp_id: 'B-1', emp_id_2: 'A-1', activity_name: 'מדריך שני', activity_type: 'סדנה', start_date: '2026-09-04' }
];

test('dashboard defines title-only shortcuts without a separate work schedule card', () => {
  const source = fs.readFileSync(new URL('../frontend/src/screens/instructor-portal/dashboard.js', import.meta.url), 'utf8');
  assert.equal((source.match(/action: '/g) || []).length, 5);
  for (const label of ['לוח שנה', 'מערכת נוכחות', 'מצגות', 'דיווחים', 'הפעילויות שלי']) assert.match(source, new RegExp(label));
  assert.doesNotMatch(source, /title: 'סידור עבודה'/);
  assert.doesNotMatch(source, /subtitle:/);
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

test('organizational calendar hides sectors while preserving distinct events and birthdays', () => {
  const sectors = ['general', 'jewish', 'arab', 'druze'];
  const rows = sectors.map((calendar_sector) => ({ start_date: '2026-09-08', end_date: '2026-09-08', title: calendar_sector, category: 'holiday', calendar_sector, is_active: true }));
  const events = organizationalEventsForDate(rows, [{ employee_name: 'נועה', birth_month: 9, birth_day: 8 }], '2026-09-08');
  assert.equal(events.length, 5);
  sectors.forEach((sector) => assert.ok(events.some((event) => event.title === sector)));
  events.forEach((event) => assert.doesNotMatch(event.displayTitle, /יהודי|ערבי|דרוזי/));
  assert.match(organizationalCalendarDayLabel(events), /יום הולדת לנועה/);
});

test('organizational calendar consolidates only equivalent cross-sector occurrences', () => {
  const base = { start_date: '2026-12-24', end_date: '2027-01-08', title: 'חופשת חורף', category: 'חופשה', day_status: 'חופשה', is_active: true };
  const rows = [
    { ...base, external_key: 'ARAB-WINTER', calendar_sector: 'arab' },
    { ...base, external_key: 'DRUZE-WINTER', calendar_sector: 'druze' },
    { ...base, external_key: 'OTHER', calendar_sector: 'general', title: 'אירוע אחר' }
  ];
  const birthdays = [{ employee_name: 'נועה', birth_month: 12, birth_day: 24 }, { employee_name: 'רוני', birth_month: 12, birth_day: 24 }];
  const events = organizationalEventsForDate(rows, birthdays, '2026-12-24');
  assert.deepEqual(events.map((event) => event.displayTitle), ['אירוע אחר', 'חופשת חורף', '🎂 יום הולדת לנועה', '🎂 יום הולדת לרוני']);
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
  assert.doesNotMatch(source, /חגים, חופשות, מועדים וימי הולדת מכל המגזרים/);
  assert.match(source, /events\.length > 1/);
  assert.match(source, /loadInstructorActivities\(api\)/);
  assert.match(source, /instructorActivities\(data\?\.rows, state\)/);
  assert.equal(instructorActivityEventsForDate([{ RowID: 'mine', activity_name: 'פעילות שלי', date_1: '2026-09-08' }], '2026-09-08').length, 1);
  assert.match(source, /hasSchoolCalendar \? 'is-school-calendar-day'/);
  assert.match(source, /hasActivity \? 'has-instructor-activity'/);
});

test('instructor calendar navigation follows the active school season across calendar years', () => {
  assert.equal(INSTRUCTOR_CALENDAR_ACTIVE_PERIOD, 'school_2027');
  assert.equal(moveInstructorCalendarMonth('2026-09', -1), '2026-09');
  assert.equal(moveInstructorCalendarMonth('2026-09', 1), '2026-10');
  assert.equal(moveInstructorCalendarMonth('2026-11', 1), '2026-12');
  assert.equal(moveInstructorCalendarMonth('2026-12', 1), '2027-01');
  assert.equal(moveInstructorCalendarMonth('2027-01', 1), '2027-02');
  assert.equal(moveInstructorCalendarMonth('2027-07', 1), '2027-08');
  assert.equal(moveInstructorCalendarMonth('2027-08', 1), '2027-08');
  assert.equal(clampInstructorCalendarMonth('2026-08'), '2026-09');
  assert.equal(clampInstructorCalendarMonth('2027-09'), '2027-08');
});

test('my activities provides mobile cards that open the shared activity drawer', () => {
  const source = fs.readFileSync(new URL('../frontend/src/screens/instructor-portal/my-activities.js', import.meta.url), 'utf8');
  assert.match(source, /portal-activities-mobile/);
  assert.match(source, /portal-activity-card/);
  assert.match(source, /activityWorkDrawerHtml/);
  assert.match(source, /data-open-work-schedule/);
  assert.doesNotMatch(source, /<th>סוג<\/th>/);
});

test('instructor navigation keeps portal areas and omits approvals and guidelines from visible nav', () => {
  const source = fs.readFileSync(new URL('../frontend/src/main.js', import.meta.url), 'utf8');
  const sidebar = source.slice(source.indexOf('const instructorSidebarItems'), source.indexOf('const regularNav'));
  assert.doesNotMatch(sidebar, /instructor-completion-approvals|instructor-guidelines/);
  assert.match(sidebar, /instructor-dashboard/);
  assert.match(sidebar, /my-data/);
  assert.doesNotMatch(sidebar, /instructor-work-schedule/);
  assert.ok(sidebar.indexOf('instructor-dashboard') < sidebar.indexOf('my-data'));
  const mobile = source.slice(source.indexOf('const INSTRUCTOR_MOBILE_NAV'), source.indexOf('function instructorBottomNavHtml'));
  assert.ok(mobile.indexOf('instructor-dashboard') < mobile.indexOf('my-data'));
  assert.doesNotMatch(mobile, /instructor-work-schedule/);
  for (const route of ['instructor-calendar', 'instructor-reports']) assert.match(mobile, new RegExp(route));
  assert.match(source, /resolveInitialAuthenticatedRoute/);
  assert.match(source, /role \|\| ''\)\.trim\(\) === 'instructor'.*instructor-dashboard/s);
  assert.match(source, /isInstructorUser \? '' : `<div class="shell-period-wrap"/);
});

test('instructor attendance URL targets the deployed dashboard attendance path', () => {
  const source = fs.readFileSync(new URL('../frontend/src/config.js', import.meta.url), 'utf8');
  assert.match(source, /https:\/\/taasiyeda2026\.github\.io\/dashboard_system\/attendance\//);
});

test('instructor calendar wrapping and birthday decoration are role scoped', () => {
  const css = fs.readFileSync(new URL('../frontend/src/styles/main.css', import.meta.url), 'utf8');
  const birthdays = fs.readFileSync(new URL('../frontend/src/birthday-calendar.js', import.meta.url), 'utf8');
  assert.match(css, /route-instructor-calendar[^}]+ds-interactive-card__subtitle[^}]+white-space:normal/);
  assert.match(css, /instructor-activity-drawer-shell \.activity-drawer__section/);
  assert.match(birthdays, /app-shell--instructor\.route-instructor-calendar/);
});

test('capture-phase period switching also refuses instructor year changes', () => {
  const source = fs.readFileSync(new URL('../frontend/src/activity-period-selector-access-hotfix.js', import.meta.url), 'utf8');
  assert.match(source, /effectiveInitialPeriod/);
  assert.match(source, /role \|\| ''\)\.trim\(\) === 'instructor'/);
  assert.match(source, /setGlobalActivityPeriod\(ACTIVE_ACTIVITY_SEASON\)/);
});

test('instructor activity drawer is shared, read-only, includes contact, and omits admin actions', () => {
  const html = activityWorkDrawerHtml({ RowID: '1', activity_name: 'סדנה', activity_type: 'סדנה', activity_season: 'school_2027', school: 'בית ספר', authority: 'רשות', emp_id_2: 'A-1', resolved_contact_name: 'נועה', resolved_contact_phone: '0501234567', price: '900', funding: 'פנימי' }, { instructorLimited: true, currentInstructorIds: ['A-1'], currentInstructorName: 'רות', canEdit: false, canDirectEdit: false, canRequestEdit: false, canDeleteActivity: false, exportAction: false });
  assert.match(html, /נועה/);
  assert.match(html, /רות/);
  assert.doesNotMatch(html, /מדריך לא תקף|מדריך לא קיים/);
  assert.match(html, /activity-drawer__section/);
  assert.match(html, /data-central-info-section/);
  assert.doesNotMatch(html, /data-action="edit"|data-action="delete"|data-action="save"/);
});

test('reports is a placeholder and does not load completion approvals', () => {
  const source = fs.readFileSync(new URL('../frontend/src/screens/instructor-portal/reports.js', import.meta.url), 'utf8');
  assert.match(source, /האזור ייפתח בהמשך/);
  assert.doesNotMatch(source, /completion|approval/i);
});
