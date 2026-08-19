import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { instructorCard } from '../frontend/src/screens/instructor-workspace-ui.js';
import { EMPLOYEE_FILE_COMPONENTS, employeeFileModalHtml } from '../frontend/src/screens/instructor-employee-file-ui.js';
import { canViewEmployeeFiles } from '../frontend/src/permissions.js';
import { refreshAfterEmployeeFileMutation } from '../frontend/src/screens/instructor-employee-file-data.js';

const instructorsSource = fs.readFileSync(new URL('../frontend/src/screens/instructors.js', import.meta.url), 'utf8');
const apiSource = fs.readFileSync(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
const dataSource = fs.readFileSync(new URL('../frontend/src/screens/instructor-employee-file-data.js', import.meta.url), 'utf8');
const baseMigration = fs.readFileSync(new URL('../supabase/migrations/20260810233000_instructor_employee_files_sharepoint_metadata.sql', import.meta.url), 'utf8');
const liveMigration = fs.readFileSync(new URL('../supabase/migrations/20260811020235_employee_files_admin_link_and_live_sharepoint.sql', import.meta.url), 'utf8');
const mutationSyncMigration = fs.readFileSync(new URL('../supabase/migrations/20260817044401_employee_file_refresh_on_actual_folder_change.sql', import.meta.url), 'utf8');
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

test('employee-file modal keeps the 3-3-2 structure (police_clearance next to signed_agreement/supporting_documents) with balanced outer spacing and quiet missing dots', () => {
  assert.equal(EMPLOYEE_FILE_COMPONENTS.length, 9);
  const html = employeeFileModalHtml({ emp_id: 1507, components: [{ component_key: 'signed_agreement', completed: true }] });
  assert.match(html, /data-employee-file-emp-id="1507"/);
  assert.match(html, /employee-file__group--agreements[^]*signed_agreement[^]*supporting_documents[^]*police_clearance/);
  assert.match(html, /employee-file__group--feedback[^]*intro_feedback[^]*midyear_feedback[^]*year_end_feedback/);
  assert.match(html, /employee-file__group--observations[^]*observation_1[^]*observation_2/);
  assert.equal((html.match(/class="employee-file__card /g) || []).length, 8);
  assert.equal((html.match(/employee-file__card is-completed/g) || []).length, 1);
  assert.equal((html.match(/employee-file__card is-missing/g) || []).length, 7);
  assert.match(html, /\.employee-file__card\.is-missing[^}]*background:#d94b57/);
  assert.match(html, /width:min\(404px,calc\(100vw - 24px\)\)/);
  assert.match(html, /\.ds-modal--employee-file \.ds-modal__content\{width:100%;max-width:100%;padding:14px 18px 12px/);
  assert.match(html, /\.employee-file\{display:grid;gap:12px;width:100%;max-width:100%/);
  for (const forbidden of ['לא קיים', 'חסר', 'באיחור', '5/8', '62%', 'תיק מלא', 'תיק חסר']) assert.doesNotMatch(html, new RegExp(forbidden));
  assert.doesNotMatch(html, /type="radio"|type="checkbox"|employee-file__list/);
});

test('SharePoint status is read-only and payroll shows all school-year months', () => {
  const html = employeeFileModalHtml({ components: [{ component_key: 'payroll_reports', item_count: 4 }] });
  assert.equal((html.match(/employee-file__payroll-cell (?:is-completed|is-missing)"/g) || []).length, 12);
  assert.equal((html.match(/employee-file__payroll-cell is-completed/g) || []).length, 4);
  assert.equal((html.match(/employee-file__payroll-cell is-missing/g) || []).length, 8);
  assert.equal((html.match(/class="employee-file__payroll-month"/g) || []).length, 12);
  for (const month of ['ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳', 'ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יונ׳', 'יול׳', 'אוג׳']) assert.match(html, new RegExp(month));
  assert.match(html, /employee-file__payroll-title">דוחות שכר<\/div><div class="employee-file__payroll-grid">/);
  assert.match(html, /grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
  assert.match(html, /employee-file__payroll-month\{color:#788596;font-size:\.56rem/);
  assert.doesNotMatch(html, />[+-]</);
  assert.doesNotMatch(html, /data-employee-file-toggle=/);
  assert.doesNotMatch(html, /data-employee-file-payroll=/);
});

test('non-admin sees only the SharePoint action, while admin gets collapsed link management', () => {
  const exact = 'https://think365orgil.sharepoint.com/sites/taasiyeda2027/Shared%20Documents/id-1507';
  const regular = employeeFileModalHtml({ folder_web_url: exact, can_edit_folder_url: false });
  assert.match(regular, />פתח תיק עובד<\/a>/);
  assert.match(regular, /target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(regular, /data-employee-file-folder-url|data-employee-file-save-url|ניהול הקישור/);

  const admin = employeeFileModalHtml({ folder_web_url: exact, can_edit_folder_url: true });
  assert.match(admin, /<details class="employee-file__admin-link">/);
  assert.match(admin, /ניהול הקישור/);
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

test('employee-file opens from snapshot and schedules one non-blocking SharePoint refresh on every open', () => {
  const loaderSource = dataSource.slice(dataSource.indexOf('export async function loadInstructorEmployeeFile'), dataSource.indexOf('export async function refreshInstructorEmployeeFileSnapshot'));
  assert.match(loaderSource, /api\.instructorEmployeeFile/);
  assert.match(loaderSource, /scheduleEmployeeFileRefresh\(empId, schoolYear\)/);
  assert.doesNotMatch(loaderSource, /await refreshInstructorEmployeeFileSnapshot/);
  assert.match(dataSource, /setTimeout\(\(\) => \{[^]*refreshInstructorEmployeeFileSnapshot\(empId, schoolYear\)[^]*applyEmployeeFileSnapshotToOpenModal/);
  assert.match(dataSource, /body: \{ empId, schoolYear, refresh: true \}/);
  assert.match(dataSource, /createEmployeeFileSharePointReturnSync\(\)[^]*markSharePointOpened\(\) \{\}/);
  assert.match(apiSource, /rpc\('get_instructor_employee_file_snapshot'/);
});

test('a successful employee-file mutation refreshes the snapshot exactly once and failures do not scan', async () => {
  const calls = [];
  const saved = await refreshAfterEmployeeFileMutation(
    async () => { calls.push('mutation'); return { folder_web_url: 'saved' }; },
    async () => { calls.push('refresh'); }
  );
  assert.deepEqual(calls, ['mutation', 'refresh']);
  assert.equal(saved.folder_web_url, 'saved');

  calls.length = 0;
  const unchanged = await refreshAfterEmployeeFileMutation(
    async () => { calls.push('mutation'); return { folder_web_url: 'saved', changed: false }; },
    async () => { calls.push('refresh'); }
  );
  assert.equal(unchanged.changed, false);
  assert.deepEqual(calls, ['mutation']);

  calls.length = 0;
  await assert.rejects(refreshAfterEmployeeFileMutation(
    async () => { calls.push('mutation'); throw new Error('unchanged'); },
    async () => { calls.push('refresh'); }
  ), /unchanged/);
  assert.deepEqual(calls, ['mutation']);
  assert.match(mutationSyncMigration, /previous_url is distinct from clean_url/);
  assert.match(mutationSyncMigration, /'changed', did_change/);
});

test('live SharePoint reader refreshes only when requested and supports canonical and sharing links', () => {
  assert.match(edgeSource, /const refresh = body\?\.refresh === true/);
  assert.match(edgeSource, /if \(!refresh\)[^]*reason: "snapshot_only"/);
  assert.ok(edgeSource.indexOf('if (!refresh)') < edgeSource.indexOf('const token = await graphToken()'));
  assert.match(edgeSource, /await persistComponents\(empId, schoolYear, components\)/);
  assert.match(edgeSource, /function graphShareId\(url: string\)/);
  assert.match(edgeSource, /\/shares\/\$\{encodeURIComponent\(shareId\)\}\/driveItem/);
  assert.match(edgeSource, /listFolderFilesFromItem/);
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
