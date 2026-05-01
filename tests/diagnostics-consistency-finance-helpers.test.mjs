import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const read = (p) => fs.readFile(new URL(`../${p}`, import.meta.url), 'utf8');

test('diagnostics consistency keeps local finance parsers and read-only behavior', async () => {
  const actions = await read('backend/actions.gs');
  const diagnosticsFn = actions.match(/function actionDiagnosticsConsistency_\([\s\S]*?\n}\n\nfunction /);
  assert.ok(diagnosticsFn, 'actionDiagnosticsConsistency_ function not found');
  const body = diagnosticsFn[0];
  assert.match(body, /function parseFinanceAmountLocal_\(row\) \{/);
  assert.match(body, /function parseFinancePendingLocal_\(row\) \{/);
  assert.match(body, /amount:\s*parseFinanceAmountLocal_\(row\)/);
  assert.match(body, /pending:\s*parseFinancePendingLocal_\(row\)/);
  assert.doesNotMatch(body, /refreshReadModelsForActivityRow_|refreshSingleReadModel_|actionReadModelGet_/i);
});
