import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const usersMigration = await readFile(new URL('../supabase/migrations/20260717100000_secure_users_read_columns.sql', import.meta.url), 'utf8');
const reviewsMigration = await readFile(new URL('../supabase/migrations/20260717110000_create_annual_reviews.sql', import.meta.url), 'utf8');
const openReviewMigration = await readFile(new URL('../supabase/migrations/20260718120000_open_annual_review_to_manager_preparation.sql', import.meta.url), 'utf8');
const screen = await readFile(new URL('../frontend/src/screens/personal-reports.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../frontend/src/styles/main.css', import.meta.url), 'utf8');

test('authenticated REST cannot select entry_code for self or other users', () => {
  assert.match(usersMigration, /revoke select\s+on table public\.users\s+from public, anon, authenticated/i);
  assert.match(usersMigration, /execute format\([\s\S]*revoke select \(%s\) on table public\.users from anon, authenticated/i);
  assert.doesNotMatch(usersMigration.match(/grant select \(([\s\S]*?)\)\s+on table public\.users\s+to authenticated/i)?.[1] || '', /entry_code/i);
  assert.match(usersMigration, /has_column_privilege\([\s\S]*'authenticated'[\s\S]*'entry_code'[\s\S]*'select'[\s\S]*\)/i);
  assert.match(usersMigration, /raise exception[\s\S]*'Security invariant failed: authenticated can read entry_code'/i);
});

test('safe directory is invoker-secured and excludes sensitive identity columns', () => {
  assert.match(usersMigration, /create view public\.app_user_directory\s+with \(security_barrier = true\)/i);
  const view = usersMigration.match(/create view public\.app_user_directory([\s\S]*?)comment on view/i)?.[1] || '';
  assert.doesNotMatch(view, /entry_code|email|auth_user_id|permissions/i);
  assert.match(view, /user_id[\s\S]*coalesce\(full_name, name\) as name[\s\S]*display_role[\s\S]*emp_id[\s\S]*is_active/i);
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
  assert.match(reviewsMigration, /evaluations_participant_select[\s\S]*annual_review_is_employee\(review_id\)[\s\S]*manager_shared_at is not null/i);
  assert.match(reviewsMigration, /evaluations_manager_update[\s\S]*annual_review_is_manager\(review_id\)/i);
  assert.match(screen, /const evaluationVisible = isManager \|\| Boolean\(review\.manager_shared_at\)/);
  assert.match(screen, /המשוב נמצא בהכנת המנהל וטרם שותף איתך\./);
  assert.match(screen, /evaluationVisible \? `<section class="pr-card ar-section"><h2>הערכת המנהל/);
  assert.match(screen, /sharedContentVisible \? `<section class="pr-card ar-section"><h2>סיכום שיחת המשוב/);
  assert.match(screen, /share_manager_evaluation/);
});

test('locked review children reject writes and reopening is explicit and audited', () => {
  assert.match(reviewsMigration, /annual_review_is_editable[\s\S]*locked_at is null/i);
  assert.match(reviewsMigration, /raise exception 'annual_review_locked'/i);
  assert.match(reviewsMigration, /reopen_annual_review\(p_review_id uuid,p_expected_version bigint,p_reason text\)/i);
  assert.match(reviewsMigration, /reopen_reason_required/i);
  assert.match(reviewsMigration, /insert into public\.review_audit_log/i);
});

test('autosave uses optimistic version and cannot overwrite newer content', () => {
  assert.match(screen, /\.eq\('version', Number\(previous\)\)/);
  assert.match(screen, /המידע השתנה במקום אחר/);
  assert.match(screen, /data-version=/);
});

test('annual review workflow uses database operations instead of direct review updates', () => {
  for (const operation of [
    'open_review_for_employee', 'share_manager_evaluation', 'start_review_conversation',
    'finish_review_conversation', 'approve_review_as_employee', 'approve_review_as_manager',
    'complete_and_lock_review', 'reopen_annual_review'
  ]) assert.match(screen, new RegExp(operation));
  assert.doesNotMatch(screen, /submit_employee_preparation/);
  assert.doesNotMatch(screen, /employee_review_preparation/);
  assert.doesNotMatch(screen, /from\('annual_reviews'\)\.update\(/);
  assert.match(screen, /p_expected_version: review\.version/);
});

test('opening annual review routes directly to manager preparation through guarded transition', () => {
  assert.match(openReviewMigration, /create or replace function public\.open_review_for_employee/i);
  assert.match(openReviewMigration, /transition_annual_review\(\s*p_review_id,\s*p_expected_version,\s*'manager',\s*'not_opened',\s*'manager_preparation'/i);
  assert.doesNotMatch(openReviewMigration, /employee_preparation|submitted_to_manager/);
  assert.match(screen, /פתיחת המשוב והתחלת הערכת מנהל/);
});


test('annual review UI gates editable fields by status and participant ownership', () => {
  assert.match(screen, /canEditManagerEvaluation = isManager && review\.status === 'manager_preparation' && !locked/);
  assert.match(screen, /canEditManagerConversation = isManager && canEditConversation/);
  assert.match(screen, /canEditEmployeeVoice = isEmployee && canEditConversation/);
  assert.match(screen, /canEditEmployeeResponse = isEmployee && review\.status === 'awaiting_employee_response' && !review\.employee_approved_at && !locked/);
  assert.match(screen, /data-ar-form="conversation-manager"/);
  assert.match(screen, /data-ar-form="conversation-employee-voice"/);
  assert.match(screen, /data-can-edit="\$\{canEditGoals \? 'true' : 'false'\}"/);
});

test('conversation autosave sends only fields owned by the active participant', () => {
  assert.match(screen, /if \(form\.dataset\.arForm === 'conversation-manager'\) table = 'review_conversation_summary'/);
  assert.match(screen, /if \(form\.dataset\.arForm === 'conversation-employee-voice'\)[\s\S]*values\.employee_voice = Object\.fromEntries/);
  assert.match(screen, /Object\.keys\(values\)\.filter\(\(key\) => key\.startsWith\('employee_voice_'\)\)\.forEach/);
  assert.doesNotMatch(screen, /form\.dataset\.arForm === 'conversation'[\s\S]*values\.employee_voice/);
});

test('annual review saves expose visible save states and clear failures', () => {
  assert.match(screen, /setAnnualSaveState\(form, 'שומר\.\.\.', 'saving'\)/);
  assert.match(screen, /setAnnualSaveState\(form, 'נשמר', 'saved'\)/);
  assert.match(screen, /שמירת הטופס נכשלה/);
  assert.match(screen, /שמירת היעד נכשלה/);
  assert.match(screen, /שמירת הדירוג נכשלה/);
});

test('ratings comments and goals use version checks and conflict messaging', () => {
  assert.match(screen, /function updateVersionedRow\(table, idField, id, values, previousVersion\)/);
  assert.match(screen, /query = query\.eq\('version', Number\(previousVersion\)\)/);
  assert.match(screen, /annualReviewConflictMessage\(\)/);
  assert.match(screen, /data-evaluation-version/);
  assert.match(screen, /data-version="\$\{escapeHtml\(g\.version \|\| ''\)\}"/);
  assert.match(screen, /supabase\.from\('review_goals'\)\.delete\(\)\.eq\('id', id\)[\s\S]*\.eq\('version', Number\(row\.dataset\.version\)\)/);
});

test('annual review print is Hebrew RTL A4 and hides navigation', () => {
  assert.match(screen, /class="pr-screen ar-screen" dir="rtl"/);
  assert.match(screen, /הדפסה \/ שמירה כ-PDF/);
  assert.match(screen, /body\.classList\.add\(printClass\)/);
  assert.match(screen, /window\.addEventListener\('afterprint', cleanup, \{ once: true \}\)/);
  assert.match(screen, /catch \(error\)[\s\S]*cleanup\(\)/);
  assert.match(css, /@page\{size:A4/i);
  assert.match(css, /body\.is-annual-review-print\{direction:rtl/i);
  assert.match(css, /body\.is-annual-review-print \.pr-screen\.ar-screen \*,body\.is-annual-review-print \.ar-document,body\.is-annual-review-print \.ar-document \*\{visibility:visible!important/i);
  assert.match(css, /body\.is-annual-review-print \.no-print[\s\S]*display:none!important/i);
  assert.match(css, /white-space:pre-wrap/i);
  assert.match(css, /page-break-inside:avoid/i);
});

test('existing personal reports remain mounted and annual review is additive', () => {
  assert.match(screen, /renderInto\(root, myReportsDashboardHtml/);
  assert.match(screen, /await loadAnnualReviewAccess\(\)/);
  assert.match(screen, /not-yet-applied review migration must not break the existing reports screen/i);
});
