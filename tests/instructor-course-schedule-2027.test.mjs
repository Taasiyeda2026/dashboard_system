import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import {
  isActivityAssignedForWorkSchedule,
  buildInstructorWorkScheduleRows,
  getWorkScheduleDates,
  getWorkScheduleFixedWeekday,
  getWorkScheduleInstructorNames,
  sortInstructorWorkScheduleRows,
  formatWorkScheduleRangeShort
} from '../frontend/src/screens/shared/instructor-course-schedule-2027.js';
import {
  sanitizePrintFileName,
  buildCourseSchedulePrintDocumentTitle,
  buildCourseSchedulePrintHtml,
  courseSchedulePrintCss,
  openCourseSchedulePrintWindow
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
  const dates = Object.prototype.hasOwnProperty.call(overrides, '__dates') ? overrides.__dates : READY_DATES_14;
  return {
    RowID: 'C2027-READY',
    activity_season: 'school_2027',
    activity_type: 'קורס',
    status: 'פתוח',
    activity_name: 'קורס רובוטיקה',
    authority: 'רשות א',
    school: 'בית ספר א',
    grade: 'ה',
    contact_name: 'נועה לוי',
    contact_phone: '050-1234567',
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

test('a school_2027 activity with an instructor and dates is included', () => {
  const activity = readyCourseFixture();
  assert.equal(isActivityAssignedForWorkSchedule(activity), true);
  const dates = getWorkScheduleDates(activity);
  assert.equal(dates.length, 14);
  assert.deepEqual(dates, READY_DATES_14.slice().sort());
});

test('buildInstructorWorkScheduleRows maps a ready course into one row with all 14 dates', () => {
  const rows = buildInstructorWorkScheduleRows([readyCourseFixture()]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'קורס רובוטיקה');
  assert.equal(rows[0].activityType, 'קורס');
  assert.equal(rows[0].sessionsCount, 14);
  assert.equal(rows[0].contactName, 'נועה לוי');
  assert.equal(rows[0].contactPhone, '050-1234567');
  assert.deepEqual(rows[0].dates, READY_DATES_14.slice().sort());
});

test('an activity without a real instructor is excluded from the work schedule', () => {
  const activity = readyCourseFixture({ instructor_name: '', instructor_name_2: '' });
  assert.equal(isActivityAssignedForWorkSchedule(activity), false);
  assert.equal(buildInstructorWorkScheduleRows([activity]).length, 0);
});

test('placeholder instructor text values do not count as a real instructor', () => {
  assert.equal(isActivityAssignedForWorkSchedule(readyCourseFixture({ instructor_name: 'טרם שובץ' })), false);
  assert.equal(isActivityAssignedForWorkSchedule(readyCourseFixture({ instructor_name: 'ללא מדריך' })), false);
  assert.equal(isActivityAssignedForWorkSchedule(readyCourseFixture({ instructor_name: 'לא משויך' })), false);
});

test('an activity assigned only through instructor_name_2 is included for that instructor', () => {
  const activity = readyCourseFixture({ instructor_name: '', instructor_name_2: 'אפרת אוחיון' });
  assert.equal(isActivityAssignedForWorkSchedule(activity), true);
  assert.deepEqual(getWorkScheduleInstructorNames(activity), ['אפרת אוחיון']);
  const rows = buildInstructorWorkScheduleRows([activity]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].instructorNames, ['אפרת אוחיון']);
});

test('primary and secondary instructors are both kept when both are valid', () => {
  const activity = readyCourseFixture({ instructor_name: 'דני כהן', instructor_name_2: 'אפרת אוחיון' });
  assert.deepEqual(getWorkScheduleInstructorNames(activity), ['דני כהן', 'אפרת אוחיון']);
});

test('a sessions mismatch does not exclude an assigned dated activity', () => {
  const dates13 = READY_DATES_14.slice(0, 13);
  const activity = readyCourseFixture({ __dates: dates13, sessions: '14', end_date: dates13[dates13.length - 1] });
  assert.equal(isActivityAssignedForWorkSchedule(activity), true);
});

test('duplicate activity dates do not exclude an otherwise eligible activity', () => {
  const activity = readyCourseFixture();
  activity.date_2 = activity.date_1; // duplicate an existing date onto another meeting slot
  assert.equal(isActivityAssignedForWorkSchedule(activity), true);
});

test('an activity without hours is included and renders an empty time value', () => {
  const rows = buildInstructorWorkScheduleRows([readyCourseFixture({ start_time: '', end_time: '' })]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].timeRange, '');
});

test('an activity without a school or authority is included with fallback display values', () => {
  const activity = readyCourseFixture({ school: '', single_school_name: '', legacy_school: '', school_id: '', single_school_id: '', linked_schools_count: 0, linked_school_names: '' });
  activity.authority = '';
  const rows = buildInstructorWorkScheduleRows([activity]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].school, '');
  assert.equal(rows[0].authority, '');
});

