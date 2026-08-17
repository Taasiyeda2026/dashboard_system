import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const runtime = await readFile(new URL('../frontend/src/management-password-runtime.js', import.meta.url), 'utf8');
const edge = await readFile(new URL('../supabase/functions/management-password-reset/index.ts', import.meta.url), 'utf8');
const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const config = await readFile(new URL('../frontend/src/config.js', import.meta.url), 'utf8');
const sw = await readFile(new URL('../frontend/sw.js', import.meta.url), 'utf8');

test('management password runtime supports forgot and authenticated password change', () => {
  assert.match(runtime, /שכחתי קוד כניסה/);
  assert.match(runtime, /functions\?\.invoke\('management-password-reset'/);
  assert.match(runtime, /auth\.updateUser\(\{ password \}\)/);
  assert.match(runtime, /PASSWORD_RECOVERY/);
  assert.match(runtime, /MIN_PASSWORD_LENGTH = 8/);
});

test('password change button is limited to management roles', () => {
  for (const role of [
    'admin', 'operation_manager', 'finance', 'activities_manager',
    'domain_manager', 'business_development_manager', 'instructor_manager'
  ]) {
    assert.match(runtime, new RegExp(`'${role}'`));
  }
  assert.doesNotMatch(runtime, /MANAGEMENT_ROLES[\s\S]{0,500}'instructor'/);
});

test('reset edge function validates management users without account enumeration', () => {
  assert.match(edge, /\.from\('users'\)/);
  assert.match(edge, /\.eq\('is_active', true\)/);
  assert.match(edge, /MANAGEMENT_ROLES\.has/);
  assert.match(edge, /resetPasswordForEmail\(email\)/);
  assert.match(edge, /return genericOk\(origin\)/);
  assert.match(edge, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(edge, /SUPABASE_ANON_KEY/);
});

test('dashboard loads password runtime and deploy markers are bumped', () => {
  assert.match(index, /management-password-runtime\.js\?v=20260818-management-password-v1/);
  assert.match(config, /management-password-recovery-20260818-v1/);
  assert.match(sw, /const CACHE_VERSION = 1542;/);
});
