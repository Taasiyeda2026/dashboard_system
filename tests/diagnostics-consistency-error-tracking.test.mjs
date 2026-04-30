import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('diagnostics consistency tracks failing internal function for admin-safe details', async () => {
  const source = readFileSync(new URL('../backend/actions.gs', import.meta.url), 'utf8');
  assert.match(source, /var currentFunction = 'actionDiagnosticsConsistency_';/);
  assert.match(source, /currentFunction = 'allActivitiesSummary_';/);
  assert.match(source, /currentFunction = 'getExceptionsSummary_';/);
  assert.match(source, /currentFunction = 'financeCalculation_';/);
  assert.match(source, /var functionName = currentFunction \|\| \(fnMatch \? fnMatch\[1\] : 'actionDiagnosticsConsistency_'\);/);
});
