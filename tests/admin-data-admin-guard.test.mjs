import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const guard = await readFile(new URL('../frontend/src/admin-data-admin-guard.js', import.meta.url), 'utf8');
const bootstrap = await readFile(new URL('../frontend/src/main-with-proposal-pdf-hotfix.js', import.meta.url), 'utf8');

test('admin data tool is explicitly restricted to admin role', () => {
  assert.match(guard, /const ADMIN_ROLE = 'admin'/);
  assert.match(guard, /state\?\.user\?\.role \|\| state\?\.user\?\.display_role/);
  assert.match(guard, /normalizedRole\(\) === ADMIN_ROLE/);
  assert.match(guard, /data-admin-data-tool/);
  assert.match(guard, /data-admin-data-show/);
  assert.match(guard, /stopImmediatePropagation/);
  assert.match(guard, /closeUnauthorizedDataUi/);
});

test('admin data guard is loaded by the application bootstrap', () => {
  assert.match(bootstrap, /admin-data-admin-guard\.js\?v=20260823-v1/);
});
