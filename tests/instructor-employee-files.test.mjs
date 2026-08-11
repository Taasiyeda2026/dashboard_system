import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { instructorCard } from '../frontend/src/screens/instructor-workspace-ui.js';
import { EMPLOYEE_FILE_COMPONENTS, employeeFileModalHtml } from '../frontend/src/screens/instructor-employee-file-ui.js';
import { canViewEmployeeFiles } from '../frontend/src/permissions.js';

const instructorsSource = fs.readFileSync(new URL('../frontend/src/screens/instructors.js', import.meta.url), 'utf8');
const apiSource = fs.readFileSync(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
const dataSource = fs.readFileSync(new URL('../frontend/src/screens/instructor-employee-file-data.js', import.meta.url), 'utf8');
const baseMigration = fs.readFileSync(new URL('../supabase/migrations/20260810233000_instructor_employee_files_sharepoint_metadata.sql', import.meta.url), 'utf8');
const liveMigration = fs.readFileSync(new URL('../supabase/migrations/20260811020500_employee_files_admin_link_and_live_sharepoint.sql', import.meta.url), 'utf8');
const edgeSource = fs.readFileSync(new URL('../supabase/functions/instructor-employee-file-live/index.ts', import.meta.url), 'utf8');

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

test('employee-file modal renders exactly eight compact components without judgment text', () => {
  assert.equal(EMPLOYEE_FILE_COMPONENTS.length, 8);
  const html = employeeFileModalHtml({ components: [{ component_key: 'signed_agreement', completed: true }] });
  assert.equal((html.match(/class="employee-file__row"/g) || []).length, 8);
  for (const forbidden of ['לא קיים', 'חסר', 'באיחור', '5/8', '62%', 'תיק מלא', 'תיק חסר']) assert.doesNotMatch(html, new RegExp(forbidden));
  assert.doesNotMatch(html, /[✕✖❌]/);
  assert.match(html, /justify-content:flex-start/);
});

test('SharePoint status is read-only and payroll shows document count only', () => {
  const html = employeeFileModalHtml({ components: [{ component_key: 'payroll_reports', item_count: 4 }] });
  assert.match(html, /📄/);
  assert.match(html, /employee-file__count[^>]*[^>]*>4<\/span>/);
  assert.doesNotMatch(html, /data-employee-file-toggle=/);
  assert.doesNotMatch(html, /data-employee-file-payroll=/);
});

test('non-admin sees only the SharePoint action, while admin gets collapsed link management', () => {
  const exact = 'https://think365orgil.sharepoint.com/sites/taasiyeda2027/Shared%20Documents/id-1507';
  const regular = employeeFileModalHtml({ folder_web_url: exact, can_edit_folder_url: false });
  assert.match(regular, /פתח תיק עובד ב־SharePoint/);
  assert.match(regular, /target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(regular, /data-employee-file-folder-url|data-employee-file-save-url|ניהול קישור/);

  const admin = employeeFileModalHtml({ folder_web_url: exact, can_edit_folder_url: true });
  assert.match(admin, /<details class="employee-file__admin-link">/);
  assert.match(admin, /ניהול קישור/);
  assert.match(admin, /data-employee-file-folder-url/);
  assert.match(admin, /data-employee-file-save-url/);
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
  assert.match(baseMigration, /unique \(school_year, emp_id\)/i);
  assert.match(baseMigration, /references public\.contacts_instructors\(emp_id\)/i);
  assert.match(baseMigration, /app_can_view_employee_files\(\)/);
  assert.match(baseMigration, /revoke all on public\.instructor_employee_folders from anon, authenticated/i);
});

test('folder-link mutation is admin-only on the server', () => {
  assert.match(liveMigration, /create or replace function public\.app_is_employee_files_admin/);
  assert.match(liveMigration, /if not public\.app_is_employee_files_admin\(\) then/);
  assert.match(liveMigration, /employee_files_admin_required/);
  assert.match(liveMigration, /can_edit_folder_url/);
  assert.match(liveMigration, /revoke execute on function public\.update_instructor_employee_file_component/);
});

test('live loader prefers the secured Edge Function and keeps RPC fallback', () => {
  assert.match(dataSource, /supabase\.functions\.invoke\('instructor-employee-file-live'/);
  assert.match(dataSource, /api\.instructorEmployeeFile/);
  assert.match(apiSource, /rpc\('get_instructor_employee_file_snapshot'/);
});

test('live SharePoint reader checks the eight fixed folders on demand without webhook or polling', () => {
  for (const folder of [
    '01 הסכם ומסמכים/הסכם חתום',
    '01 הסכם ומסמכים/מסמכים נלווים',
    '02 משובים/משוב היכרות',
    '02 משובים/משוב אמצע שנה',
    '02 משובים/משוב סוף שנה',
    '03 תצפיות/תצפית 1',
    '03 תצפיות/תצפית 2',
    '04 דוחות שכר'
  ]) assert.match(edgeSource, new RegExp(folder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(edgeSource, /MS_TENANT_ID/);
  assert.match(edgeSource, /MS_CLIENT_ID/);
  assert.match(edgeSource, /MS_CLIENT_SECRET/);
  assert.match(edgeSource, /https:\/\/graph\.microsoft\.com\/\.default/);
  assert.match(edgeSource, /\/children\?\$select=id,name,file,folder/);
  assert.doesNotMatch(edgeSource, /webhook|delta|subscription|polling/i);
});