test('missing or mismatched start_date/end_date does not exclude activity dates', () => {
  assert.equal(isActivityAssignedForWorkSchedule(readyCourseFixture({ start_date: '', end_date: '' })), true);
  assert.equal(isActivityAssignedForWorkSchedule(readyCourseFixture({ start_date: '2026-09-01', end_date: '2026-12-31' })), true);
});

test('a course from a different period (regular/summer_2026) is never considered ready', () => {
  const regular = readyCourseFixture({ activity_season: 'regular' });
  const summer = readyCourseFixture({ activity_season: 'summer_2026' });
  assert.equal(isActivityAssignedForWorkSchedule(regular), false);
  assert.equal(isActivityAssignedForWorkSchedule(summer), false);
  assert.equal(buildInstructorWorkScheduleRows([regular, summer]).length, 0);
});

test('status does not add an eligibility rule to the work schedule', () => {
  assert.equal(isActivityAssignedForWorkSchedule(readyCourseFixture({ status: 'נמחק' })), true);
  assert.equal(isActivityAssignedForWorkSchedule(readyCourseFixture({ status: 'בוטל' })), true);
});

test('workshop, tour, after_school and escape_room activities are all included', () => {
  const types = ['workshop', 'tour', 'after_school', 'escape_room'];
  const rows = buildInstructorWorkScheduleRows(types.map((activityType, index) => readyCourseFixture({
    RowID: `TYPE-${index}`,
    activity_type: activityType,
    activity_name: activityType
  })));
  assert.deepEqual(rows.map((row) => row.activity.activity_type), types);
  assert.deepEqual(rows.map((row) => row.activityType), ['סדנה', 'סיור', 'חוג אפטרסקול', 'חדר בריחה']);
});

test('a course with sessions null is included when it has an instructor and date', () => {
  assert.equal(isActivityAssignedForWorkSchedule(readyCourseFixture({ sessions: null })), true);
});

test('an activity without a valid date is excluded', () => {
  const activity = readyCourseFixture({ __dates: [], start_date: '', end_date: '' });
  assert.equal(isActivityAssignedForWorkSchedule(activity), false);
  assert.equal(buildInstructorWorkScheduleRows([activity]).length, 0);
});

test('getWorkScheduleFixedWeekday returns the weekday only when every meeting shares it', () => {
  const weekly = getWorkScheduleDates(readyCourseFixture());
  const weekday = getWorkScheduleFixedWeekday(weekly);
  assert.notEqual(weekday, '');

  const mixed = [READY_DATES_14[0], '2026-09-08', '2026-09-21'];
  assert.equal(getWorkScheduleFixedWeekday(mixed), '');
  assert.equal(getWorkScheduleFixedWeekday([]), '');
});

test('sortInstructorWorkScheduleRows orders by instructor then start date when no instructor is selected', () => {
  const rows = buildInstructorWorkScheduleRows([
    readyCourseFixture({ RowID: 'B', instructor_name: 'רון', __dates: buildWeeklyDates('2026-10-04', 14), start_date: '2026-10-04', end_date: buildWeeklyDates('2026-10-04', 14).slice(-1)[0], sessions: '14' }),
    readyCourseFixture({ RowID: 'A1', instructor_name: 'דני', __dates: buildWeeklyDates('2026-11-01', 14), start_date: '2026-11-01', end_date: buildWeeklyDates('2026-11-01', 14).slice(-1)[0], sessions: '14' }),
    readyCourseFixture({ RowID: 'A2', instructor_name: 'דני', __dates: buildWeeklyDates('2026-09-06', 14), start_date: '2026-09-06', end_date: buildWeeklyDates('2026-09-06', 14).slice(-1)[0], sessions: '14' })
  ]);
  const sorted = sortInstructorWorkScheduleRows(rows, { instructorSelected: false });
  assert.deepEqual(sorted.map((row) => row.activity.RowID), ['A2', 'A1', 'B']);
});

test('sortInstructorWorkScheduleRows orders by start date only when an instructor is selected', () => {
  const rows = buildInstructorWorkScheduleRows([
    readyCourseFixture({ RowID: 'LATE', instructor_name: 'דני', __dates: buildWeeklyDates('2026-11-01', 14), start_date: '2026-11-01', end_date: buildWeeklyDates('2026-11-01', 14).slice(-1)[0], sessions: '14' }),
    readyCourseFixture({ RowID: 'EARLY', instructor_name: 'דני', __dates: buildWeeklyDates('2026-09-06', 14), start_date: '2026-09-06', end_date: buildWeeklyDates('2026-09-06', 14).slice(-1)[0], sessions: '14' })
  ]);
  const sorted = sortInstructorWorkScheduleRows(rows, { instructorSelected: true });
  assert.deepEqual(sorted.map((row) => row.activity.RowID), ['EARLY', 'LATE']);
});

