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
    RowID: 'OPS-OPEN-1',
    status: 'פתוח',
    activity_season: 'regular',
    authority: 'רשות בדיקה',
    school: 'בית ספר פתוח',
    activity_name: 'פעילות פתוחה',
    start_date: '2026-07-01',
    instructor_name: 'מדריך א'
  },
  {
    RowID: 'OPS-CLOSED-1',
    status: 'סגור',
    activity_season: 'regular',
    authority: 'רשות בדיקה',
    school: 'בית ספר סגור',
    activity_name: 'פעילות שנסגרה',
    start_date: '2026-07-02',
    instructor_name: 'מדריך ב'
  },
  {
    RowID: 'OPS-CANCELLED-1',
    status: 'בוטל',
    activity_season: 'regular',
    authority: 'רשות בדיקה',
    school: 'בית ספר מבוטל',
    activity_name: 'פעילות שבוטלה',
    start_date: '2026-07-03',
    instructor_name: 'מדריך ג'
  }
];

test('operations management status filter contains only all, open and closed', () => {
  const openHtml = operationsManagementScreen.render(
    { rows, workshopStockMap: new Map() },
    { state: buildState('פתוח') }
  );

  assert.match(openHtml, /<option value="">הכל<\/option>/);
  assert.match(openHtml, /<option value="פתוח" selected>פתוח<\/option>/);
  assert.match(openHtml, /<option value="סגור">סגור<\/option>/);
  assert.doesNotMatch(openHtml, /<option value="בתהליך"/);
  assert.doesNotMatch(openHtml, /<option value="בוטל"/);
  assert.match(openHtml, /פעילות פתוחה/);
  assert.doesNotMatch(openHtml, /פעילות שנסגרה/);
  assert.doesNotMatch(openHtml, /פעילות שבוטלה/);

  const closedHtml = operationsManagementScreen.render(
    { rows, workshopStockMap: new Map() },
    { state: buildState('סגור') }
  );

  assert.match(closedHtml, /<option value="סגור" selected>סגור<\/option>/);
  assert.match(closedHtml, /פעילות שנסגרה/);
  assert.doesNotMatch(closedHtml, /פעילות פתוחה/);
  assert.doesNotMatch(closedHtml, /פעילות שבוטלה/);

  const allHtml = operationsManagementScreen.render(
    { rows, workshopStockMap: new Map() },
    { state: buildState('') }
  );

  assert.match(allHtml, /פעילות פתוחה/);
  assert.match(allHtml, /פעילות שנסגרה/);
  assert.doesNotMatch(allHtml, /פעילות שבוטלה/);
});
