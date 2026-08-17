import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const guardSource = await readFile(new URL('../frontend/src/admin-permissions-access-hotfix.js', import.meta.url), 'utf8');
const entrySource = await readFile(new URL('../frontend/src/main-with-proposal-pdf-hotfix.js', import.meta.url), 'utf8');
const isolationSource = await readFile(new URL('../frontend/src/auth-session-isolation-hotfix.js', import.meta.url), 'utf8');
const stateSource = await readFile(new URL('../frontend/src/state.js', import.meta.url), 'utf8');
const inventoryPolishSource = await readFile(new URL('../frontend/src/screens/operations-inventory-polish.js', import.meta.url), 'utf8');
const featureLoadersSource = await readFile(new URL('../frontend/src/feature-loaders.js', import.meta.url), 'utf8');
const listsAuthHotfixSource = await readFile(new URL('../frontend/src/admin-lists-auth-hotfix.js', import.meta.url), 'utf8');

function frozenArrayBody(source, exportName) {
  const match = source.match(new RegExp(`export const ${exportName} = Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\);`));
  assert.ok(match, `${exportName} must remain an explicit frozen array`);
  return match[1];
}

test('admin lists screen remains admin-only while shared adminLists read is not blocked', () => {
  const routesBody = frozenArrayBody(guardSource, 'ADMIN_ONLY_ROUTES');
  const actionsBody = frozenArrayBody(guardSource, 'ADMIN_ONLY_API_ACTIONS');

  assert.match(routesBody, /['"]admin-lists['"]/);
  assert.doesNotMatch(actionsBody, /['"]adminLists['"]/);
  assert.match(actionsBody, /['"]savePermission['"]/);
  assert.match(actionsBody, /['"]adminSettings['"]/);
});

test('auth-session isolation loads before the main application bootstrap', () => {
  const isolationIndex = entrySource.indexOf("import './auth-session-isolation-hotfix.js';");
  const mainIndex = entrySource.indexOf("import './main.js';");
  assert.ok(isolationIndex >= 0, 'auth session isolation import is required');
  assert.ok(mainIndex > isolationIndex, 'isolation must install before main.js restores routes');
});

test('new tabs adopt the shared dashboard session instead of deleting it', () => {
  assert.match(stateSource, /hasStoredDashboardSession/);
  assert.match(stateSource, /sessionStorage\.setItem\('ds_session_alive', '1'\)/);
  assert.doesNotMatch(
    stateSource,
    /if \(!sessionStorage\.getItem\('ds_session_alive'\)\) \{\s*localStorage\.removeItem\('dashboard_token'\);\s*localStorage\.removeItem\('dashboard_user'\);\s*\}/
  );
});

test('cross-tab identity changes clear user-scoped caches and force a safe reload', () => {
  assert.match(isolationSource, /window\.addEventListener\('storage', handleStorageChange\)/);
  assert.match(isolationSource, /auth_user_changed_in_other_tab/);
  assert.match(isolationSource, /user_changed_in_other_tab/);
  assert.match(isolationSource, /supabase\.auth\.signOut\(\{ scope: 'local' \}\)/);
  assert.match(isolationSource, /INITIAL_SESSION_RETRY_MS/);
  assert.match(isolationSource, /session\?\.user\?\.id/);
});

test('admin inventory shortcut is removed without deleting inventory functionality', () => {
  assert.match(inventoryPolishSource, /\[data-ops-open-stock-edit\] \{ display: none !important; \}/);
  assert.match(inventoryPolishSource, /removeAdminInventoryShortcut/);
  assert.match(inventoryPolishSource, /button\.remove\(\)/);
});

test('operations feature loads admin-lists-auth-hotfix for direct 2027 inventory catalog retries', () => {
  const operationsCase = featureLoadersSource.match(/case 'operations':\s*return loadOnce\('operations', \(\) => Promise\.all\(\[([\s\S]*?)\]\)\)/);
  const adminCase = featureLoadersSource.match(/case 'admin':\s*return loadOnce\('admin', \(\) => Promise\.all\(\[([\s\S]*?)\]\)\)/);
  assert.ok(operationsCase, 'operations feature loader case must exist');
  assert.ok(adminCase, 'admin feature loader case must exist');
  assert.match(operationsCase[1], /admin-lists-auth-hotfix\.js/);
  assert.match(adminCase[1], /admin-lists-auth-hotfix\.js/);
  assert.match(listsAuthHotfixSource, /waitForSupabaseAuthSession/);
  assert.match(listsAuthHotfixSource, /\.from\('lists'\)/);
  assert.match(featureLoadersSource, /'operations-management':\s*\['operations'\]/);
});
