import { test } from 'node:test';
import assert from 'node:assert/strict';

if (!globalThis.sessionStorage) {
  const values = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear()
  };
}

if (!globalThis.localStorage) {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear()
  };
}

const { activitiesScreen } = await import('../frontend/src/screens/activities.js');
const {
  defaultActivitiesInnerTabForPeriod,
  nextActivitiesMonth,
  preferredMonthForTab
} = await import('../frontend/src/activities-tabs-corrections.js');

function baseState(innerTab = 'year_all', period = 'regular') {
  return {
    activitiesInnerTab: innerTab,
    activitiesMonthYm: '',
    activitiesNavLoading: false,
    activityPeriodTab: period,
    user: { role: 'admin', display_role: 'מנהל מערכת', can_add_activity: true },
    clientSettings: { hide_emp_id_on_screens: true, dropdown_options: {} },
    activityListFilters: {},
    screenDataCache: {}
  };
}

const rows = [
  { RowID: 'REG-CLOSED-1', activity_name: 'רגיל סגור 1', activity_type: 'course', activity_family: 'program', activity_season: 'regular', start_date: '2026-01-01', status: 'סגור' },
  { RowID: 'REG-CLOSED-2', activity_name: 'רגיל סגור 2', activity_type: 'course', activity_family: 'program', activity_season: 'regular', start_date: '2026-02-01', status: 'סגור' },
  { RowID: 'SUMMER-OPEN', activity_name: 'קיץ פתוח', activity_type: 'workshop', activity_family: 'one_day', activity_season: 'summer_2026', start_date: '2026-07-01', status: 'פתוח' },
  { RowID: 'SUMMER-CLOSED', activity_name: 'קיץ סגור', activity_type: 'workshop', activity_family: 'one_day', activity_season: 'summer_2026', start_date: '2026-07-02', status: 'סגור' },
  { RowID: 'SUMMER-CANCELLED', activity_name: 'קיץ מבוטל', activity_type: 'workshop', activity_family: 'one_day', activity_season: 'summer_2026', start_date: '2026-07-03', status: 'בוטל' },
  { RowID: 'SUMMER-DELETED', activity_name: 'קיץ נמחק', activity_type: 'workshop', activity_family: 'one_day', activity_season: 'summer_2026', start_date: '2026-07-04', status: 'נמחק' },
  { RowID: 'SCHOOL-2027-OPEN', activity_name: 'תשפז פתוח', activity_type: 'course', activity_family: 'program', activity_season: 'school_2027', start_date: '2026-09-01', status: 'בתהליך' },
  { RowID: 'SCHOOL-2027-CLOSED', activity_name: 'תשפז סגור', activity_type: 'course', activity_family: 'program', activity_season: 'school_2027', start_date: '2026-09-02', status: 'סגור' }
];

test('activities default inner tab follows the selected global period', () => {
  assert.equal(defaultActivitiesInnerTabForPeriod('regular'), 'summer_2026');
  assert.equal(defaultActivitiesInnerTabForPeriod('school_2027'), 'school_2027');
});

test('all activities includes open and closed rows but excludes cancelled and deleted rows', () => {
  const html = activitiesScreen.render({ rows }, { state: baseState('year_all') });

  assert.match(html, /רגיל סגור 1/);
  assert.match(html, /רגיל סגור 2/);
  assert.match(html, /קיץ פתוח/);
  assert.match(html, /קיץ סגור/);
  assert.doesNotMatch(html, /קיץ מבוטל/);
  assert.doesNotMatch(html, /קיץ נמחק/);
  assert.doesNotMatch(html, /תשפז פתוח/);

  assert.match(html, /data-activity-period-tab="year_all"[\s\S]*?<strong>4<\/strong>/);
  assert.match(html, /data-activity-period-tab="regular_2026"[\s\S]*?<strong>0<\/strong>/);
  assert.match(html, /data-activity-period-tab="summer_2026"[\s\S]*?<strong>1<\/strong>/);
  assert.match(html, /data-activity-period-tab="year_archive"[\s\S]*?<strong>3<\/strong>/);
});

