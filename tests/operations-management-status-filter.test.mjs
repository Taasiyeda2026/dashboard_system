import { test } from 'node:test';
import assert from 'node:assert/strict';
import { operationsManagementScreen } from '../frontend/src/screens/operations-management.js';

function buildState(status) {
  return {
    activityPeriodTab: 'regular',
    operationsManagement: {
      tab: 'authorities',
      period: 'regular',
      dateFrom: '2025-09-01',
      dateTo: '2026-08-31',
      instructor: '__all__',
      expandedWorkshop: '',
      expandedSchool: ''
    },
    listFilters: {
      'operations-management': {
        q: '',
        appliedQ: '',
        status,
        visibleCount: 200
      }
    }
  };
}

const rows = [
  {
    RowID: 'summer_open_1',
    status: 'פתוח',
    activity_season: 'summer_2026',
    authority: 'רשות קיץ',
    school: 'בית ספר קיץ פתוח',
    activity_name: 'פעילות קיץ פתוחה',
    start_date: '2026-07-01',
    instructor_name: 'מדריך א'
  },
  {
    RowID: 'summer_closed_1',
    status: 'סגור',
    activity_season: 'summer_2026',
    authority: 'רשות קיץ',
    school: 'בית ספר קיץ סגור',
    activity_name: 'פעילות קיץ שנסגרה',
    start_date: '2026-07-02',
    instructor_name: 'מדריך ב'
  },
  {
    RowID: 'summer_cancelled_1',
    status: 'בוטל',
    activity_season: 'summer_2026',
    authority: 'רשות קיץ',
    school: 'בית ספר קיץ מבוטל',
    activity_name: 'פעילות קיץ שבוטלה',
    start_date: '2026-07-03',
    instructor_name: 'מדריך ג'
  },
  {
    RowID: 'regular_2026_1',
    status: 'פתוח',
    activity_season: 'regular',
    authority: 'רשות שנתית',
    school: 'בית ספר שנתי',
    activity_name: 'פעילות שנתית 2026',
    start_date: '2026-07-04',
    instructor_name: 'מדריך ד'
  }
];

test('operations authorities show only summer 2026 with all, open and closed statuses', () => {
  const openHtml = operationsManagementScreen.render(
    { rows, workshopStockMap: new Map() },
    { state: buildState('פתוח') }
  );

  assert.match(openHtml, /<option value="">הכל<\/option>/);
  assert.match(openHtml, /<option value="פתוח" selected>פתוח<\/option>/);
  assert.match(openHtml, /<option value="סגור">סגור<\/option>/);
  assert.doesNotMatch(openHtml, /<option value="בתהליך"/);
  assert.doesNotMatch(openHtml, /<option value="בוטל"/);
  assert.match(openHtml, /value="2026-06-15"/);
  assert.match(openHtml, /value="2026-08-31"/);
  assert.match(openHtml, /פעילות קיץ פתוחה/);
  assert.doesNotMatch(openHtml, /פעילות קיץ שנסגרה/);
  assert.doesNotMatch(openHtml, /פעילות קיץ שבוטלה/);
  assert.doesNotMatch(openHtml, /פעילות שנתית 2026/);

  const closedHtml = operationsManagementScreen.render(
    { rows, workshopStockMap: new Map() },
    { state: buildState('סגור') }
  );

  assert.match(closedHtml, /<option value="סגור" selected>סגור<\/option>/);
  assert.match(closedHtml, /פעילות קיץ שנסגרה/);
  assert.doesNotMatch(closedHtml, /פעילות קיץ פתוחה/);
  assert.doesNotMatch(closedHtml, /פעילות קיץ שבוטלה/);
  assert.doesNotMatch(closedHtml, /פעילות שנתית 2026/);

  const allHtml = operationsManagementScreen.render(
    { rows, workshopStockMap: new Map() },
    { state: buildState('') }
  );

  assert.match(allHtml, /פעילות קיץ פתוחה/);
  assert.match(allHtml, /פעילות קיץ שנסגרה/);
  assert.doesNotMatch(allHtml, /פעילות קיץ שבוטלה/);
  assert.doesNotMatch(allHtml, /פעילות שנתית 2026/);
});
