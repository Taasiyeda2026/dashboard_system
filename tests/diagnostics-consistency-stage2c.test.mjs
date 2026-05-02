import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const read = (p) => fs.readFile(new URL(`../${p}`, import.meta.url), 'utf8');

function mustMatch(src, regex, msg) {
  assert.match(src, regex, msg || String(regex));
}

test('Stage2C diagnostics action exists and is admin/internal oriented', async () => {
  const actions = await read('backend/actions.gs');
  const router = await read('backend/router.gs');
  const apiRw = await read('backend/api_read_write.gs');

  mustMatch(actions, /function actionDiagnosticsConsistency_\(user, payload\)/);
  mustMatch(actions, /requireAnyRole_\(user, \['admin', 'operation_manager'\]\);/);
  mustMatch(actions, /var month = dashboardPayloadYm_\(payload \|\| \{\}\);/);

  mustMatch(router, /diagnosticsConsistency:\s*'dashboard'/);
  mustMatch(apiRw, /diagnosticsConsistency:\s*function\(u,\s*p\)\s*\{[\s\S]*return actionDiagnosticsConsistency_\(u, p\)/);
});

test('Stage2C diagnostics payload includes dashboard/exceptions/finance/mismatches/timings' , async () => {
  const actions = await read('backend/actions.gs');

  mustMatch(actions, /dashboard:\s*dashboard,/);
  mustMatch(actions, /exceptions:\s*\{[\s\S]*totalExceptionInstances:[\s\S]*byManager:[\s\S]*sumByManager:/);
  mustMatch(actions, /finance:\s*\{[\s\S]*openRows:[\s\S]*closedRows:[\s\S]*openAmount:[\s\S]*closedAmount:[\s\S]*pendingAmount:/);
  mustMatch(actions, /mismatches:\s*\[\]/);
  mustMatch(actions, /timings:\s*timings/);
  mustMatch(actions, /errorCode:\s*'DIAGNOSTICS_TIMEOUT'/);

});

test('Stage2C diagnostics uses direct sources and does not refresh read-model/cache', async () => {
  const actions = await read('backend/actions.gs');

  mustMatch(actions, /var rows = allActivitiesSummary_\(\);/);
  mustMatch(actions, /var exceptionSummary = getExceptionsSummary_\(inMonth, month, \{ include_rows: false \}\);/);
  mustMatch(actions, /normalizeFinance_\(row\.finance_status\)/);
  const start = actions.indexOf('function actionDiagnosticsConsistency_(user, payload)');
  assert.ok(start >= 0);
  const nextFn = actions.indexOf('\nfunction actionDashboard_(', start);
  assert.ok(nextFn > start);
  const fnBody = actions.slice(start, nextFn);
  assert.doesNotMatch(fnBody, /refreshAllReadModels_|refreshDashboardReadModel_|actionReadModelGet_|scriptCachePutJson_|scriptCacheGetJson_/);
});