test('summer tab remains open-only and archive remains closed-only by selected month', () => {
  const summerState = baseState('summer_2026');
  summerState.activitiesMonthYm = '2026-07';
  const summerHtml = activitiesScreen.render({ rows }, { state: summerState });
  assert.match(summerHtml, /קיץ פתוח/);
  assert.doesNotMatch(summerHtml, /קיץ סגור/);
  assert.doesNotMatch(summerHtml, /רגיל סגור/);

  const januaryArchiveState = baseState('year_archive');
  januaryArchiveState.activitiesMonthYm = '2026-01';
  const januaryArchiveHtml = activitiesScreen.render({ rows }, { state: januaryArchiveState });
  assert.match(januaryArchiveHtml, /רגיל סגור 1/);
  assert.doesNotMatch(januaryArchiveHtml, /רגיל סגור 2/);
  assert.doesNotMatch(januaryArchiveHtml, /קיץ סגור/);

  const julyArchiveState = baseState('year_archive');
  julyArchiveState.activitiesMonthYm = '2026-07';
  const julyArchiveHtml = activitiesScreen.render({ rows }, { state: julyArchiveState });
  assert.match(julyArchiveHtml, /קיץ סגור/);
  assert.doesNotMatch(julyArchiveHtml, /רגיל סגור 1/);
  assert.doesNotMatch(julyArchiveHtml, /קיץ פתוח/);
});

test('summer month navigation moves sequentially, including empty adjacent months', () => {
  const state = baseState('summer_2026');
  state.activitiesMonthYm = '2026-07';

  const julyHtml = activitiesScreen.render({ rows }, { state });
  assert.match(julyHtml, /data-activities-month-prev/);
  assert.match(julyHtml, /data-activities-month-next/);
  assert.match(julyHtml, /יולי 2026/);
  assert.match(julyHtml, /קיץ פתוח/);
  assert.equal(nextActivitiesMonth(state, -1), '2026-06');
  assert.equal(nextActivitiesMonth(state, 1), '2026-08');

  state.activitiesMonthYm = '2026-06';
  const juneHtml = activitiesScreen.render({ rows }, { state });
  assert.match(juneHtml, /יוני 2026/);
  assert.doesNotMatch(juneHtml, /קיץ פתוח/);
  assert.match(juneHtml, /0 פעילויות מתוך 1/);
});

test('2027 all activities combines active and closed 2027 rows only', () => {
  const html = activitiesScreen.render({ rows }, { state: baseState('year_all', 'school_2027') });
  assert.match(html, /תשפז פתוח/);
  assert.match(html, /תשפז סגור/);
  assert.doesNotMatch(html, /קיץ פתוח/);
  assert.match(html, /data-activity-period-tab="year_all"[\s\S]*?<strong>2<\/strong>/);
  assert.match(html, /data-activity-period-tab="school_2027"[\s\S]*?<strong>1<\/strong>/);
  assert.match(html, /data-activity-period-tab="year_archive"[\s\S]*?<strong>1<\/strong>/);
});

function school2027Rows() {
  return Array.from({ length: 188 }, (_, index) => ({
    RowID: `SCHOOL-2027-${index + 1}`,
    activity_name: `פעילות תשפז ${index + 1}`,
    activity_type: 'course',
    activity_family: 'program',
    activity_season: 'school_2027',
    start_date: index < 20 ? `2026-09-${String(index + 1).padStart(2, '0')}`
      : index < 26 ? `2026-10-${String(index - 19).padStart(2, '0')}`
        : `2026-11-${String((index % 28) + 1).padStart(2, '0')}`,
    status: 'פתוח'
  }));
}

test('2027 annual and monthly tabs keep separate counts and monthly titles', () => {
  const annualRows = school2027Rows();
  const allHtml = activitiesScreen.render({ rows: annualRows }, { state: baseState('year_all', 'school_2027') });
  assert.match(allHtml, /data-activity-period-tab="year_all"[\s\S]*?<strong>188<\/strong>/);
  assert.match(allHtml, /data-activity-period-tab="school_2027"[\s\S]*?<strong>20<\/strong>/);

  const monthlyState = baseState('school_2027', 'school_2027');
  monthlyState.activitiesMonthYm = '2026-09';
  const septemberHtml = activitiesScreen.render({ rows: annualRows }, { state: monthlyState });
  assert.match(septemberHtml, /data-activity-period-tab="year_all"[\s\S]*?<strong>188<\/strong>/);
  assert.match(septemberHtml, /data-activity-period-tab="school_2027"[\s\S]*?<strong>20<\/strong>/);
  assert.match(septemberHtml, /פעילויות תשפ״ז · ספטמבר 2026 · 20 פעילויות/);

  monthlyState.activitiesMonthYm = nextActivitiesMonth(monthlyState, 1);
  const octoberHtml = activitiesScreen.render({ rows: annualRows }, { state: monthlyState });
  assert.match(octoberHtml, /data-activity-period-tab="school_2027"[\s\S]*?<strong>6<\/strong>/);
  assert.match(octoberHtml, /פעילויות תשפ״ז · אוקטובר 2026 · 6 פעילויות/);
  assert.doesNotMatch(octoberHtml, /מתוך 188/);
});

