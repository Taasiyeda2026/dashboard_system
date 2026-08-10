import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { instructorCard } from '../frontend/src/screens/instructor-workspace-ui.js';
import { EMPLOYEE_FILE_COMPONENTS, employeeFileModalHtml } from '../frontend/src/screens/instructor-employee-file-ui.js';
import { canViewEmployeeFiles } from '../frontend/src/permissions.js';

const instructorsSource = fs.readFileSync(new URL('../frontend/src/screens/instructors.js', import.meta.url), 'utf8');
const apiSource = fs.readFileSync(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260810233000_instructor_employee_files_sharepoint_metadata.sql', import.meta.url), 'utf8');
const sharePointContract = fs.readFileSync(new URL('../supabase/functions/_shared/sharepoint-contract.ts', import.meta.url), 'utf8');
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
  const html = employeeFileModalHtml({ components: [{ component_key: 'signed_agreement', present: true }] });
  assert.equal((html.match(/class="employee-file__row"/g) || []).length, 8);
  for (const forbidden of ['קיים', 'לא קיים', 'חסר', 'באיחור', '5/8', '62%', 'תיק מלא', 'תיק חסר']) assert.doesNotMatch(html, new RegExp(forbidden));
  assert.doesNotMatch(html, /[✕✖❌]/);
});

test('payroll displays only document icon and count', () => {
  const html = employeeFileModalHtml({ components: [{ component_key: 'payroll_reports', item_count: 4 }] });
  assert.match(html, /employee-file__payroll[^>]*>[\s\S]*📄[\s\S]*<b>4<\/b>/);
  assert.doesNotMatch(html, /month|חודש/iu);
});

test('mapped folder uses exact stored URL and unmapped payload exposes no link', () => {
  const exact = 'https://think365orgil.sharepoint.com/sites/taasiyeda2027/Shared%20Documents/id-1507';
  assert.match(employeeFileModalHtml({ mapped: true, folder_web_url: exact }), new RegExp(exact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(employeeFileModalHtml({ mapped: true, folder_web_url: exact }), /target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(employeeFileModalHtml({ mapped: false, components: [] }), /sharepoint\.com|פתח תיק/iu);
});

test('dedicated permission is the frontend source of truth', () => {
  for (const role of ['admin','operation_manager','finance','activities_manager','domain_manager','business_development_manager','instructor_manager']) {
    assert.equal(canViewEmployeeFiles({ role, permissions: { view_employee_files: 'yes' } }), true, role);
  }
  assert.equal(canViewEmployeeFiles({ role: 'admin' }), false);
  assert.equal(canViewEmployeeFiles({ role: 'authorized_user', permissions: { view_employee_files: 'no' } }), false);
  assert.equal(canViewEmployeeFiles({ role: 'admin', permissions: { view_employee_files: 'no' } }), false);
});

test('database contract prevents duplicate instructor and folder mappings', () => {
  assert.match(migration, /unique \(school_year, emp_id\)/i);
  assert.match(migration, /unique \(site_id, drive_id, folder_item_id\)/i);
  assert.match(migration, /references public\.contacts_instructors\(emp_id\)/i);
  assert.match(migration, /app_can_view_employee_files\(\)/);
  assert.match(migration, /revoke all on public\.instructor_employee_folders from anon, authenticated/i);
});

test('dashboard snapshot contract returns metadata only', () => {
  const rpc = migration.slice(migration.indexOf('create or replace function public.get_instructor_employee_file_snapshot'));
  for (const forbidden of ['file_name', 'filename', 'content', 'ocr', 'amount']) assert.doesNotMatch(rpc, new RegExp(`['"]${forbidden}['"]`, 'i'));
  assert.match(apiSource, /rpc\('get_instructor_employee_file_snapshot'/);
  assert.doesNotMatch(apiSource.slice(apiSource.indexOf('instructorEmployeeFile:'), apiSource.indexOf('instructorEmployeeFile:') + 900), /folder_item_id|drive_id|file_name|content/);
});

test('SharePoint interface fixes the approved taxonomy and keeps credentials server-only', () => {
  for (const path of ['01 הסכם ומסמכים', 'הסכם חתום', 'מסמכים נלווים', '02 משובים', 'משוב היכרות', 'משוב אמצע שנה', 'משוב סוף שנה', '03 תצפיות', 'תצפית 1', 'תצפית 2', '04 דוחות שכר']) {
    assert.match(sharePointContract, new RegExp(path));
  }
  for (const key of ['MS_TENANT_ID', 'MS_CLIENT_ID', 'MS_CLIENT_SECRET', 'MS_GRAPH_WEBHOOK_CLIENT_STATE']) {
    assert.match(sharePointContract, new RegExp(`Deno\\.env\\.get\\('${key}'\\)`));
    assert.match(envExample, new RegExp(`^${key}=$`, 'm'));
    assert.doesNotMatch(envExample, new RegExp(`^VITE_${key}=`, 'm'));
  }
});
