import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { instructorCard } from '../frontend/src/screens/instructor-workspace-ui.js';
import { EMPLOYEE_FILE_COMPONENTS, employeeFileModalHtml } from '../frontend/src/screens/instructor-employee-file-ui.js';
import { canViewEmployeeFiles } from '../frontend/src/permissions.js';

const instructorsSource = fs.readFileSync(new URL('../frontend/src/screens/instructors.js', import.meta.url), 'utf8');
const apiSource = fs.readFileSync(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260810233000_instructor_employee_files_sharepoint_metadata.sql', import.meta.url), 'utf8');
const envExample = fs.readFileSync(new URL('../.env.example', import.meta.url), 'utf8');

const row = (active = 'yes', gender = null) => ({ emp_id: 1507, full_name: 'אלכס זפקה', active, scheduling_profile: gender ? { gender } : null });

test('employee-file icon is shown only for active instructors with permission', () => {
  assert.match(instructorCard(row('yes'), { canViewEmployeeFiles: true }), /data-instructor-employee-file="1507"/);
  assert.doesNotMatch(instructorCard(row('no'), { canViewEmployeeFiles: true }), /data-instructor-employee-file/);
  assert.doesNotMatch(instructorCard(row('yes'), { canViewEmployeeFiles: false }), /data-instructor-employee-file/);
});

test('employee-file icon uses existing gender colors and neutral fallback', () => {
  assert.match(instructorCard(row('yes', 'male'), { canViewEmployeeFiles: true }), /employee-file-action--male/);
  assert.match(instructorCard(row('yes', 'female'), { canViewEmployeeFiles: true }), /employee-file-action--female/);
  assert.match(instructorCard(row('yes'), { canViewEmployeeFiles: true }), /employee-file-action--neutral/);
});

test('card keeps separate profile and employee-file buttons', () => {
  const html = instructorCard(row(), { canViewEmployeeFiles: true });
  assert.match(html, /^<article class="instructor-card-shell"><button[^>]+data-instructor-profile/);
  assert.match(html, /<\/button><button[^>]+data-instructor-employee-file/);
  assert.match(html, /title="תיק עובד" aria-label="תיק עובד"/);
  assert.match(instructorsSource, /event\.stopPropagation\(\)/);
  assert.match(instructorsSource, /querySelectorAll\('\[data-instructor-profile\]'\)/);
});

test('employee-file modal renders exactly eight approved components without judgment text', () => {
  assert.equal(EMPLOYEE_FILE_COMPONENTS.length, 8);
  const html = employeeFileModalHtml({ components: [{ component_key: 'signed_agreement', completed: true }] });
  assert.equal((html.match(/class="employee-file__row"/g) || []).length, 8);
  for (const forbidden of ['קיים', 'לא קיים', 'חסר', 'באיחור', '5/8', '62%', 'תיק מלא', 'תיק חסר']) assert.doesNotMatch(html, new RegExp(forbidden));
  assert.doesNotMatch(html, /[✕✖❌]/);
});

test('payroll displays only document icon and count', () => {
  const html = employeeFileModalHtml({ components: [{ component_key: 'payroll_reports', item_count: 4 }] });
  assert.match(html, /employee-file__payroll[^>]*>[\s\S]*📄[\s\S]*<b data-employee-file-payroll-count>4<\/b>/);
  assert.doesNotMatch(html, /month|חודש/iu);
  assert.match(html, /data-employee-file-payroll="increment"/);
  assert.match(html, /data-employee-file-payroll="decrement"/);
});

test('folder uses exact stored URL and missing URL exposes only a neutral note', () => {
  const exact = 'https://think365orgil.sharepoint.com/sites/taasiyeda2027/Shared%20Documents/id-1507';
  assert.match(employeeFileModalHtml({ folder_web_url: exact }), new RegExp(exact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(employeeFileModalHtml({ folder_web_url: exact }), /target="_blank" rel="noopener noreferrer"/);
  const missing = employeeFileModalHtml({ components: [] });
  assert.doesNotMatch(missing, /sharepoint\.com|פתח תיק עובד/iu);
  assert.match(missing, /קישור התיק טרם הוגדר/);
});

test('employee-file frontend uses explicit permission when present and approved-role fallback when permission is absent', () => {
  for (const role of ['admin','operation_manager','finance','activities_manager','domain_manager','business_development_manager','instructor_manager']) {
    assert.equal(canViewEmployeeFiles({ role, permissions: { view_employee_files: 'yes' } }), true, `${role}: explicit yes`);
    assert.equal(canViewEmployeeFiles({ role }), true, `${role}: role fallback`);
    assert.equal(canViewEmployeeFiles({ role, permissions: { view_employee_files: 'no' } }), false, `${role}: explicit no wins`);
  }
  assert.equal(canViewEmployeeFiles({ role: 'authorized_user' }), false);
  assert.equal(canViewEmployeeFiles({ role: 'authorized_user', permissions: { view_employee_files: 'yes' } }), true);
  assert.equal(canViewEmployeeFiles({ role: 'authorized_user', permissions: { view_employee_files: 'no' } }), false);
});

test('database contract prevents duplicate instructor and folder mappings', () => {
  assert.match(migration, /unique \(school_year, emp_id\)/i);
  assert.match(migration, /references public\.contacts_instructors\(emp_id\)/i);
  assert.match(migration, /app_can_view_employee_files\(\)/);
  assert.match(migration, /revoke all on public\.instructor_employee_folders from anon, authenticated/i);
});

test('dashboard snapshot contract returns metadata only', () => {
  const rpc = migration.slice(migration.indexOf('create or replace function public.get_instructor_employee_file_snapshot'));
  for (const forbidden of ['file_name', 'filename', 'content', 'ocr', 'amount']) assert.doesNotMatch(rpc, new RegExp(`['"]${forbidden}['"]`, 'i'));
  assert.match(apiSource, /rpc\('get_instructor_employee_file_snapshot'/);
  assert.doesNotMatch(apiSource.slice(apiSource.indexOf('instructorEmployeeFile:'), apiSource.indexOf('instructorEmployeeFile:') + 1800), /folder_item_id|drive_id|file_name|content/);
});

test('manual model contains no unused Microsoft Graph or Azure configuration', () => {
  for (const key of ['MS_TENANT_ID', 'MS_CLIENT_ID', 'MS_CLIENT_SECRET', 'MS_GRAPH_WEBHOOK_CLIENT_STATE']) {
    assert.doesNotMatch(envExample, new RegExp(key));
  }
  assert.doesNotMatch(migration, /graph|webhook|delta|subscription|site_id|drive_id|folder_item_id/i);
  assert.equal(fs.existsSync(new URL('../supabase/functions/_shared/sharepoint-contract.ts', import.meta.url)), false);
});

test('manual component and payroll updates are permission checked and non-negative', () => {
  assert.match(migration, /create or replace function public\.update_instructor_employee_file_component/);
  assert.match(migration, /mapping_id := public\.employee_file_active_mapping/);
  assert.match(migration, /if not public\.app_can_view_employee_files\(\)/);
  assert.match(migration, /if p_item_count < 0 then raise exception/);
  assert.match(migration, /completed boolean not null default false/);
  assert.match(migration, /updated_by uuid default auth\.uid\(\)/);
  assert.match(apiSource, /rpc\('update_instructor_employee_file_component'/);
});

test('manual UI exposes immediate checklist, payroll and folder-link controls', () => {
  const html = employeeFileModalHtml({ components: [] });
  assert.equal((html.match(/data-employee-file-toggle=/g) || []).length, 7);
  assert.match(html, /data-employee-file-payroll="increment"/);
  assert.match(html, /data-employee-file-payroll="decrement"/);
  assert.match(html, /data-employee-file-folder-url/);
  assert.match(instructorsSource, /saveInstructorEmployeeFileComponent/);
  assert.match(instructorsSource, /Math\.max\(0, currentCount - 1\)/);
  assert.match(instructorsSource, /saveInstructorEmployeeFolderUrl/);
});