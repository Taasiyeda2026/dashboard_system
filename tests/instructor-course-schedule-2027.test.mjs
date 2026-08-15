import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import {
  isCourseReadyForWorkSchedule,
  buildReadyCourseScheduleRows,
  getCourseMeetingDates,
  getCourseFixedWeekday,
  getCourseReadyInstructorNames,
  sortReadyCourseScheduleRows,
  formatCourseScheduleRangeShort
} from '../frontend/src/screens/shared/instructor-course-schedule-2027.js';
import {
  sanitizePrintFileName,
  buildCourseSchedulePrintDocumentTitle,
  buildCourseSchedulePrintHtml,
  courseSchedulePrintCss
} from '../frontend/src/screens/shared/instructor-course-schedule-print.js';

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.sessionStorage = dom.window.sessionStorage;
  globalThis.CustomEvent = dom.window.CustomEvent;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;
  globalThis.alert = () => {};
  return dom;
}

setupDom();
const { operationsManagementScreen } = await import('../frontend/src/screens/operations-management.js');

// 14 weekly meetings starting 2026-09-06, all on the same weekday by construction.
function buildWeeklyDates(startIso, count) {
  const dates = [];
  const start = new Date(`${startIso}T12:00:00Z`);
  for (let i = 0; i < count; i += 1) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i * 7);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

const READY_DATES_14 = buildWeeklyDates('2026-09-06', 14);

function dateColumns(dates) {
  const out = {};
  dates.forEach((date, index) => { out[`date_${index + 1}`] = date; });
  return out;
}

function readyCourseFixture(overrides = {}) {
  const dates = overrides.__dates || READY_DATES_14;
  return {
    RowID: 'C2027-READY',
    activity_season: 'school_2027',
    activity_type: 'קורס',
    status: 'פתוח',
    activity_name: 'קורס רובוטיקה',
    authority: 'רשות א',
    school: 'בית ספר א',
    grade: 'ה',
    instructor_name: 'דני כהן',
    sessions: String(dates.length),
    start_date: dates[0],
    end_date: dates[dates.length - 1],
    start_time: '14:00',
    end_time: '15:30',
    ...dateColumns(dates),
    ...overrides
  };
}

test('a ready 2027 course with 14 sessions passes readiness and exposes exactly those 14 dates', () => {
  const activity = readyCourseFixture();
  assert.equal(isCourseReadyForWorkSchedule(activity), true);
  const dates = getCourseMeetingDates(activity);
  assert.equal(dates.length, 14);
  assert.deepEqual(dates, READY_DATES_14.slice().sort());
});

test('buildReadyCourseScheduleRows maps a ready course into one row with all 14 dates', () => {
  const rows = buildReadyCourseScheduleRows([readyCourseFixture()]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'קורס רובוטיקה');
  assert.equal(rows[0].sessionsCount, 14);
  assert.deepEqual(rows[0].dates, READY_DATES_14.slice().sort());
});

test('a course without any instructor is not ready and is excluded from the row list', () => {
  const activity = readyCourseFixture({ instructor_name: '', instructor_name_2: '' });
  assert.equal(isCourseReadyForWorkSchedule(activity), false);
  assert.equal(buildReadyCourseScheduleRows([activity]).length, 0);
});

test('placeholder instructor text values do not count as a real instructor', () => {
  assert.equal(isCourseReadyForWorkSchedule(readyCourseFixture({ instructor_name: 'טרם שובץ' })), false);
  assert.equal(isCourseReadyForWorkSchedule(readyCourseFixture({ instructor_name: 'ללא מדריך' })), false);
  assert.equal(isCourseReadyForWorkSchedule(readyCourseFixture({ instructor_name: 'לא משויך' })), false);
});

test('a course with only a secondary instructor is ready and included for that instructor', () => {
  const activity = readyCourseFixture({ instructor_name: '', instructor_name_2: 'אפרת אוחיון' });
  assert.equal(isCourseReadyForWorkSchedule(activity), true);
  assert.deepEqual(getCourseReadyInstructorNames(activity), ['אפרת אוחיון']);
  const rows = buildReadyCourseScheduleRows([activity]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].instructorNames, ['אפרת אוחיון']);
});

test('primary and secondary instructors are both kept when both are valid', () => {
  const activity = readyCourseFixture({ instructor_name: 'דני כהן', instructor_name_2: 'אפרת אוחיון' });
  assert.deepEqual(getCourseReadyInstructorNames(activity), ['דני כהן', 'אפרת אוחיון']);
});

