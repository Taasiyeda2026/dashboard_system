import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ganttSource = await readFile(new URL('../frontend/src/manager-gantt-placeholder-runtime.js', import.meta.url), 'utf8');
const cleanupSource = await readFile(new URL('../frontend/src/instructors-header-cleanup.js', import.meta.url), 'utf8');
const navSource = await readFile(new URL('../frontend/src/screens/shared/instructors-workspace-nav.js', import.meta.url), 'utf8');
const launcherSource = await readFile(new URL('../frontend/src/screens/shared/payroll-control-launcher.js', import.meta.url), 'utf8');

test('manager board loads a Gantt placeholder tab with COMING SOON', () => {
  assert.match(cleanupSource, /manager-gantt-placeholder-runtime\.js\?v=20260818-v1/);
  assert.match(ganttSource, /data\.managerWorkspaceTab = GANTT_TAB_ID/);
  assert.match(ganttSource, /textContent = 'גאנט'/);
  assert.match(ganttSource, /COMING SOON\.\.\./);
  assert.match(ganttSource, /manager-board-screen\[data-manager-board-root\]/);
});

test('payroll control is limited to admin operations and finance', () => {
  const expectedRoles = /new Set\(\['admin', 'operation_manager', 'finance'\]\)/;
  assert.match(navSource, expectedRoles);
  assert.match(navSource, /tab\?\.id === 'payroll-control' && !hasPayrollControlRole\(state\)/);
  assert.match(launcherSource, expectedRoles);
  assert.match(launcherSource, /if \(!canOpenPayrollControl\(state\)\)/);
  assert.match(launcherSource, /אין הרשאה לפתוח את בקרת הנוכחות/);
});
