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
  }
];

test('operations management authorities tab exposes and applies closed status filter', () => {
  const openHtml = operationsManagementScreen.render(
    { rows, workshopStockMap: new Map() },
    { state: buildState('פתוח') }
  );

  assert.match(openHtml, /<option value="סגור">סגור<\/option>/);
  assert.match(openHtml, /פעילות פתוחה/);
  assert.doesNotMatch(openHtml, /פעילות שנסגרה/);

  const closedHtml = operationsManagementScreen.render(
    { rows, workshopStockMap: new Map() },
    { state: buildState('סגור') }
  );

  assert.match(closedHtml, /<option value="סגור" selected>סגור<\/option>/);
  assert.match(closedHtml, /פעילות שנסגרה/);
  assert.doesNotMatch(closedHtml, /פעילות פתוחה/);

  const allHtml = operationsManagementScreen.render(
    { rows, workshopStockMap: new Map() },
    { state: buildState('') }
  );

  assert.match(allHtml, /פעילות פתוחה/);
  assert.match(allHtml, /פעילות שנסגרה/);
});
