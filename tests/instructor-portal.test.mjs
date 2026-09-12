import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { instructorActivities, monthlyInstructorSummary, instructorScheduleRows } from '../frontend/src/screens/instructor-portal/portal-data.js';
import { INSTRUCTOR_CALENDAR_ACTIVE_PERIOD, clampInstructorCalendarMonth, instructorActivityEventsForDate, moveInstructorCalendarMonth, organizationalEventsForDate, organizationalCalendarDayLabel } from '../frontend/src/screens/instructor-portal/calendar-events.js';
import { courseScheduleTableHtml } from '../frontend/src/screens/shared/instructor-course-schedule-view.js';
import { activityWorkDrawerHtml } from '../frontend/src/screens/shared/activity-detail-html.js';
import { resolveSchool2027Contact, withResolvedSchool2027Contact } from '../frontend/src/screens/shared/school-2027-contact.js';
import { instructorActivityContact } from '../frontend/src/screens/instructor-portal/my-activities.js';
import { instructorDashboardScreen } from '../frontend/src/screens/instructor-portal/dashboard.js';
import { instructorMyActivitiesScreen } from '../frontend/src/screens/instructor-portal/my-activities.js';
import { instructorWorkScheduleScreen } from '../frontend/src/screens/instructor-portal/work-schedule.js';

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
  assert.doesNotMatch(source, /דורש תשומת לב|סיכום אישי, הפעילות הקרובה וקיצורי דרך/);
  const css = fs.readFileSync(new URL('../frontend/src/styles/main.css', import.meta.url), 'utf8');
  assert.match(css, /instructor-portal-shortcut\{[^}]*min-height:52px/);
  assert.match(css, /instructor-portal-dashboard \.ds-kpi\{[^}]*min-height:66px/);
  assert.doesNotMatch(css.match(/\.instructor-portal-focus\{[^}]+\}/)?.[0] || '', /gradient/);
});

