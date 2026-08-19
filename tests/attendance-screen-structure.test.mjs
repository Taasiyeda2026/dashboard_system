import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const homeSource = await readFile(new URL('../attendance/src/screens/home-screen.js', import.meta.url), 'utf8');
const homeStyles = await readFile(new URL('../attendance/src/styles/home-screen.css', import.meta.url), 'utf8');
const reportsSource = await readFile(new URL('../attendance/src/screens/my-reports-screen.js', import.meta.url), 'utf8');
const newReportStyles = await readFile(new URL('../attendance/src/styles/new-report-screen.css', import.meta.url), 'utf8');
const referenceRuntime = await readFile(new URL('../attendance/src/reference-data-layout.js', import.meta.url), 'utf8');
const mainSource = await readFile(new URL('../attendance/src/main.js', import.meta.url), 'utf8');

test('Attendance Home is a dashboard without a calendar', () => {
  assert.doesNotMatch(homeSource, /createMiniCalendar|av2-home__calendar|renderCalendarSection/);
  assert.match(homeSource, /av2-home__status-area/);
  assert.doesNotMatch(homeStyles, /av2-home__calendar|av2-cal--home/);
});

test('Attendance Home desktop summary groups by activity type with three equal columns', () => {
  assert.match(referenceRuntime, /record\.activity_type\s*\|\|\s*record\.activity_name_snapshot/);
  assert.match(referenceRuntime, /\['סוג פעילות', 'סה״כ שעות', 'סה״כ קילומטר'\]/);
  assert.match(referenceRuntime, /grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
});

test('Attendance My Reports owns the calendar above the report list', () => {
  const calendarIndex = reportsSource.indexOf('av2-reports__calendar-wrap');
  const reportListIndex = reportsSource.indexOf('av2-report-list');
  assert.notEqual(calendarIndex, -1);
  assert.notEqual(reportListIndex, -1);
  assert.ok(calendarIndex < reportListIndex, 'calendar must render before the reports table');
});

test('Attendance My Reports desktop reference table has nine equal data columns', () => {
  assert.match(referenceRuntime, /\['תאריך', 'שעת התחלה', 'שעת סיום', 'סה״כ שעות', 'פעילות', 'בית ספר', 'רשות', 'ק״מ', 'פעולות'\]/);
  assert.match(referenceRuntime, /grid-template-columns:\s*repeat\(9, minmax\(0, 1fr\)\)/);
  assert.match(referenceRuntime, /av2-reports__calendar-wrap \{ max-width: 690px/);
});

test('Attendance New Report keeps its compact desktop 2x2 form grid', () => {
  assert.match(newReportStyles, /@media \(min-width: 768px\)/);
  assert.match(newReportStyles, /\.av2-report__form\s*\{\s*grid-template-columns:\s*repeat\(2/);
});

test('Attendance starts the reference data layout runtime', () => {
  assert.match(mainSource, /startReferenceDataLayout/);
});
