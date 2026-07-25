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
const { defaultActivitiesInnerTabForPeriod } = await import('../frontend/src/activities-tabs-corrections.js');

function baseState(innerTab = 'year_all', period = 'regular') {
  return {
    activitiesInnerTab: innerTab,
    activitiesMonthYm: '',
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

test('summer tab remains open-only and archive remains closed-only', () => {
  const summerHtml = activitiesScreen.render({ rows }, { state: baseState('summer_2026') });
  assert.match(summerHtml, /קיץ פתוח/);
  assert.doesNotMatch(summerHtml, /קיץ סגור/);
  assert.doesNotMatch(summerHtml, /רגיל סגור/);

  const archiveHtml = activitiesScreen.render({ rows }, { state: baseState('year_archive') });
  assert.match(archiveHtml, /רגיל סגור 1/);
  assert.match(archiveHtml, /רגיל סגור 2/);
  assert.match(archiveHtml, /קיץ סגור/);
  assert.doesNotMatch(archiveHtml, /קיץ פתוח/);
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
