import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ganttSource = await readFile(new URL('../frontend/src/manager-gantt-placeholder-runtime.js', import.meta.url), 'utf8');
const trackingSource = await readFile(new URL('../frontend/src/manager-weekly-manual-tracking.js', import.meta.url), 'utf8');
const migrationSource = await readFile(new URL('../supabase/migrations/20261019141000_manager_weekly_manual_tracking.sql', import.meta.url), 'utf8');
const cleanupSource = await readFile(new URL('../frontend/src/instructors-header-cleanup.js', import.meta.url), 'utf8');
const managerFinalCss = await readFile(new URL('../frontend/src/styles/manager-board-final-fixes.css', import.meta.url), 'utf8');
const navSource = await readFile(new URL('../frontend/src/screens/shared/instructors-workspace-nav.js', import.meta.url), 'utf8');
const launcherSource = await readFile(new URL('../frontend/src/screens/shared/payroll-control-launcher.js', import.meta.url), 'utf8');

test('manager board loads a manual weekly tracking Gantt tab', () => {
  assert.match(cleanupSource, /manager-gantt-placeholder-runtime\.js\?v=20261019-manual-weekly-v1/);
  assert.match(ganttSource, /button\.dataset\.managerWorkspaceTab = GANTT_TAB_ID/);
  assert.match(ganttSource, /textContent = 'גאנט'/);
  assert.match(ganttSource, /mountManagerWeeklyManual/);
  assert.doesNotMatch(ganttSource, /COMING SOON/);
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

test('payroll access follows the central attendance permission', () => {
  assert.match(navSource, /hasPermission\(state\?\.user, 'view_attendance_control'\)/);
  assert.match(launcherSource, /hasPermission\(state\?\.user, 'view_attendance_control'\)/);
  assert.match(launcherSource, /if \(!canOpenPayrollControl\(state\)\)/);
  assert.match(launcherSource, /אין הרשאה לפתוח את בקרת הנוכחות/);
});

test('weekly tracker is manual-first, backed by RLS and supports submission', () => {
  assert.match(trackingSource, /שמירת טיוטה/);
  assert.match(trackingSource, /הגשת המעקב השבועי/);
  assert.match(trackingSource, /validateWeeklyReport/);
  assert.match(trackingSource, /manager_program_learning/);
  assert.match(trackingSource, /currentReport\(ctx\)\.status !== 'submitted'/);
  assert.match(migrationSource, /manager_weekly_reports_update_drafts_self/);
  assert.match(migrationSource, /manager_weekly_manager_directory/);
  assert.match(migrationSource, /manager_weekly_self_user_id/);
});
