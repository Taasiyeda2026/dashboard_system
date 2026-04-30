import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const read = (p) => fs.readFile(new URL(`../${p}`, import.meta.url), 'utf8');

function mustMatch(src, regex, msg) {
  assert.match(src, regex, msg || String(regex));
}

test('diagnostics consistency uses local finance parsers and keeps read-only behavior', async () => {
  const actions = await read('backend/actions.gs');

  mustMatch(actions, /amount:\s*parseFinanceRowAmount_\(row\)/);
  mustMatch(actions, /pending:\s*parseFinanceRowPending_\(row\)/);

  mustMatch(actions, /function parseFinanceRowAmount_\(row\) \{/);
  mustMatch(actions, /function parseFinanceRowPending_\(row\) \{/);

  mustMatch(actions, /finance_status:\s*normalizeFinance_\(row\.finance_status\)/);
  mustMatch(actions, /finance:\s*\{[\s\S]*openAmount:[\s\S]*closedAmount:[\s\S]*pendingAmount:[\s\S]*\}/);
  mustMatch(actions, /backendVersion:\s*'stage2c-finance-helper-fix-v2'/);

  const diagnosticsFn = actions.match(/function actionDiagnosticsConsistency_\([\s\S]*?\n}\n\nfunction /);
  assert.ok(diagnosticsFn, 'actionDiagnosticsConsistency_ function not found');
  const body = diagnosticsFn[0];
  assert.doesNotMatch(body, /parseFinanceRowAmount_\(row\)/);
  assert.doesNotMatch(body, /parseFinanceRowPending_\(row\)/);
  mustMatch(body, /function parseFinanceAmountLocal_\(row\) \{/);
  mustMatch(body, /function parseFinancePendingLocal_\(row\) \{/);
  mustMatch(body, /amount:\s*parseFinanceAmountLocal_\(row\)/);
  mustMatch(body, /pending:\s*parseFinancePendingLocal_\(row\)/);
  mustMatch(body, /finance_status:\s*normalizeFinance_\(row\.finance_status\)/);
  mustMatch(body, /finance:\s*\{[\s\S]*openAmount:[\s\S]*closedAmount:[\s\S]*pendingAmount:[\s\S]*\}/);
  mustMatch(body, /backendVersion:\s*'stage2c-finance-local-parser-v1'/);
  assert.doesNotMatch(body, /refreshReadModelsForActivityRow_|refreshSingleReadModel_|actionReadModelGet_/i);
});
