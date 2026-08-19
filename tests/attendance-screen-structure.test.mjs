import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const homeSource    = await readFile(new URL('../attendance/src/screens/home-screen.js',    import.meta.url), 'utf8');
const homeStyles    = await readFile(new URL('../attendance/src/styles/home-screen.css',    import.meta.url), 'utf8');
const reportsSource = await readFile(new URL('../attendance/src/screens/my-reports-screen.js', import.meta.url), 'utf8');
const newReportStyles = await readFile(new URL('../attendance/src/styles/new-report-screen.css', import.meta.url), 'utf8');
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

test('Attendance calendar shows TODAY highlight and activity content in cells', () => {
  assert.match(calSource, /av2-cal__cell--today/);
  assert.match(calSource, /av2-cal__event-pill/);
  assert.match(calSource, /av2-cal__today-badge/);
  assert.match(calSource, /onEmptyDayClick/);
});

test('Attendance New Report uses stacked form sections instead of 2x2 cards', () => {
  assert.match(newReportStyles, /\.av2-report__form\s*\{\s*display:\s*flex/);
  assert.match(newReportStyles, /\.av2-form-section__body--times/);
  assert.match(newReportStyles, /\.av2-form-section__body--bottom/);
});