test('13 actual dates with sessions declared as 14 is not ready', () => {
  const dates13 = READY_DATES_14.slice(0, 13);
  const activity = readyCourseFixture({ __dates: dates13, sessions: '14', end_date: dates13[dates13.length - 1] });
  assert.equal(isCourseReadyForWorkSchedule(activity), false);
});

test('a duplicated meeting date makes the course not ready', () => {
  const activity = readyCourseFixture();
  activity.date_2 = activity.date_1; // duplicate an existing date onto another meeting slot
  assert.equal(isCourseReadyForWorkSchedule(activity), false);
});

test('a course without start/end time is not ready', () => {
  assert.equal(isCourseReadyForWorkSchedule(readyCourseFixture({ start_time: '', end_time: '' })), false);
  assert.equal(isCourseReadyForWorkSchedule(readyCourseFixture({ start_time: '14:00', end_time: '' })), false);
  assert.equal(isCourseReadyForWorkSchedule(readyCourseFixture({ start_time: '', end_time: '15:30' })), false);
});

test('end time earlier than or equal to start time is not ready', () => {
  assert.equal(isCourseReadyForWorkSchedule(readyCourseFixture({ start_time: '15:30', end_time: '14:00' })), false);
  assert.equal(isCourseReadyForWorkSchedule(readyCourseFixture({ start_time: '14:00', end_time: '14:00' })), false);
});

test('a course without a school is not ready', () => {
  const activity = readyCourseFixture({ school: '', single_school_name: '', legacy_school: '', school_id: '', single_school_id: '', linked_schools_count: 0, linked_school_names: '' });
  assert.equal(isCourseReadyForWorkSchedule(activity), false);
});

test('a course without a course name or authority is not ready', () => {
  assert.equal(isCourseReadyForWorkSchedule(readyCourseFixture({ activity_name: '', name: '', title: '', program_name: '' })), false);
  assert.equal(isCourseReadyForWorkSchedule(readyCourseFixture({ authority: '', authority_name: '', legacy_authority: '' })), false);
});

test('start_date/end_date must match the actual first/last meeting date', () => {
  assert.equal(isCourseReadyForWorkSchedule(readyCourseFixture({ start_date: '2026-09-01' })), false);
  assert.equal(isCourseReadyForWorkSchedule(readyCourseFixture({ end_date: '2026-12-31' })), false);
});

test('a course from a different period (regular/summer_2026) is never considered ready', () => {
  const regular = readyCourseFixture({ activity_season: 'regular' });
  const summer = readyCourseFixture({ activity_season: 'summer_2026' });
  assert.equal(isCourseReadyForWorkSchedule(regular), false);
  assert.equal(isCourseReadyForWorkSchedule(summer), false);
  assert.equal(buildReadyCourseScheduleRows([regular, summer]).length, 0);
});

test('cancelled or deleted 2027 courses are excluded even if otherwise complete', () => {
  assert.equal(isCourseReadyForWorkSchedule(readyCourseFixture({ status: 'נמחק' })), false);
  assert.equal(isCourseReadyForWorkSchedule(readyCourseFixture({ status: 'בוטל' })), false);
});

test('non-course activity types (workshop) in school_2027 do not appear in the course schedule', () => {
  assert.equal(isCourseReadyForWorkSchedule(readyCourseFixture({ activity_type: 'workshop' })), false);
  assert.equal(isCourseReadyForWorkSchedule(readyCourseFixture({ activity_type: 'סדנה' })), false);
});

test('getCourseFixedWeekday returns the weekday only when every meeting shares it', () => {
  const weekly = getCourseMeetingDates(readyCourseFixture());
  const weekday = getCourseFixedWeekday(weekly);
  assert.notEqual(weekday, '');

  const mixed = [READY_DATES_14[0], '2026-09-08', '2026-09-21'];
  assert.equal(getCourseFixedWeekday(mixed), '');
  assert.equal(getCourseFixedWeekday([]), '');
});

test('sortReadyCourseScheduleRows orders by instructor then start date when no instructor is selected', () => {
  const rows = buildReadyCourseScheduleRows([
    readyCourseFixture({ RowID: 'B', instructor_name: 'רון', __dates: buildWeeklyDates('2026-10-04', 14), start_date: '2026-10-04', end_date: buildWeeklyDates('2026-10-04', 14).slice(-1)[0], sessions: '14' }),
    readyCourseFixture({ RowID: 'A1', instructor_name: 'דני', __dates: buildWeeklyDates('2026-11-01', 14), start_date: '2026-11-01', end_date: buildWeeklyDates('2026-11-01', 14).slice(-1)[0], sessions: '14' }),
    readyCourseFixture({ RowID: 'A2', instructor_name: 'דני', __dates: buildWeeklyDates('2026-09-06', 14), start_date: '2026-09-06', end_date: buildWeeklyDates('2026-09-06', 14).slice(-1)[0], sessions: '14' })
  ]);
  const sorted = sortReadyCourseScheduleRows(rows, { instructorSelected: false });
  assert.deepEqual(sorted.map((row) => row.activity.RowID), ['A2', 'A1', 'B']);
});