test('formatWorkScheduleRangeShort formats a DD.MM.YY-DD.MM.YY range', () => {
  assert.equal(formatWorkScheduleRangeShort('2026-09-06', '2026-12-20'), '06.09.26-20.12.26');
  assert.equal(formatWorkScheduleRangeShort('', ''), '');
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

test('courseSchedulePrintCss declares A4 portrait, a compact three-column course header, regular values, no negative letter spacing, date grid, and page-break avoidance', () => {
  const css = courseSchedulePrintCss();
  assert.match(css, /@page\{size:A4 portrait;margin:10mm\}/);
  assert.match(css, /\.cs-card__details\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /\.cs-dates-grid\{[^}]*grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(css, /\.cs-card\{[^}]*break-inside:avoid;page-break-inside:avoid/);
  assert.match(css, /\.cs-field__value\{[^}]*font-weight:400/);
  assert.doesNotMatch(css, /letter-spacing\s*:\s*-/);
  assert.doesNotMatch(css, /cs-field__value--featured/);
  assert.match(css, /\.cs-date\{[^}]*color:#263442;[^}]*font-weight:400/);
});

test('buildCourseSchedulePrintHtml renders the document header, separate course cards and unnumbered dates exactly once', () => {
  const rows = buildInstructorWorkScheduleRows([readyCourseFixture()]);
  const html = buildCourseSchedulePrintHtml({ instructorName: 'דני כהן', rows });
  assert.match(html, /שם המדריך:<\/strong> <span>דני כהן<\/span>/);
  assert.equal((html.match(/סידור עבודה - תשפ"ז/g) || []).length, 1);
  assert.match(html, /<h1 class="cs-print-title">סידור עבודה - תשפ"ז<\/h1>/);
  assert.match(html, /<strong>סיכום:<\/strong> <span>מספר פעילויות: 1 \| מספר תאריכים כולל: 14<\/span>/);
  assert.equal((html.match(/<article class="cs-card">/g) || []).length, 1);
  assert.match(html, /<span class="cs-field__label">שם הפעילות:<\/span><span class="cs-field__value">קורס רובוטיקה<\/span>/);
  assert.match(html, /<span class="cs-field__label">סוג פעילות:<\/span><span class="cs-field__value">קורס<\/span>/);
  assert.match(html, /פרטי איש קשר/);
  assert.match(html, /שם איש הקשר:<\/span><span class="cs-field__value">נועה לוי/);
  assert.match(html, /טלפון איש הקשר:<\/span><span class="cs-field__value">050-1234567/);
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

test('buildCourseSchedulePrintHtml with no activities renders an empty card list without throwing', () => {
  const html = buildCourseSchedulePrintHtml({ instructorName: 'דני כהן', rows: [] });
  assert.match(html, /<strong>סיכום:<\/strong> <span>מספר פעילויות: 0 \| מספר תאריכים כולל: 0<\/span>/);
  assert.doesNotMatch(html, /<article class="cs-card">/);
});

test('shared course schedule print window uses the canonical template, CSS, and font-ready reliability', async () => {
  const rows = buildInstructorWorkScheduleRows([readyCourseFixture()]);
  let written = '';
  let prints = 0;
  const popup = {
    closed: false,
    document: { readyState: 'complete', fonts: { ready: Promise.resolve() }, open() {}, write(value) { written = value; }, close() {} },
    focus() {},
    print() { prints += 1; },
    requestAnimationFrame(callback) { callback(); }
  };
  const opened = openCourseSchedulePrintWindow({ instructorName: 'דני כהן', rows, win: { open: () => popup } });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(opened, popup);
  assert.match(written, new RegExp(buildCourseSchedulePrintDocumentTitle('דני כהן')));
  assert.ok(written.includes(buildCourseSchedulePrintHtml({ instructorName: 'דני כהן', rows })));
  assert.ok(written.includes(courseSchedulePrintCss()));
  assert.equal(prints, 1);
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
      scheduleHasLoaded: true,
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

test('manager instructor filter includes an activity assigned only in instructor_name_2', () => {
  const state = domTestState({ instructor: 'אפרת אוחיון' });
  const secondary = readyCourseFixture({ RowID: 'SECONDARY', activity_name: 'פעילות משנית', instructor_name: '', instructor_name_2: 'אפרת אוחיון' });
  const another = readyCourseFixture({ RowID: 'OTHER', activity_name: 'פעילות אחרת', instructor_name: 'דני כהן', instructor_name_2: '' });
  const html = operationsManagementScreen.render({ rows: [secondary, another], workshopStockMap: new Map() }, { state });
  assert.match(html, /פעילות משנית/);
  assert.doesNotMatch(html, /פעילות אחרת/);
});

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

test('printing shows a not-found message when the selected instructor has no eligible activities', () => {
  const alerts = captureAlerts();
  const opened = [];
  window.open = (...args) => { opened.push(args); return undefined; };

  // The instructor filter dropdown resets a selection that isn't among the raw
  // rows' instructor values back to "" (topFiltersHtml), so this must select a
  // real instructor whose only activity has no date -
  // not a name that never appears in the data at all.
  const notReadyCourse = readyCourseFixture({ __dates: [], start_date: '', end_date: '' });
  const state = domTestState({ instructor: 'דני כהן' });
  const printBtn = renderAndBindPrintButton([notReadyCourse], state);
  printBtn.click();

  assert.deepEqual(alerts, ['לא נמצאו פעילויות להדפסה עבור המדריך שנבחר.']);
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
