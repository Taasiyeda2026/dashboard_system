import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const board = fs.readFileSync(new URL('../frontend/src/manager-board-runtime.js', import.meta.url), 'utf8');
const workspace = fs.readFileSync(new URL('../frontend/src/manager-board-workspace-runtime.js', import.meta.url), 'utf8');
const interactions = fs.readFileSync(new URL('../frontend/src/manager-board-interactions-runtime.js', import.meta.url), 'utf8');
const compactCss = fs.readFileSync(new URL('../frontend/src/styles/manager-board-compact-overrides.css', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260818003500_manager_workspace_role_access.sql', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../frontend/sw.js', import.meta.url), 'utf8');

test('manager workspace tabs are rendered by the board and handled by delegated clicks', () => {
  assert.match(board, /function workspaceShellHtml\(\)/);
  assert.match(board, /data-manager-workspace-tab="management"[^>]*>ניהול</);
  assert.match(board, /data-manager-workspace-tab="attendance"[^>]*>בקרת נוכחות</);
  assert.match(board, /data-manager-workspace-tab="tracking"[^>]*>מעקב</);
  assert.match(workspace, /function handleWorkspaceClick\(event\)/);
  assert.match(workspace, /target\.closest\('\[data-manager-workspace-tab\]'\)/);
  assert.match(workspace, /setActiveTab\(next\)/);
  assert.match(workspace, /applyTabVisibility\(boardRoot\)/);
  assert.match(workspace, /window\.addEventListener\('click', handleWorkspaceClick, true\)/);
  assert.doesNotMatch(workspace, /function bindWorkspaceTabs\(boardRoot\)/);
});

test('manager board resets to the current valid month on every entry', () => {
  assert.match(workspace, /let resetMonthOnNextBoard = true;/);
  assert.match(workspace, /target\.closest\('\[data-manager-board-open\]'\)/);
  assert.match(workspace, /function resetBoardMonthIfNeeded\(boardRoot\)/);
  assert.match(workspace, /const target = defaultMonth\(period\);/);
  assert.match(workspace, /if \(resetBoardMonthIfNeeded\(boardRoot\)\) return;/);
  assert.doesNotMatch(workspace, /localStorage\.getItem\(`manager_board_month:/);
});

test('manager board is sidebar-only and role access is exact', () => {
  const roleBlock = board.match(/const MANAGER_BOARD_ACCESS_ROLES = new Set\(\[([\s\S]*?)\]\);/)?.[1] || '';
  for (const role of ['admin', 'operation_manager', 'activities_manager', 'finance']) {
    assert.match(roleBlock, new RegExp(`'${role}'`));
  }
  assert.doesNotMatch(roleBlock, /domain_manager/);
  assert.match(board, /document\.querySelectorAll\('\.shell-header-nav \.manager-board-nav-button'\)\.forEach\(\(button\) => button\.remove\(\)\)/);

  const workspaceRoleBlock = workspace.match(/const MANAGER_WORKSPACE_ROLES = new Set\(\[([^\]]+)\]\);/)?.[1] || '';
  for (const role of ['admin', 'operation_manager', 'activities_manager', 'finance']) {
    assert.match(workspaceRoleBlock, new RegExp(`'${role}'`));
  }
  assert.doesNotMatch(workspaceRoleBlock, /domain_manager/);
});

test('server-side manager roster and follow-up access matches UI roles', () => {
  assert.match(migration, /v_role = 'activities_manager'/);
  assert.match(migration, /v_role in \('admin', 'operation_manager', 'finance'\)/);
  assert.doesNotMatch(migration, /domain_manager/);
});

test('checkpoints include course start and no old midpoint subtitle', () => {
  assert.match(board, /meeting\.meetingNo === 1 \|\| meeting\.isMidpoint \|\| meeting\.isEnd/);
  assert.match(board, /תחילת קורס · מפגש 1/);
  assert.doesNotMatch(board, /אמצע וסיום קורסים בחודש/);
});

test('manager board removes requested descriptive subtitles at runtime', () => {
  assert.match(interactions, /manager-board-hero > div:first-child > p'\)\?\.remove\(\)/);
  assert.match(interactions, /manager-board-panel--instructors/);
  assert.match(interactions, /manager-board-panel__head p'\)\?\.remove\(\)/);
});

test('manager board body is compacted to 80 percent without changing shell and calendar bubbles are flat', () => {
  assert.match(compactCss, /\.manager-board-screen\[data-manager-board-root\][\s\S]*zoom:\s*\.8/);
  assert.match(compactCss, /manager-board-calendar-day__school[\s\S]*border-radius:\s*0\s*!important[\s\S]*background:\s*transparent\s*!important/);
  assert.match(compactCss, /manager-board-calendar-event,[\s\S]*border-radius:\s*0\s*!important[\s\S]*background:\s*transparent\s*!important/);
});

test('calendar activities open the shared activity side drawer', () => {
  assert.match(interactions, /activityWorkDrawerHtml/);
  assert.match(interactions, /createSharedInteractionLayer/);
  assert.match(interactions, /target\.closest\('\.manager-board-calendar-event'\)/);
  assert.match(interactions, /ui\.openDrawer\(/);
  assert.match(interactions, /\.from\('activities'\)/);
  assert.match(interactions, /\.select\('\*'\)/);
  assert.match(interactions, /eventNode\.setAttribute\('tabindex', '0'\)/);
});

test('latest payroll bridge is preserved and manager assets/cache are versioned', () => {
  assert.match(index, /payroll-attendance-v2-bridge\.js\?v=20260818-v1/);
  assert.match(index, /manager-board-workspace-runtime\.js\?v=20260818-manager-workspace-v4/);
  assert.match(index, /manager-board-interactions-runtime\.js\?v=20260818-manager-board-interactions-v1/);
  assert.match(index, /manager-board-compact-overrides\.css\?v=20260818-manager-board-compact-v1/);
  assert.match(sw, /const CACHE_VERSION = 1540;/);
});
