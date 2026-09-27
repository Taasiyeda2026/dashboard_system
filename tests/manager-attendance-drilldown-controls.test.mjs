import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workspace = await readFile(new URL('../frontend/src/manager-board-workspace-runtime.js', import.meta.url), 'utf8');

test('manager employee attendance drilldown hides duplicate month/team/instructor controls', () => {
  assert.match(
    workspace,
    /\[data-manager-attendance-host\] \.attendance-control__uploads,[\s\S]*display:none !important;/
  );
  assert.match(workspace, /const controls = host\.querySelector\('\.attendance-control__uploads'\);/);
  assert.match(workspace, /if \(controls\) controls\.hidden = true;/);
});

test('manager drilldown still preselects the board month behind the scenes', () => {
  assert.match(workspace, /monthInput\.value = context\.ym/);
  assert.match(workspace, /monthInput\.dispatchEvent\(new Event\('change'/);
});

test('manager drilldown keeps monthly manager approval available after record review', () => {
  assert.doesNotMatch(
    workspace,
    /manager-attendance-month-mode="current"[\s\S]*attendance-control__employee-actions[\s\S]*display:none/
  );
  assert.doesNotMatch(workspace, /managerAttendanceApprovalGuard/);
  assert.doesNotMatch(workspace, /closest\('\[data-payroll-finish\]'\)/);
});

