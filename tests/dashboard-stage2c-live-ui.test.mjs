import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const DASHBOARD_FILE = new URL('../frontend/src/screens/dashboard.js', import.meta.url);
const API_FILE = new URL('../frontend/src/api.js', import.meta.url);

test('dashboard diagnostics button is admin/ops only and labeled correctly', async () => {
  const source = await readFile(DASHBOARD_FILE, 'utf8');
  assert.match(source, /function isAdminOpsUser\(state\)/);
  assert.match(source, /role === 'admin' \|\| role === 'operation_manager'/);
  assert.match(source, /data-run-stage2c-live[\s\S]*בדיקת תקינות נתונים/);
});

test('dashboard diagnostics runs exactly months 2026-04 and 2026-05 via diagnosticsConsistency action', async () => {
  const source = await readFile(DASHBOARD_FILE, 'utf8');
  assert.match(source, /const months = \['2026-04', '2026-05'\]/);
  assert.match(source, /api\.diagnosticsConsistency\(\{ month \}\)/);
  assert.match(source, /פערים שהתגלו/);
  assert.match(source, /אפשר להתקדם ל-Stage 3/);
  assert.match(source, /נמצא פער קריטי — אין לעבור ל-Stage 3/);
});

test('diagnostics action is treated as read-only frontend action', async () => {
  const source = await readFile(API_FILE, 'utf8');
  assert.match(source, /diagnosticsConsistency: true/);
  assert.match(source, /diagnosticsConsistency: \(payload\) => request\('diagnosticsConsistency', payload \|\| \{\}\)/);
  const mutatingBlock = source.match(/const MUTATING_ACTIONS = \{[\s\S]*?\n\};/);
  assert.ok(mutatingBlock);
  assert.doesNotMatch(mutatingBlock[0], /diagnosticsConsistency/);
});
