import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const DASHBOARD_FILE = new URL('../frontend/src/screens/dashboard.js', import.meta.url);
const API_FILE = new URL('../frontend/src/api.js', import.meta.url);

test('dashboard diagnostics button is admin/ops only and labeled correctly', async () => {
  const source = await readFile(DASHBOARD_FILE, 'utf8');
  assert.match(source, /function isAdminOpsUser\(state\)/);
  assert.match(source, /role === 'admin' \|\| role === 'operation_manager'/);
  assert.match(source, /data-run-stage2c-live[\s\S]*הרץ בדיקה לחודש הנבחר/);
  assert.match(source, /data-stage2c-month/);
  assert.match(source, /value="2026-05"/);
  assert.match(source, /data-stop-stage2c-live[\s\S]*עצור בדיקה/);
});

test('dashboard diagnostics runs one selected month at a time with timeout', async () => {
  const source = await readFile(DASHBOARD_FILE, 'utf8');
  assert.match(source, /api\.diagnosticsConsistency\(\{ month: selectedMonth \}, \{ timeout_ms: 25000 \}\)/);
  assert.match(source, /בדיקת הדיאגנוסטיקה נמשכה יותר מדי זמן ונעצרה/);
  assert.doesNotMatch(source, /const months = \['2026-04', '2026-05'\]/);
  assert.doesNotMatch(source, /Promise\.all\(months\.map/);
});

test('diagnostics action is treated as read-only frontend action and exposes timeout option', async () => {
  const source = await readFile(API_FILE, 'utf8');
  assert.match(source, /diagnosticsConsistency: true/);
  assert.match(source, /diagnosticsConsistency: \(payload, opts = \{\}\) => request\('diagnosticsConsistency', payload \|\| \{\}, \{ timeout_ms: opts\.timeout_ms \}\)/);
  const mutatingBlock = source.match(/const MUTATING_ACTIONS = \{[\s\S]*?\n\};/);
  assert.ok(mutatingBlock);
  assert.doesNotMatch(mutatingBlock[0], /diagnosticsConsistency/);
});
