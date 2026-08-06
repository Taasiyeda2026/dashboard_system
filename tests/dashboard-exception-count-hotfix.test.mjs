import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const hotfixUrl = new URL('../frontend/src/dashboard-exception-count-hotfix.js', import.meta.url);
const entryUrl = new URL('../frontend/src/main-with-proposal-pdf-hotfix.js', import.meta.url);

const { applyDashboardExceptionSummary } = await import(`${hotfixUrl.href}?test=${Date.now()}`);

test('dashboard exception card uses the exact unique activity count from the exceptions model', () => {
  const payload = {
    exceptionCount: 0,
    exceptionsUnavailable: false,
    totals: { exceptions_count: 0, total_activities: 281 },
    summary: {
      exceptions_count: 0,
      totalExceptionRows: 0,
      totalExceptionInstances: 0,
      counts: {}
    },
    by_activity_manager: [
      { activity_manager: 'מחוז מרכז', exceptions: 0 },
      { activity_manager: 'מחוז צפון', exceptions: 0 }
    ],
    kpi_cards: [
      { id: 'active_workshops', action: 'kpi|active_workshops', title: '281', value: 281 },
      { id: 'exceptions', action: 'kpi|exceptions', title: '0', value: 0 }
    ],
    cards: [
      { id: 'exceptions', action: 'kpi|exceptions', title: '0', value: 0 }
    ]
  };

  const exceptions = {
    uniqueExceptionActivities: 10,
    totalExceptionRows: 10,
    totalExceptionInstances: 14,
    counts: { summer_ended_open: 7, missing_completion_approval: 7 },
    byDistrict: { 'מחוז מרכז': 7, 'מחוז צפון': 3 },
    rows: Array.from({ length: 10 }, (_, index) => ({ row_id: String(index + 1) }))
  };

  const result = applyDashboardExceptionSummary(payload, exceptions);

  assert.equal(result.exceptionCount, 10);
  assert.equal(result.uniqueExceptionActivities, 10);
  assert.equal(result.totalExceptionOccurrences, 14);
  assert.equal(result.totals.exceptions_count, 10);
  assert.equal(result.summary.exceptions_count, 10);
  assert.equal(result.summary.totalExceptionRows, 10);
  assert.equal(result.summary.totalExceptionInstances, undefined);
  assert.equal(result.summary.totalExceptionOccurrences, 14);
  assert.equal(result.summary.exceptions_unavailable, false);
  assert.equal(result.kpi_cards.find((card) => card.id === 'exceptions').title, '10');
  assert.equal(result.kpi_cards.find((card) => card.id === 'exceptions').value, 10);
  assert.equal(result.cards.find((card) => card.id === 'exceptions').value, 10);
  assert.equal(result.by_activity_manager[0].exceptions, 7);
  assert.equal(result.by_activity_manager[1].exceptions, 3);
  assert.equal(result.kpi_cards.find((card) => card.id === 'active_workshops').value, 281);

  assert.equal(payload.exceptionCount, 0, 'the original payload must not be mutated');
  assert.equal(payload.summary.totalExceptionInstances, 0);
  assert.equal(payload.kpi_cards.find((card) => card.id === 'exceptions').value, 0);
});

test('the hotfix is loaded before main.js and reconciles the snapshot path used by the dashboard screen', async () => {
  const [entrySource, hotfixSource] = await Promise.all([
    readFile(entryUrl, 'utf8'),
    readFile(hotfixUrl, 'utf8')
  ]);

  const hotfixImport = entrySource.indexOf("import './dashboard-exception-count-hotfix.js");
  const mainImport = entrySource.indexOf("import './main.js';");

  assert.ok(hotfixImport >= 0);
  assert.ok(mainImport > hotfixImport);
  assert.match(hotfixSource, /installDashboardReconciler\('dashboardSnapshot'\)/);
  assert.match(hotfixSource, /installDashboardReconciler\('dashboardReadModel'\)/);
  assert.match(hotfixSource, /api\.exceptions\(\{/);
  assert.match(hotfixSource, /activity_period: state\?\.activityPeriodTab/);
});
