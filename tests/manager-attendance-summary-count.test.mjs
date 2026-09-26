import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../frontend/src/manager-board-workspace-runtime.js', import.meta.url), 'utf8');
const mobileCss = await readFile(new URL('../frontend/src/styles/mobile-responsive.css', import.meta.url), 'utf8');

test('manager summary excludes generated travel-time cancellation rows from the displayed report count', () => {
  assert.match(source, /const generationKind = text\(row\?\.generationKind \|\| row\?\.generation_kind\);/);
  assert.match(source, /if \(generationKind === 'travel_time_cancellation'\) continue;/);
  assert.match(source, /קיים · \$\{count\} דיווחים/);
});

test('manager summary still counts ordinary attendance rows', () => {
  assert.match(source, /recordCounts\.set\(empId, \(recordCounts\.get\(empId\) \|\| 0\) \+ 1\);/);
});

test('manager summary shows total monthly hours instead of cancellation-only hours', () => {
  assert.match(source, /const totalHours = new Map/);
  assert.match(source, /totalHours\.set\(empId, \(totalHours\.get\(empId\) \|\| 0\) \+ attendanceHoursValue\(row\)\)/);
  assert.match(source, /const value = \{ recordCounts, totalHours, approvals, recordsError, approvalsError \}/);
  assert.match(source, /<th>סה״כ שעות<\/th>/);
  assert.match(source, /data-label="סה״כ שעות"/);
  assert.match(source, /formatAttendanceHours\(hours\)/);
  assert.doesNotMatch(source, /<th>ביטול זמן<\/th>/);
});

test('manager attendance table becomes mobile cards without horizontal table scrolling', () => {
  assert.match(mobileCss, /manager-workspace-attendance-table thead\s*\{\s*display:\s*none/);
  assert.match(mobileCss, /manager-workspace-attendance-table tbody > tr\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(mobileCss, /manager-workspace-attendance-table\s*\{[\s\S]*min-width:\s*0\s*!important/);
  assert.match(mobileCss, /manager-workspace-attendance \.manager-workspace-table-wrap\s*\{[\s\S]*overflow:\s*visible/);
  assert.match(mobileCss, /manager-workspace-attendance-action\s*\{[\s\S]*grid-column:\s*1\s*\/\s*-1/);
  assert.match(mobileCss, /attendance-control__comparison-wrap\s*\{[\s\S]*overflow:\s*visible\s*!important/);
  assert.match(mobileCss, /attendance-control__comparison-table\s*\{[\s\S]*min-width:\s*0\s*!important/);
});


test('mobile global header keeps its quick navigation tabs', () => {
  assert.match(mobileCss, /shell-header-nav\.ds-act-nav-grid--header\s*\{[\s\S]*display:\s*flex/);
  assert.doesNotMatch(mobileCss, /\.shell-top \.shell-header-nav,\s*\.shell-top__end:empty\s*\{\s*display:\s*none/);
});

test('cache markers are bumped for the manager attendance mobile fix', async () => {
  const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const sw = await readFile(new URL('../frontend/sw.js', import.meta.url), 'utf8');
  assert.match(index, /manager-board-workspace-runtime\.js\?v=20260926-manager-attendance-total-hours-v1/);
  assert.match(index, /mobile-responsive\.css\?v=20260926-manager-attendance-mobile-v2/);
  assert.match(sw, /const CACHE_VERSION = 1771;/);
});
