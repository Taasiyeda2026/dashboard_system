import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const DASHBOARD_FILE = new URL('../frontend/src/screens/dashboard.js', import.meta.url);
const API_FILE = new URL('../frontend/src/api.js', import.meta.url);

test('dashboard no longer renders diagnostics controls in emergency hotfix', async () => {
  const source = await readFile(DASHBOARD_FILE, 'utf8');
  assert.doesNotMatch(source, /data-run-stage2c-live|data-stop-stage2c-live|data-stage2c-month/);
  assert.doesNotMatch(source, /renderDiagnosticsMonthBlock|isAdminOpsUser/);
});

test('dashboard does not call diagnosticsConsistency during bind/load', async () => {
  const source = await readFile(DASHBOARD_FILE, 'utf8');
  assert.doesNotMatch(source, /diagnosticsConsistency\(/);
});

test('api no longer exposes diagnosticsConsistency helper', async () => {
  const source = await readFile(API_FILE, 'utf8');
  const exportsBlock = source.match(/export const api = \{[\s\S]*?\n\};/);
  assert.ok(exportsBlock);
  assert.doesNotMatch(exportsBlock[0], /diagnosticsConsistency:/);
});
