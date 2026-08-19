import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const navSource = await readFile(new URL('../frontend/src/screens/shared/instructors-workspace-nav.js', import.meta.url), 'utf8');
const launcherSource = await readFile(new URL('../frontend/src/screens/shared/payroll-control-launcher.js', import.meta.url), 'utf8');
const configSource = await readFile(new URL('../frontend/src/config.js', import.meta.url), 'utf8');
const swSource = await readFile(new URL('../frontend/sw.js', import.meta.url), 'utf8');

test('payroll control is a shared instructors tab next to maintenance', () => {
  const payrollIndex = navSource.indexOf("{ id: 'payroll-control', label: 'בקרת נוכחות'");
  const maintenanceIndex = navSource.indexOf("{ id: 'maintenance', label: 'תחזוקה'");
  assert.ok(payrollIndex >= 0, 'missing attendance control tab');
  assert.ok(maintenanceIndex > payrollIndex, 'attendance control tab must appear immediately before maintenance');
  assert.match(navSource, /openPayrollControlWindow\(state\)/);
  assert.doesNotMatch(navSource, /label: 'בקרת שכר'/);
});

test('legacy work-schedule toolbar launcher is removed after render', () => {
  assert.match(navSource, /\.ds-ops-mgmt-panel__toolbar \[data-attendance-open\]\{display:none!important\}/);
  assert.match(navSource, /querySelectorAll\('\.ds-ops-mgmt-panel__toolbar \[data-attendance-open\]'\)\.forEach\(\(button\) => button\.remove\(\)\)/);
});

test('payroll tab reuses the existing attendance control interface and binder', () => {
  assert.match(launcherSource, /attendanceControlHtml/);
  assert.match(launcherSource, /attendanceControlStylesHtml/);
  assert.match(launcherSource, /bindAttendanceControl/);
  assert.match(launcherSource, /standalone: true/);
});

test('config keeps one HOTFIX_VERSION property and both merge-side markers', () => {
  assert.equal((configSource.match(/\bHOTFIX_VERSION\s*:/g) || []).length, 1);
  assert.match(configSource, /attendance-control-compact-results-20260816-v1/);
  assert.match(configSource, /course-scheduling-manual-candidate-20260817-v1/);
  assert.match(configSource, /payroll-control-direct-data-20260816-v1/);
  assert.match(configSource, /payroll-control-tab-20260817-v1/);
  assert.doesNotMatch(configSource, /<<<<<<<|=======|>>>>>>>/);
});

test('service worker cache version is bumped for the payroll control deploy', () => {
  assert.match(swSource, /const CACHE_VERSION = 1508;/);
});
