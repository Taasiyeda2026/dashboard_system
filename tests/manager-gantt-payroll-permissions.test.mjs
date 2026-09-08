import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ganttSource = await readFile(new URL('../frontend/src/manager-gantt-placeholder-runtime.js', import.meta.url), 'utf8');
const cleanupSource = await readFile(new URL('../frontend/src/instructors-header-cleanup.js', import.meta.url), 'utf8');
const managerFinalCss = await readFile(new URL('../frontend/src/styles/manager-board-final-fixes.css', import.meta.url), 'utf8');
const navSource = await readFile(new URL('../frontend/src/screens/shared/instructors-workspace-nav.js', import.meta.url), 'utf8');
const launcherSource = await readFile(new URL('../frontend/src/screens/shared/payroll-control-launcher.js', import.meta.url), 'utf8');

test('manager board loads a Gantt placeholder tab with COMING SOON', () => {
  assert.match(cleanupSource, /manager-gantt-placeholder-runtime\.js\?v=20260908-team-strip-v3/);
  assert.match(ganttSource, /data\.managerWorkspaceTab = GANTT_TAB_ID/);
  assert.match(ganttSource, /textContent = 'גאנט'/);
  assert.match(ganttSource, /COMING SOON\.\.\./);
  assert.match(ganttSource, /manager-board-screen\[data-manager-board-root\]/);
});

test('manager team strip remains above Gantt content and uses symmetric tile sizing', () => {
  assert.match(ganttSource, /querySelector\('\[data-manager-board-team-strip\]'\)/);
  assert.match(ganttSource, /const anchor = teamStrip \|\| tabs/);
  assert.match(ganttSource, /anchor\.insertAdjacentElement\('afterend', panel\)/);
  assert.match(managerFinalCss, /grid-auto-rows:\s*46px/);
  assert.match(managerFinalCss, /height:\s*46px/);
  assert.match(managerFinalCss, /width:\s*100%/);
});

test('payroll control is limited to admin operations and finance', () => {
  const expectedRoles = /new Set\(\['admin', 'operation_manager', 'finance'\]\)/;
  assert.match(navSource, expectedRoles);
  assert.match(navSource, /tab\?\.id === 'payroll-control' && !hasPayrollControlRole\(state\)/);
  assert.match(launcherSource, expectedRoles);
  assert.match(launcherSource, /if \(!canOpenPayrollControl\(state\)\)/);
  assert.match(launcherSource, /אין הרשאה לפתוח את בקרת הנוכחות/);
});
