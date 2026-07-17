import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const usersMigration = await readFile(new URL('../supabase/migrations/20260717100000_secure_users_read_columns.sql', import.meta.url), 'utf8');
const reviewsMigration = await readFile(new URL('../supabase/migrations/20260717110000_create_annual_reviews.sql', import.meta.url), 'utf8');
const screen = await readFile(new URL('../frontend/src/screens/personal-reports.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../frontend/src/styles/main.css', import.meta.url), 'utf8');

test('authenticated REST cannot select entry_code for self or other users', () => {
  assert.match(usersMigration, /revoke select on table public\.users from anon, authenticated/i);
  assert.match(usersMigration, /revoke select \(entry_code\).*from anon, authenticated/i);
  assert.doesNotMatch(usersMigration.match(/safe_columns text\[\] := array\[([\s\S]*?)\];/)?.[1] || '', /entry_code/i);
  assert.match(usersMigration, /has_column_privilege\('authenticated'.*'entry_code'.*'select'\)/is);
  assert.match(usersMigration, /raise exception 'Security invariant failed: entry_code is browser-readable'/i);
});

test('safe directory is invoker-secured and excludes sensitive identity columns', () => {
  assert.match(usersMigration, /create view public\.app_user_directory\s+with \(security_invoker = true\)/i);
  const view = usersMigration.match(/create view public\.app_user_directory([\s\S]*?)comment on view/i)?.[1] || '';
  assert.doesNotMatch(view, /entry_code|email|auth_user_id|permissions/i);
  assert.match(view, /user_id, name, full_name, display_role, emp_id, is_active/i);
});

test('review assignment is UUID-only, exactly four employees, and browser cannot provision it', () => {
  for (const key of ['tony_naim','hila_rozen','gil_neeman','eden_cohen']) assert.match(reviewsMigration, new RegExp(key));
  assert.match(reviewsMigration, /p_manager_id uuid, p_tony_id uuid, p_hila_id uuid, p_gil_id uuid, p_eden_id uuid/i);
  assert.match(reviewsMigration, /count\(distinct x\)[\s\S]*<> 5/i);
  assert.match(reviewsMigration, /revoke all on function public\.provision_annual_review_assignments[\s\S]*authenticated/i);
});

test('each review participant is scoped by auth.uid and admin role gets no bypass', () => {
  assert.match(reviewsMigration, /reviews_participant_select[\s\S]*auth\.uid\(\) in \(employee_id,manager_id\)/i);
  assert.match(reviewsMigration, /assignments_participant_select[\s\S]*auth\.uid\(\) in \(employee_id,manager_id\)/i);
  assert.doesNotMatch(reviewsMigration, /role\s*=\s*'admin'|role\s+in\s*\([^)]*admin/i);
});

test('employee cannot see an unshared manager draft', () => {
  assert.match(reviewsMigration, /evaluations_manager_select[\s\S]*annual_review_is_employee\(review_id\)[\s\S]*manager_shared_at is not null/i);
  assert.match(reviewsMigration, /evaluations_manager_write[\s\S]*annual_review_is_manager\(review_id\)/i);
});

test('locked review children reject writes and reopening is explicit and audited', () => {
  assert.match(reviewsMigration, /annual_review_is_editable[\s\S]*locked_at is null/i);
  assert.match(reviewsMigration, /raise exception 'annual_review_locked'/i);
  assert.match(reviewsMigration, /reopen_annual_review\(p_review_id uuid,p_reason text\)/i);
  assert.match(reviewsMigration, /reopen_reason_required/i);
  assert.match(reviewsMigration, /insert into public\.review_audit_log/i);
});

test('autosave uses optimistic version and cannot overwrite newer content', () => {
  assert.match(screen, /\.eq\('version', Number\(previous\)\)/);
  assert.match(screen, /המידע השתנה במקום אחר/);
  assert.match(screen, /data-version=/);
});

test('annual review print is Hebrew RTL A4 and hides navigation', () => {
  assert.match(screen, /class="pr-screen ar-screen" dir="rtl"/);
  assert.match(screen, /הדפסה \/ שמירה כ-PDF/);
  assert.match(css, /@page\{size:A4/i);
  assert.match(css, /@media print/i);
  assert.match(css, /\.no-print[^{]*\{display:none!important/i);
  assert.match(css, /page-break-inside:avoid/i);
});

test('existing personal reports remain mounted and annual review is additive', () => {
  assert.match(screen, /renderInto\(root, myReportsDashboardHtml/);
  assert.match(screen, /await mountAnnualReviewLanding\(root\)/);
  assert.match(screen, /not-yet-applied review migration must not break the existing reports screen/i);
});
