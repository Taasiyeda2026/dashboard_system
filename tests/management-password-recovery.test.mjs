import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const runtime = await readFile(new URL('../frontend/src/management-password-runtime.js', import.meta.url), 'utf8');
const edge = await readFile(new URL('../supabase/functions/management-password-reset/index.ts', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20260818022500_password_recovery_email_code_challenges.sql', import.meta.url), 'utf8');
const recoveryTemplate = await readFile(new URL('../supabase/templates/recovery.html', import.meta.url), 'utf8');
const supabaseConfig = await readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8');
const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const sw = await readFile(new URL('../frontend/sw.js', import.meta.url), 'utf8');

test('password runtime uses an emailed one-time code instead of a clickable recovery link', () => {
  assert.match(runtime, /שכחתי קוד כניסה/);
  assert.match(runtime, /קוד אימות בן 6 ספרות/);
  assert.match(runtime, /action: 'request'/);
  assert.match(runtime, /action: 'complete'/);
  assert.match(runtime, /challenge_id: challengeId/);
  assert.match(runtime, /new_password: password/);
  assert.doesNotMatch(runtime, /PASSWORD_RECOVERY/);
  assert.doesNotMatch(runtime, /type=recovery/);
});

test('authenticated password change remains limited to management roles', () => {
  assert.match(runtime, /auth\.updateUser\(\{ password \}\)/);
  for (const role of [
    'admin', 'operation_manager', 'finance', 'activities_manager',
    'domain_manager', 'business_development_manager', 'instructor_manager'
  ]) {
    assert.match(runtime, new RegExp(`'${role}'`));
  }
  assert.doesNotMatch(runtime, /MANAGEMENT_ROLES[\s\S]{0,500}'instructor'/);
});

test('reset edge function sends and verifies recovery OTP through Supabase Auth', () => {
  assert.match(edge, /resetPasswordForEmail\(email\)/);
  assert.match(edge, /verifyOtp\(\{/);
  assert.match(edge, /type: 'recovery'/);
  assert.match(edge, /verifiedUserId !== String\(challenge\.auth_user_id\)/);
  assert.match(edge, /password_recovery_challenges/);
  assert.match(edge, /MAX_CODE_ATTEMPTS = 5/);
  assert.match(edge, /CHALLENGE_MINUTES = 10/);
  assert.match(edge, /admin\.auth\.admin\.updateUserById/);
  assert.doesNotMatch(edge, /graph\.microsoft\.com/);
  assert.doesNotMatch(edge, /sendMail/);
  assert.doesNotMatch(edge, /MS_CLIENT_SECRET/);
});

test('recovery email template contains only a six digit Supabase token and no recovery link', () => {
  assert.match(recoveryTemplate, /\{\{ \.Token \}\}/);
  assert.doesNotMatch(recoveryTemplate, /ConfirmationURL/);
  assert.doesNotMatch(recoveryTemplate, /href=/);
  assert.match(supabaseConfig, /\[remotes\.main\]/);
  assert.match(supabaseConfig, /project_id = "szinlhjuwyiyszdpsdop"/);
  assert.match(supabaseConfig, /\[remotes\.main\.auth\.email\.template\.recovery\]/);
  assert.match(supabaseConfig, /content_path = "\.\/supabase\/templates\/recovery\.html"/);
});

test('employee 9901 is the only instructor explicitly admitted to the recovery pilot', () => {
  assert.match(edge, /const TEST_EMPLOYEE_ID = '9901'/);
  assert.match(edge, /role === 'instructor'/);
  assert.match(edge, /String\(row\.user_id \|\| ''\)\.trim\(\) === TEST_EMPLOYEE_ID/);
  assert.match(edge, /String\(row\.emp_id \|\| ''\)\.trim\(\) === TEST_EMPLOYEE_ID/);
  assert.match(edge, /\.eq\('user_id', TEST_EMPLOYEE_ID\)/);
  assert.match(edge, /\.eq\('emp_id', TEST_EMPLOYEE_ID\)/);
});

test('recovery challenge table is server-only and RLS protected', () => {
  assert.match(migration, /create table if not exists public\.password_recovery_challenges/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.password_recovery_challenges from anon, authenticated/);
  assert.match(migration, /grant all on table public\.password_recovery_challenges to service_role/);
});

test('dashboard deploy markers remain on recovery v2 because frontend is unchanged', () => {
  assert.match(index, /management-password-runtime\.js\?v=20260818-management-password-v2/);
  assert.match(sw, /const CACHE_VERSION = 1543;/);
});
