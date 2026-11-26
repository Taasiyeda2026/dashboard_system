import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const edge = await readFile(new URL('../supabase/functions/management-password-reset/index.ts', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20261126183000_entry_code_reset_audit.sql', import.meta.url), 'utf8');
const permissions = await readFile(new URL('../frontend/src/screens/permissions.js', import.meta.url), 'utf8');
const sw = await readFile(new URL('../frontend/sw.js', import.meta.url), 'utf8');
const config = await readFile(new URL('../frontend/src/config.js', import.meta.url), 'utf8');
const hebrew = await readFile(new URL('../frontend/src/screens/shared/ui-hebrew.js', import.meta.url), 'utf8');
const login = await readFile(new URL('../frontend/src/screens/login.js', import.meta.url), 'utf8');
const instructorRecovery = await readFile(new URL('../frontend/src/instructor-password-recovery-runtime.js', import.meta.url), 'utf8');

test('admin reset action requires admin role server-side and updates Auth', () => {
  assert.match(edge, /action === 'admin_reset'/);
  assert.match(edge, /actorRole !== 'admin'/);
  assert.match(edge, /get_current_app_user/);
  assert.match(edge, /encodeDigitsEntryCodeForAuth/);
  assert.match(edge, /admin\.auth\.admin\.updateUserById/);
  assert.match(edge, /invalidateOpenRecoveryChallenges/);
  assert.match(edge, /entry_code_reset_audit/);
  assert.match(edge, /channel: 'admin_reset'/);
  assert.match(edge, /MAX_ADMIN_RESETS_PER_TEN_MINUTES/);
  assert.doesNotMatch(edge, /SERVICE_ROLE_KEY.*payload/);
  assert.doesNotMatch(edge, /console\.(log|info|debug)\([^)]*new_entry_code/);
  assert.doesNotMatch(edge, /console\.(log|info|debug)\([^)]*encodedPassword/);
});

test('self recovery also audits success and invalidates open challenges', () => {
  assert.match(edge, /channel: 'self_recovery'/);
  assert.match(edge, /invalidateOpenRecoveryChallenges\(admin, String\(challenge\.user_id\)/);
});

test('audit migration is service-role only and never stores codes', () => {
  assert.match(migration, /create table if not exists public\.entry_code_reset_audit/);
  assert.match(migration, /channel in \('self_recovery', 'admin_reset'\)/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.entry_code_reset_audit from public, anon, authenticated/);
  assert.match(migration, /grant all on table public\.entry_code_reset_audit to service_role/);
  assert.doesNotMatch(migration, /entry_code text/);
  assert.doesNotMatch(migration, /password/);
});

test('permissions edit drawer includes independent admin entry-code reset UI', () => {
  assert.match(permissions, /איפוס קוד כניסה/);
  assert.match(permissions, /קוד כניסה חדש/);
  assert.match(permissions, /4–6 ספרות/);
  assert.match(permissions, /data-admin-reset-entry-code/);
  assert.match(permissions, /data-toggle-entry-code-visibility/);
  assert.match(permissions, /showEntryCodeReset: isAdmin && isActive/);
  assert.match(permissions, /action: 'admin_reset'/);
  assert.match(permissions, /new_entry_code: newCode/);
  assert.match(permissions, /קוד הכניסה עודכן בהצלחה/);
  assert.match(permissions, /האם לאפס את קוד הכניסה של המשתמש/);
  assert.match(permissions, /isValidNewEntryCode/);
  assert.doesNotMatch(permissions, /from\('users'\)\.update\(\{[^}]*entry_code:\s*newCode/);
  assert.doesNotMatch(permissions, /addUser\(\{[^}]*entry_code:\s*newCode/);
});

test('login and self recovery terminology stay aligned', () => {
  assert.match(login, /placeholder="קוד כניסה"/);
  assert.match(instructorRecovery, /שכחתי קוד כניסה/);
  assert.match(hebrew, /invalid_new_entry_code/);
  assert.match(hebrew, /not_authorized/);
});

test('cache and hotfix markers bumped for admin reset deploy', () => {
  assert.ok(Number(sw.match(/const CACHE_VERSION = (\d+);/)?.[1]) >= 2150);
  assert.match(config, /admin-entry-code-reset-20261126-v1/);
});

const activePermissions = await readFile(new URL('../frontend/src/admin-permissions-management-v2.js', import.meta.url), 'utf8');
test('active permissions workspace renders and binds admin reset before permissions groups', () => {
  assert.match(activePermissions, /function entryCodeResetHtml/);
  assert.match(activePermissions, /if \(!row \|\| !isAdmin\(\) \|\| !isActive\(row\)\) return ''/);
  assert.match(activePermissions, /\$\{entryCodeResetHtml\(row\)\}/);
  assert.match(activePermissions, /bindEntryCodeReset\(row, drawer\);/);
  assert.match(activePermissions, /action: 'admin_reset', target_user_id: String\(row.user_id\), new_entry_code: code/);
  assert.match(activePermissions, /isValidNewEntryCode\(code\)/);
  assert.match(activePermissions, /data-apm-reset-status/);
});
