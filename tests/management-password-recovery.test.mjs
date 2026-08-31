import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const runtime = await readFile(new URL('../frontend/src/management-password-runtime.js', import.meta.url), 'utf8');
const instructorRecovery = await readFile(new URL('../frontend/src/instructor-password-recovery-runtime.js', import.meta.url), 'utf8');
const edge = await readFile(new URL('../supabase/functions/management-password-reset/index.ts', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20260818022500_password_recovery_email_code_challenges.sql', import.meta.url), 'utf8');
const recoveryTemplate = await readFile(new URL('../supabase/templates/recovery.html', import.meta.url), 'utf8');
const supabaseConfig = await readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8');
const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const sw = await readFile(new URL('../frontend/sw.js', import.meta.url), 'utf8');

test('password recovery uses an emailed one-time code instead of a clickable recovery link', () => {
  assert.match(runtime, /שכחתי קוד כניסה/);
  assert.match(instructorRecovery, /קוד אימות בן 6 ספרות/);
  assert.match(instructorRecovery, /action: 'request'/);
  assert.match(instructorRecovery, /action: 'complete'/);
  assert.match(instructorRecovery, /challenge_id: challengeId/);
  assert.match(instructorRecovery, /new_password: password/);
  assert.doesNotMatch(instructorRecovery, /PASSWORD_RECOVERY/);
  assert.doesNotMatch(instructorRecovery, /type=recovery/);
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

test('active instructors require explicit recovery permission and Avigdor remains blocked', () => {
  assert.match(edge, /const RECOVERY_PERMISSION = 'access_password_recovery'/);
  assert.match(edge, /const BLOCKED_INSTRUCTOR_EMP_ID = '1519'/);
  assert.match(edge, /role === INSTRUCTOR_ROLE/);
  assert.match(edge, /permissionEnabled\(row, RECOVERY_PERMISSION\)/);
  assert.match(edge, /String\(row\.emp_id \|\| ''\)\.trim\(\) !== BLOCKED_INSTRUCTOR_EMP_ID/);
  assert.match(edge, /\.select\('user_id,emp_id,email,auth_email,auth_user_id,role,is_active,permissions'\)/);
  assert.doesNotMatch(edge, /TEST_EMPLOYEE_ID/);
});

test('instructor recovery accepts the registered email instead of requiring a think.org.il address', () => {
  assert.match(instructorRecovery, /הזינו את המייל הרשום במערכת/);
  assert.match(instructorRecovery, /name@example\.com/);
  assert.match(instructorRecovery, /\[\^\\s@\]\+@\[\^\\s@\]\+\\\.\[\^\\s@\]\+/);
  assert.doesNotMatch(instructorRecovery, /endsWith\('@think\.org\.il'\)/);
  assert.match(edge, /isValidEmail\(email\)/);
  assert.doesNotMatch(edge, /endsWith\('@think\.org\.il'\)/);
});

test('recovery challenge table is server-only and RLS protected', () => {
  assert.match(migration, /create table if not exists public\.password_recovery_challenges/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.password_recovery_challenges from anon, authenticated/);
  assert.match(migration, /grant all on table public\.password_recovery_challenges to service_role/);
});

test('dashboard deploy markers include instructor recovery and current cache', () => {
  assert.match(index, /instructor-password-recovery-runtime\.js\?v=20260901-instructor-recovery-v1/);
  assert.match(sw, /const CACHE_VERSION = 1641;/);
});
