import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const homeSource    = await readFile(new URL('../attendance/src/screens/home-screen.js',    import.meta.url), 'utf8');
const homeStyles    = await readFile(new URL('../attendance/src/styles/home-screen.css',    import.meta.url), 'utf8');
const reportsSource = await readFile(new URL('../attendance/src/screens/my-reports-screen.js', import.meta.url), 'utf8');
const newReportSource = await readFile(new URL('../attendance/src/screens/new-report-screen.js', import.meta.url), 'utf8');
const newReportStyles = await readFile(new URL('../attendance/src/styles/new-report-screen.css', import.meta.url), 'utf8');
const newReportLayoutFix = await readFile(new URL('../attendance/src/styles/new-report-layout-fix.css', import.meta.url), 'utf8');
const reportsStyles = await readFile(new URL('../attendance/src/styles/my-reports-screen.css', import.meta.url), 'utf8');
const timePickerSource = await readFile(new URL('../attendance/src/components/time-picker.js', import.meta.url), 'utf8');
const activitiesServiceSource = await readFile(new URL('../attendance/src/services/activities.service.js', import.meta.url), 'utf8');
const attendanceSwSource = await readFile(new URL('../attendance/sw.js', import.meta.url), 'utf8');
const attendanceIndexSource = await readFile(new URL('../attendance/index.html', import.meta.url), 'utf8');
const calSource     = await readFile(new URL('../attendance/src/components/mini-calendar.js', import.meta.url), 'utf8');

test('Attendance Home is a clean dashboard without a calendar or report list', () => {
  // No calendar whatsoever on Home
  assert.doesNotMatch(homeSource, /createMiniCalendar|av2-home__calendar|renderCalendarSection/);
  // No individual report list / recent section
  assert.doesNotMatch(homeSource, /renderRecentList|av2-home__recent|av2-home__report-list/);
  // Has the status area and compact action strip
  assert.match(homeSource, /av2-home__status-area/);
  assert.match(homeSource, /av2-home__action-strip/);
  // No calendar CSS on Home
  assert.doesNotMatch(homeStyles, /av2-home__calendar|av2-cal--home/);
  // Has compact KPI grid
  assert.match(homeStyles, /av2-stats-grid/);
});

test('Attendance My Reports owns the calendar above the report list', () => {
  const calendarIndex    = reportsSource.indexOf('av2-reports__calendar-wrap');
  const reportListIndex  = reportsSource.indexOf('av2-report-list');
  assert.notEqual(calendarIndex,   -1, 'calendar-wrap class missing');
  assert.notEqual(reportListIndex, -1, 'report-list class missing');
  assert.ok(calendarIndex < reportListIndex, 'calendar must render before the reports table');
});

test('Attendance My Reports table has all required columns', () => {
  // All 11 column cells present as class names
  for (const cls of ['av2-rr__date','av2-rr__start','av2-rr__end','av2-rr__hours',
                      'av2-rr__type','av2-rr__name','av2-rr__school','av2-rr__authority',
                      'av2-rr__km','av2-rr__expenses','av2-rr__actions']) {
    assert.match(reportsSource, new RegExp(cls), `missing column class ${cls}`);
  }
  // Records sorted date DESC
  assert.match(reportsSource, /report_date.*localeCompare|localeCompare.*report_date/);
  // Action colour classes
  assert.match(reportsSource, /av2-rr__action-copy/);
  assert.match(reportsSource, /av2-rr__action-dup/);
  assert.match(reportsSource, /av2-rr__action-delete/);
});

test('Attendance report-day filtering uses report_date and hides non-matching grid rows', () => {
  assert.match(reportsSource, /rowEntries\.push\(\{ row, reportDate: record\.report_date \}\)/);
  assert.match(reportsSource, /row\.hidden = selectedDate \? reportDate !== selectedDate : false/);
  assert.match(reportsStyles, /\.av2-report-row\[hidden\]\s*\{\s*display:\s*none\s*!important/);
});

test('Attendance report actions and expenses use distinct accessible indicators', () => {
  assert.match(reportsSource, /aria-label', 'העתק פרטי דיווח'/);
  assert.match(reportsSource, /aria-label', 'שכפל דיווח'/);
  assert.match(reportsSource, /createIcon\('copy'/);
  assert.match(reportsSource, /createIcon\('duplicate'/);
  assert.match(reportsSource, /createIcon\('receipt'/);
  assert.match(reportsSource, /if \(expenseAmount > 0\)/);
  assert.match(reportsSource, /classList\.toggle\('is-revealed'\)/);
});

test('shared Attendance time picker uses compact numeric placeholders', () => {
  assert.doesNotMatch(timePickerSource, /placeholder: 'שע׳'|placeholder: 'דק׳'/);
  assert.match(timePickerSource, /placeholder: '--'/);
  assert.match(newReportStyles, /\.av2-time-picker__part\s*\{[^}]*width:\s*64px/);
  assert.match(newReportStyles, /\.av2-time-picker__sep\s*\{[^}]*justify-content:\s*center/);
});

test('Attendance calendar shows TODAY highlight and activity content in cells', () => {
  assert.match(calSource, /av2-cal__cell--today/);
  assert.match(calSource, /av2-cal__event-pill/);
  assert.match(calSource, /av2-cal__today-badge/);
  assert.match(calSource, /onEmptyDayClick/);
});

test('Attendance New Report uses three desktop columns and instructor activity IDs', () => {
  assert.match(newReportStyles, /\.av2-report__form\s*\{/);
  assert.match(newReportStyles, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(newReportStyles, /\.av2-form-section__body--times/);
  assert.match(newReportStyles, /\.av2-form-section__body--bottom/);
  assert.doesNotMatch(newReportLayoutFix, /av2-planned-activity/);
  assert.match(newReportSource, /deriveAuthoritySchoolListFromActivities/);
  assert.match(newReportSource, /getInstructorActivities/);
  assert.doesNotMatch(newReportSource, /getInstructorActivitiesForDate/);
  assert.match(newReportSource, /ONLINE_REPORT_TYPE/);
  assert.match(newReportSource, /syncKmForReportType/);
  assert.match(newReportSource, /getAllAuthoritySchoolList/);
  assert.doesNotMatch(newReportSource, /getActivityNamesByType/);
  assert.doesNotMatch(newReportSource, /av2-planned-activity/);
  assert.match(newReportSource, /instructorActivitySelectOptions/);
  assert.match(activitiesServiceSource, /instructorActivitySelectOptions/);
  assert.match(attendanceSwSource, /const CACHE_VERSION = 42;/);
  assert.match(attendanceIndexSource, /\?v=42/);
});

test('Attendance New Report keeps mobile fields inside padded page gutters', () => {
  assert.match(newReportLayoutFix, /@media \(max-width: 639px\)/);
  assert.match(newReportLayoutFix, /\.av2-report__inner\s*\{[\s\S]*padding-inline:\s*20px\s*!important/);
  assert.match(newReportLayoutFix, /\.av2-field__input,[\s\S]*width:\s*100%/);
  assert.match(newReportLayoutFix, /min-width:\s*0/);
  assert.match(newReportLayoutFix, /max-width:\s*100%/);
});