test('instructor dashboard, activities, and work schedule render their approved DOM structures', () => {
  const activity = { RowID: 'one', emp_id: 'A-1', instructor_name: 'רות', activity_name: 'סדנה', activity_type: 'workshop', activity_season: 'school_2027', start_date: '2026-09-02', date_1: '2026-09-02', authority: 'רשות', school: 'בית ספר' };
  const dashboard = new JSDOM(instructorDashboardScreen.render({ rows: [activity] }, { state: stateA })).window.document;
  assert.ok(dashboard.querySelector('[data-portal-month]'));
  assert.ok(dashboard.querySelector('.instructor-portal-focus'));
  assert.equal(dashboard.querySelectorAll('.instructor-portal-shortcut').length, 5);
  assert.doesNotMatch(dashboard.body.textContent, /דורש תשומת לב|סיכום אישי/);

  const activities = new JSDOM(instructorMyActivitiesScreen.render({ rows: [activity] }, { state: stateA })).window.document;
  assert.ok(activities.querySelector('[data-portal-activity="one"]'));
  assert.ok(activities.querySelector('[data-open-work-schedule]'));

  const schedule = new JSDOM(instructorWorkScheduleScreen.render({ rows: [activity] }, { state: stateA })).window.document;
  assert.ok(schedule.querySelector('[data-instructor-schedule-print]'));
  assert.ok(schedule.querySelector('.ds-ops-course-schedule-table'));
  assert.doesNotMatch(schedule.body.textContent, /מדריך\/ים/);
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
  assert.match(operationSource, /courseScheduleTableHtml\(scheduleRows/);
  const html = courseScheduleTableHtml([{ key: 'one', name: 'קורס', authority: 'רשות', school: 'בית ספר', instructorNames: ['א'], weekday: 'ראשון', timeRange: '14:00–15:00', startDate: '2026-09-01', endDate: '2026-09-08', grade: 'ה', sessionsCount: 2, dates: ['2026-09-01', '2026-09-08'] }]);
  assert.match(html, /ds-ops-course-schedule-table/);
  assert.match(html, /data-ops-course-dates-toggle/);
  assert.match(html, /course-schedule-desktop/);
  assert.match(html, /course-schedule-mobile-card/);
  assert.match(html, /מדריך\/ים/);
  const instructorHtml = courseScheduleTableHtml([{ key: 'one', name: 'קורס', authority: 'רשות', school: 'בית ספר', instructorNames: ['א'], weekday: 'ראשון', timeRange: '14:00–15:00', startDate: '2026-09-01', endDate: '2026-09-08', grade: 'ה', dates: ['2026-09-01'] }], { showInstructorColumn: false });
  assert.doesNotMatch(instructorHtml, /מדריך\/ים|ds-ops-course-col--instructor/);
  assert.match(instructorHtml, /colspan="9"/);
});

test('portal calendar stays a seven-column grid with compact mobile day details', () => {
  const source = fs.readFileSync(new URL('../frontend/src/screens/instructor-portal/calendar.js', import.meta.url), 'utf8');
  const schoolCalendarUi = fs.readFileSync(new URL('../frontend/src/screens/shared/school-calendar-ui.js', import.meta.url), 'utf8');
  assert.match(source, /ds-cal-grid/);
  assert.match(source, /ds-interactive-card--day-cell|variant: 'day-cell'/);
  assert.match(source, /ui\?\.openDrawer/);
  assert.doesNotMatch(source, /חגים, חופשות, מועדים וימי הולדת מכל המגזרים/);
  assert.match(source, /loadInstructorActivities\(api\)/);
  assert.match(source, /instructorActivities\(data\?\.rows, state\)/);
  assert.equal(instructorActivityEventsForDate([{ RowID: 'mine', activity_name: 'פעילות שלי', date_1: '2026-09-08' }], '2026-09-08').length, 1);
  assert.match(source, /hasSchoolCalendar \? 'is-school-calendar-day'/);
  assert.match(source, /hasActivity \? 'has-instructor-activity'/);
  assert.match(source, /instr-calendar-activity-accordion/);
  assert.match(source, /api\.activityDetail/);
  assert.match(source, /activityWorkDrawerHtml/);
  assert.doesNotMatch(source, /meta:\s*events\.length|\$\{events\.length\} אירועים/);
  assert.doesNotMatch(organizationalCalendarDayLabel(instructorActivityEventsForDate([{ RowID: 'mine', activity_name: 'פעילות שלי', date_1: '2026-09-08' }], '2026-09-08')), /פעילות שלי/);
  assert.match(schoolCalendarUi, /isInstructorCalendarView\(\)/);
  assert.match(schoolCalendarUi, /if \(isInstructorCalendarView\(\)\) return false/);
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

test('instructor work schedule uses shared styling and shared reliable print template', () => {
  const source = fs.readFileSync(new URL('../frontend/src/screens/instructor-portal/work-schedule.js', import.meta.url), 'utf8');
  const operations = fs.readFileSync(new URL('../frontend/src/screens/operations-management.js', import.meta.url), 'utf8');
  const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const sharedCss = fs.readFileSync(new URL('../frontend/src/screens/shared/instructor-course-schedule.css', import.meta.url), 'utf8');
  assert.match(source, /courseScheduleTableHtml\(rows, \{ expandedDates, showInstructorColumn: false \}\)/);
  assert.match(source, /data-instructor-schedule-print/);
  assert.match(source, /openCourseSchedulePrintWindow\(\{ instructorName: currentInstructorName\(state\), rows \}\)/);
  assert.match(operations, /openCourseSchedulePrintWindow\(\{ instructorName, rows \}\)/);
  assert.doesNotMatch(operations, /\.ds-ops-mgmt-screen \.ds-ops-course-schedule-table \{/);
  assert.match(index, /instructor-course-schedule\.css/);
  assert.match(sharedCss, /ds-ops-course-schedule-table/);
  assert.match(sharedCss, /ds-ops-course-dates-toggle/);
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
  assert.match(css, /has-instructor-activity::after[^}]+background:var\(--ds-accent\)/);
});

test('capture-phase period switching also refuses instructor year changes', () => {
  const source = fs.readFileSync(new URL('../frontend/src/activity-period-selector-access-hotfix.js', import.meta.url), 'utf8');
  assert.match(source, /effectiveInitialPeriod/);
  assert.match(source, /role \|\| ''\)\.trim\(\) === 'instructor'/);
  assert.match(source, /setGlobalActivityPeriod\(ACTIVE_ACTIVITY_SEASON\)/);
});

test('instructor activity drawer is shared, read-only, includes contact, and omits admin actions', () => {
  const html = activityWorkDrawerHtml({ RowID: '1', activity_name: 'סדנה', activity_type: 'סדנה', activity_season: 'school_2027', school: 'בית ספר', authority: 'רשות', emp_id_2: 'A-1', instructor_name_2: 'רות', activity_manager: 'יעל', resolved_school_2027_contact: { name: 'נועה', phone: '0501234567', email: '', role: '' }, price: '900', funding: 'פנימי', funding_sources: [{ name: 'גפן' }] }, { settings: { dropdown_options: { contacts_instructor_users: [{ emp_id: 'A-1', full_name: 'רות', active: true }] } }, instructorLimited: true, currentInstructorIds: ['A-1'], currentInstructorName: 'רות', canEdit: false, canDirectEdit: false, canRequestEdit: false, canDeleteActivity: false, exportAction: false });
  assert.match(html, /נועה/);
  assert.doesNotMatch(html, /רות|מדריך\/ה|מדריכים/);
  assert.doesNotMatch(html, /מדריך לא תקף|מדריך לא קיים/);
  assert.match(html, /activity-drawer__section/);
  assert.match(html, /data-central-info-section/);
  assert.match(html, /יעל/);
  assert.doesNotMatch(html, /מחיר|גורם מימון|>מימון<|900|פנימי|גפן/);
  assert.doesNotMatch(html, /data-coordination-approval|data-scheduling-fields|data-contact-2027-(?:select|save-new|add-btn)|data-action="(?:edit|delete|save|remove-meeting|add-meeting)"/);
});

test('instructor and manager activity paths use the same shared contact result', () => {
  const contacts = [
    { id: '10', school_id: '7', contact_name: 'ראשונה', phone: '0500000001' },
    { id: '11', school_id: '7', contact_name: 'נבחרה', phone: '0500000002' }
  ];
  const cases = [
    { activity_season: 'school_2027', school_contact_id: '11', school_id: '7' },
    { activity_season: 'school_2027', school_contact_id: '', school_id: '7', contact_name: 'שמורה בפעילות', contact_phone: '0509999999', contact_email: 'saved@example.com' },
    { activity_season: 'school_2027', school_contact_id: '', school_id: '7' },
    { activity_season: 'school_2027', school_contact_id: 'missing', school_id: '7' }
  ];
  cases.forEach((activity) => {
    const manager = withResolvedSchool2027Contact(activity, contacts).resolved_school_2027_contact;
    const instructor = withResolvedSchool2027Contact(activity, contacts).resolved_school_2027_contact;
    assert.deepEqual(instructor, manager);
    assert.deepEqual(instructor, resolveSchool2027Contact(activity, contacts));
  });
  assert.equal(instructorActivityContact({ school_contact_name: 'חלופה אסורה', contact_name: 'חלופה נוספת' }), '');
});

test('my-data projection carries the persisted manager and exact contact id', () => {
  const source = fs.readFileSync(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
  assert.match(source, /INSTRUCTOR_PORTAL_ACTIVITY_COLUMNS[^;]+activity_manager,school_contact_id,contact_name,contact_phone,contact_email/);
  assert.match(source, /readAllActivitiesRowsSupabase\(\{ select: INSTRUCTOR_PORTAL_ACTIVITY_COLUMNS \}\)/);
  assert.match(source, /readContactsForSchool2027Activities\(instructorRows\)/);
  assert.match(source, /withResolvedSchool2027Contact\(row, contactRows\)/);
  assert.doesNotMatch(source, /withExactActivityContact/);
});

test('calendar lazy-loaded activity details rerun the shared layout pipeline', () => {
  const source = fs.readFileSync(new URL('../frontend/src/screens/instructor-portal/calendar.js', import.meta.url), 'utf8');
  assert.match(source, /target\.innerHTML = activityWorkDrawerHtml\([\s\S]+instructorLimited: true/);
  assert.match(source, /target\.innerHTML = activityWorkDrawerHtml\([\s\S]+applyActivityDrawerLayoutPipeline\(target, state\?\.clientSettings \|\| \{\}\)/);
});

test('reports is a placeholder and does not load completion approvals', () => {
  const source = fs.readFileSync(new URL('../frontend/src/screens/instructor-portal/reports.js', import.meta.url), 'utf8');
  assert.match(source, /האזור ייפתח בהמשך/);
  assert.doesNotMatch(source, /completion|approval/i);
});