test('2027 default month clamps the current calendar month to the school-year range', () => {
  const monthlyState = baseState('school_2027', 'school_2027');
  assert.equal(preferredMonthForTab([], monthlyState, new Date(2026, 7, 6)), '2026-09');
  assert.equal(preferredMonthForTab([], monthlyState, new Date(2026, 9, 15)), '2026-10');
  assert.equal(preferredMonthForTab([], monthlyState, new Date(2027, 7, 1)), '2027-06');
});

test('2027 monthly view keeps empty months and does not seek a month containing activities', () => {
  const monthlyState = baseState('school_2027', 'school_2027');
  assert.equal(preferredMonthForTab(school2027Rows(), monthlyState, new Date(2026, 11, 15)), '2026-12');
  monthlyState.activitiesMonthYm = '2026-12';
  const html = activitiesScreen.render({ rows: school2027Rows() }, { state: monthlyState });
  assert.match(html, /data-activity-period-tab="school_2027"[\s\S]*?<strong>0<\/strong>/);
  assert.match(html, /פעילויות תשפ״ז · דצמבר 2026 · 0 פעילויות/);
  assert.doesNotMatch(html, /פעילות תשפז/);
  assert.equal(nextActivitiesMonth(monthlyState, -1), '2026-11');
  assert.equal(nextActivitiesMonth(monthlyState, 1), '2027-01');
});

test('2027 monthly membership uses actual date points without filling date ranges', () => {
  const dateRows = [
    { RowID: 'MEETING-IN-OCTOBER', activity_name: 'מפגש באוקטובר', activity_season: 'school_2027', start_date: '2026-09-01', end_date: '2026-11-30', date_3: '2026-10-12', status: 'פתוח' },
    { RowID: 'RANGE-ONLY', activity_name: 'טווח בלבד', activity_season: 'school_2027', start_date: '2026-09-02', end_date: '2026-11-29', status: 'פתוח' },
    { RowID: 'CLOSED-IN-OCTOBER', activity_name: 'סגורה באוקטובר', activity_season: 'school_2027', date_1: '2026-10-05', status: 'סגור' },
    { RowID: 'CANCELLED-IN-OCTOBER', activity_name: 'מבוטלת באוקטובר', activity_season: 'school_2027', meeting_dates: ['2026-10-06'], status: 'בוטל' }
  ];
  const monthlyState = baseState('school_2027', 'school_2027');
  monthlyState.activitiesMonthYm = '2026-10';
  const monthlyHtml = activitiesScreen.render({ rows: dateRows }, { state: monthlyState });
  assert.match(monthlyHtml, /מפגש באוקטובר/);
  assert.doesNotMatch(monthlyHtml, /טווח בלבד/);
  assert.doesNotMatch(monthlyHtml, /סגורה באוקטובר/);
  assert.doesNotMatch(monthlyHtml, /מבוטלת באוקטובר/);
  assert.match(monthlyHtml, /data-activity-period-tab="school_2027"[\s\S]*?<strong>1<\/strong>/);

  const allHtml = activitiesScreen.render({ rows: dateRows }, { state: baseState('year_all', 'school_2027') });
  assert.match(allHtml, /מפגש באוקטובר/);
  assert.match(allHtml, /טווח בלבד/);
  assert.match(allHtml, /סגורה באוקטובר/);
  assert.doesNotMatch(allHtml, /מבוטלת באוקטובר/);

  const archiveState = baseState('year_archive', 'school_2027');
  archiveState.activitiesMonthYm = '2026-10';
  const archiveHtml = activitiesScreen.render({ rows: dateRows }, { state: archiveState });
  assert.match(archiveHtml, /סגורה באוקטובר/);
  assert.doesNotMatch(archiveHtml, /מפגש באוקטובר/);
});
