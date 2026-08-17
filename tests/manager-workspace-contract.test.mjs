import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const board = fs.readFileSync(new URL('../frontend/src/manager-board-runtime.js', import.meta.url), 'utf8');
const workspace = fs.readFileSync(new URL('../frontend/src/manager-board-workspace-runtime.js', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260818003500_manager_workspace_role_access.sql', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../frontend/sw.js', import.meta.url), 'utf8');
const config = fs.readFileSync(new URL('../frontend/src/config.js', import.meta.url), 'utf8');

test('manager workspace tabs are rendered by the board and handled by delegated clicks', () => {
  assert.match(board, /function workspaceShellHtml\(\)/);
  assert.match(board, /data-manager-workspace-tab="management"[^>]*>ניהול</);
  assert.match(board, /data-manager-workspace-tab="attendance"[^>]*>בקרת נוכחות</);
  assert.match(board, /data-manager-workspace-tab="tracking"[^>]*>מעקב</);
  assert.match(board, /\$\{workspaceShellHtml\(\)\}/);
  assert.match(workspace, /function handleWorkspaceClick\(event\)/);
  assert.match(workspace, /target\.closest\('\[data-manager-workspace-tab\]'\)/);
  assert.match(workspace, /setActiveTab\(next\)/);
  assert.match(workspace, /applyTabVisibility\(boardRoot\)/);
  assert.match(workspace, /window\.addEventListener\('click', handleWorkspaceClick, true\)/);
  assert.doesNotMatch(workspace, /function bindWorkspaceTabs\(boardRoot\)/);
});

test('manager board opens on the current month for every entry', () => {
  assert.match(workspace, /let resetMonthOnNextBoard = true;/);
  assert.match(workspace, /target\.closest\('\[data-manager-board-open\]'\)/);
  assert.match(workspace, /resetMonthOnNextBoard = true;/);
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
  assert.doesNotMatch(board, /const headerNav = document\.querySelector\('\.shell-header-nav'\)/);

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

test('checkpoints include course start and no old subtitle', () => {
  assert.match(board, /meeting\.meetingNo === 1 \|\| meeting\.isMidpoint \|\| meeting\.isEnd/);
  assert.match(board, /תחילת קורס · מפגש 1/);
  assert.doesNotMatch(board, /אמצע וסיום קורסים בחודש/);
});

test('direct assets and dashboard cache are versioned for the fix', () => {
  assert.match(index, /manager-board-runtime\.js\?v=20260818-manager-board-v2/);
  assert.match(index, /manager-board-workspace-runtime\.js\?v=20260818-manager-workspace-v4/);
  assert.match(sw, /const CACHE_VERSION = 1539;/);
  assert.match(config, /manager-workspace-current-month-clickable-tabs-sw-cache-1539-20260818-v1/);
});