test('sortReadyCourseScheduleRows orders by start date only when an instructor is selected', () => {
  const rows = buildReadyCourseScheduleRows([
    readyCourseFixture({ RowID: 'LATE', instructor_name: 'דני', __dates: buildWeeklyDates('2026-11-01', 14), start_date: '2026-11-01', end_date: buildWeeklyDates('2026-11-01', 14).slice(-1)[0], sessions: '14' }),
    readyCourseFixture({ RowID: 'EARLY', instructor_name: 'דני', __dates: buildWeeklyDates('2026-09-06', 14), start_date: '2026-09-06', end_date: buildWeeklyDates('2026-09-06', 14).slice(-1)[0], sessions: '14' })
  ]);
  const sorted = sortReadyCourseScheduleRows(rows, { instructorSelected: true });
  assert.deepEqual(sorted.map((row) => row.activity.RowID), ['EARLY', 'LATE']);
});

test('formatCourseScheduleRangeShort formats a DD.MM.YY-DD.MM.YY range', () => {
  assert.equal(formatCourseScheduleRangeShort('2026-09-06', '2026-12-20'), '06.09.26-20.12.26');
  assert.equal(formatCourseScheduleRangeShort('', ''), '');
});

test('sanitizePrintFileName strips filesystem-unsafe characters', () => {
  assert.equal(sanitizePrintFileName('ישראל\\ישראלי/:*?"<>|'), 'ישראלישראלי');
  assert.equal(sanitizePrintFileName('  ישראל ישראלי  '), 'ישראל ישראלי');
});

test('buildCourseSchedulePrintDocumentTitle embeds the sanitized instructor name and the school year', () => {
  const title = buildCourseSchedulePrintDocumentTitle('ישראל ישראלי');
  assert.equal(title, 'סידור עבודה - ישראל ישראלי - תשפ״ז');
  assert.match(buildCourseSchedulePrintDocumentTitle('ישראל/ישראלי'), /^סידור עבודה - ישראלישראלי - תשפ״ז$/);
});

