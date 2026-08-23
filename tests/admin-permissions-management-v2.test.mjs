import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const runtime = await readFile(new URL('../frontend/src/admin-permissions-management-v2.js', import.meta.url), 'utf8');
const bootstrap = await readFile(new URL('../frontend/src/main-with-proposal-pdf-hotfix.js', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20260823054500_employee_profiles_admin_management.sql', import.meta.url), 'utf8');

test('permissions workspace is explicitly admin-only and separates active/inactive employees', () => {
  assert.match(runtime, /=== ADMIN_ROLE/);
  assert.match(runtime, /data-apm-status=\"active\"/);
  assert.match(runtime, /data-apm-status=\"inactive\"/);
  assert.match(runtime, /חיפוש לפי שם, מס׳ עובד, מייל או טלפון/);
});

test('employee editor manages identity, contact details and permissions together', () => {
  for (const field of ['full_name', 'emp_id', 'email', 'mobile', 'address', 'birth_date', 'direct_manager', 'employment_type']) {
    assert.match(runtime, new RegExp(`data-apm-field=\\"${field}\\"`));
  }
  assert.match(runtime, /data-apm-permission/);
  assert.match(runtime, /api\.savePermission/);
  assert.match(runtime, /employee_profiles/);
});

test('new instructors and permission records stay linked by employee number', () => {
  assert.match(migration, /sync_instructor_contact_to_employee_profile/);
  assert.match(migration, /sync_user_to_employee_profile/);
  assert.match(migration, /emp_id text unique/);
  assert.match(migration, /u\.role = 'admin'/);
});

test('redesigned permissions runtime is loaded by the application bootstrap', () => {
  assert.match(bootstrap, /admin-permissions-management-v2\.js\?v=20260823-v2/);
});
