import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const read = (p) => fs.readFile(new URL(`../${p}`, import.meta.url), 'utf8');

function mustMatch(src, regex, msg) {
  assert.match(src, regex, msg || String(regex));
}

test('dashboard consistency harness: legacy/snapshot/read-model are wired to same metric contract', async () => {
  const actions = await read('backend/actions.gs');
  const snapshot = await read('backend/dashboard-snapshot.gs');
  const readModels = await read('backend/read-models.gs');

  // same exception source in legacy and snapshot
  mustMatch(actions, /var exceptionSummary = getExceptionsSummary_\(combined, ym, \{ include_rows: false \}\);/);
  mustMatch(snapshot, /var exceptionSummary = getExceptionsSummary_\(rows, ym, \{ include_rows: false \}\);/);

  // required KPI fields are built by snapshot
  mustMatch(snapshot, /finance_open_count/);
  mustMatch(snapshot, /exceptions_count/);
  mustMatch(snapshot, /active_instructors_count/);
  mustMatch(snapshot, /course_endings_current_month/);
  mustMatch(snapshot, /total_short_activities/);
  mustMatch(snapshot, /total_long_activities/);

  // read-model refresh for dashboard is snapshot-backed and readModelGet returns cached payload
  mustMatch(readModels, /function refreshDashboardReadModel_\(\) \{\s*return refreshSingleReadModel_\('dashboard', \{\}, function\(\) \{\s*return actionDashboardSnapshot_\(/s);
  mustMatch(readModels, /function actionReadModelGet_\(/);
});

test('exceptions consistency harness: exceptions endpoint and dashboard use computeExceptionsModel_', async () => {
  const actions = await read('backend/actions.gs');
  const views = await read('backend/views.gs');

  mustMatch(actions, /function computeExceptionsModel_\(/);
  mustMatch(actions, /function getExceptionsSummary_\(rows, ym, opts\) \{\s*return computeExceptionsModel_\(rows, ym, opts \|\| \{\}\);\s*\}/s);
  mustMatch(actions, /var exceptionSummary = getExceptionsSummary_\(rows, month, \{ include_rows: true, include_debug: yesNo_\(payload && payload\.debug\) === 'yes' \}\);/);
  mustMatch(actions, /var exceptionSummary = getExceptionsSummary_\(combined, ym, \{ include_rows: false \}\);/);
  mustMatch(views, /var monthExceptionSummary = computeExceptionsModel_\(monthActivities, ym, \{ include_rows: false \}\);/);
});

test('finance consistency harness: row amount, pending logic, status buckets, and export use same normalization', async () => {
  const actions = await read('backend/actions.gs');
  const financeScreen = await read('frontend/src/screens/finance.js');

  // backend normalization + buckets
  mustMatch(actions, /finance_status: normalizeFinance_\(row\.finance_status\)/);
  mustMatch(actions, /if \(st === 'open'\) \{ totalOpen\+\+; amountOpen \+= amount; \}/);
  mustMatch(actions, /else if \(st === 'closed'\) \{ totalClosed\+\+; amountClosed \+= amount; \}/);

  // frontend single row amount function reused in KPI/group/export
  mustMatch(financeScreen, /function rowAmount\(row\)/);
  mustMatch(financeScreen, /const pendingRaw = roundedSessions - recorded;/);
  mustMatch(financeScreen, /const pending = pendingRaw > 0 \? pendingRaw : 0;/);
  mustMatch(financeScreen, /const amountOpen = kpiOpen\.reduce\(\(s, r\) => s \+ rowAmount\(r\), 0\);/);
  mustMatch(financeScreen, /const amountClosed = kpiClosed\.reduce\(\(s, r\) => s \+ rowAmount\(r\), 0\);/);
  mustMatch(financeScreen, /if \(c === 'Payment'\) v = String\(rowAmount\(row\)\);/);
  mustMatch(financeScreen, /String\(r\.finance_status \|\| ''\)\.toLowerCase\(\) === 'open'/);
  mustMatch(financeScreen, /String\(r\.finance_status \|\| ''\)\.toLowerCase\(\) === 'closed'/);
});