test('courseSchedulePrintCss declares A4 portrait, a compact two-column course header, date grid, and page-break avoidance', () => {
  const css = courseSchedulePrintCss();
  assert.match(css, /@page\{size:A4 portrait;margin:10mm\}/);
  assert.match(css, /\.cs-card__details\{[^}]*grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/);
  assert.match(css, /\.cs-dates-grid\{[^}]*grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(css, /\.cs-card\{[^}]*break-inside:avoid;page-break-inside:avoid/);
  assert.match(css, /\.cs-field__value\{[^}]*font-weight:400/);
  assert.match(css, /\.cs-field__value--featured\{font-weight:600\}/);
  assert.match(css, /\.cs-date\{[^}]*color:#263442;[^}]*font-weight:400/);
});

test('buildCourseSchedulePrintHtml renders the document header, separate course cards and unnumbered dates exactly once', () => {
  const rows = buildReadyCourseScheduleRows([readyCourseFixture()]);
  const html = buildCourseSchedulePrintHtml({ instructorName: 'דני כהן', rows });
  assert.match(html, /שם המדריך:<\/strong> <span>דני כהן<\/span>/);
  assert.equal((html.match(/סידור עבודה למדריך – תשפ״ז/g) || []).length, 1);
  assert.match(html, /<strong>סיכום:<\/strong> <span>מספר קורסים: 1 \| מספר מפגשים כולל: 14<\/span>/);
  assert.equal((html.match(/<article class="cs-card">/g) || []).length, 1);
  assert.match(html, /<span class="cs-field__label">שם הקורס:<\/span><span class="cs-field__value cs-field__value--featured">/);
  assert.match(html, /<span class="cs-field__label">שעות:<\/span><span class="cs-field__value">/);

  assert.doesNotMatch(html, /<ol\b|<li\b/);
  const datesGridHtml = html.match(/<div class="cs-dates-grid">([\s\S]*?)<\/div>/)?.[1] || '';
  const listedDates = [...datesGridHtml.matchAll(/<span class="cs-date">([^<]+)<\/span>/g)].map((m) => m[1]);
  assert.equal(listedDates.length, 14);
  assert.equal(new Set(listedDates).size, 14, 'every listed date should be unique');
  const expectedFormatted = READY_DATES_14.map((date) => {
    const [y, m, d] = date.split('-');
    return `${d}/${m}/${y}`;
  });
  assert.deepEqual(listedDates, expectedFormatted, 'dates list should be in chronological order');
});

test('buildCourseSchedulePrintHtml with no ready courses renders an empty card list without throwing', () => {
  const html = buildCourseSchedulePrintHtml({ instructorName: 'דני כהן', rows: [] });
  assert.match(html, /<strong>סיכום:<\/strong> <span>מספר קורסים: 0 \| מספר מפגשים כולל: 0<\/span>/);
  assert.doesNotMatch(html, /<article class="cs-card">/);
});

// --- data-ops-print click behavior end-to-end through operationsManagementScreen ---

function domTestState({ instructor = '' } = {}) {
  return {
    activityPeriodTab: 'school_2027',
    operationsManagement: {
      tab: 'instructors',
      context: 'instructors',
      period: 'school_2027',
      dateFrom: '2026-09-01',
      dateTo: '2027-08-31',
      instructor: '__all__',
      expandedWorkshop: '',
      expandedSchool: '',
      expandedCourseDates: {}
    },
    listFilters: {
      'operations-management': { q: '', appliedQ: '', status: 'פתוח', visibleCount: 200, instructor }
    }
  };
}

function renderAndBindPrintButton(rows, state) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  root.innerHTML = operationsManagementScreen.render({ rows, workshopStockMap: new Map() }, { state });
  operationsManagementScreen.bind({ root, data: {}, api: {}, state, rerender: () => {} });
  return root.querySelector('[data-ops-print]');
}

function captureAlerts() {
  const messages = [];
  globalThis.alert = (message) => messages.push(message);
  return messages;
}

test('printing is blocked with a guidance message when "all instructors" is selected', () => {
  const alerts = captureAlerts();
  const opened = [];
  window.open = (...args) => { opened.push(args); return undefined; };

  const state = domTestState({ instructor: '' });
  const printBtn = renderAndBindPrintButton([readyCourseFixture()], state);
  assert.ok(printBtn, 'print button should be rendered');
  printBtn.click();

  assert.deepEqual(alerts, ['יש לבחור מדריך לפני הדפסת סידור העבודה.']);
  assert.equal(opened.length, 0, 'window.open should not be called when no instructor is selected');
});

test('printing shows a not-found message when the selected instructor has no ready courses', () => {
  const alerts = captureAlerts();
  const opened = [];
  window.open = (...args) => { opened.push(args); return undefined; };

  // The instructor filter dropdown resets a selection that isn't among the raw
  // rows' instructor values back to "" (topFiltersHtml), so this must select a
  // real instructor whose only course fails readiness (here: a duplicate date) -
  // not a name that never appears in the data at all.
  const notReadyCourse = readyCourseFixture();
  notReadyCourse.date_2 = notReadyCourse.date_1;
  const state = domTestState({ instructor: 'דני כהן' });
  const printBtn = renderAndBindPrintButton([notReadyCourse], state);
  printBtn.click();

  assert.deepEqual(alerts, ['לא נמצאו קורסים מוכנים להדפסה עבור המדריך שנבחר.']);
  assert.equal(opened.length, 0);
});

test('printing a selected instructor with ready courses opens a window with the instructor name in the title and A4 CSS', () => {
  const alerts = captureAlerts();
  const written = {};
  window.open = () => ({
    document: {
      open() {},
      write(html) { written.html = html; },
      close() {}
    },
    focus() {},
    print() {}
  });

  const state = domTestState({ instructor: 'דני כהן' });
  const printBtn = renderAndBindPrintButton([readyCourseFixture()], state);
  printBtn.click();

  assert.deepEqual(alerts, []);
  assert.match(written.html || '', /<title>סידור עבודה - דני כהן - תשפ״ז<\/title>/);
  assert.match(written.html || '', /@page\{size:A4 portrait;margin:10mm\}/);
  assert.match(written.html || '', /grid-template-columns:repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
});

// jsdom + the print button's setTimeout(...print(), 250) can otherwise leave a
// handle open and hang the runner; force a clean exit once this file is done.
after(() => {
  setImmediate(() => process.exit(process.exitCode || 0));
});
