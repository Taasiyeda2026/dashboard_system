import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canManageInstructorOnboarding, canReviewRequests, canSendActivityCoordinationApprovals } from '../frontend/src/permissions.js';
import { hasPermission } from '../frontend/src/permission-policy.js';

const migrationUrl = new URL('../supabase/migrations/20260823200000_apply_approved_permission_matrix.sql', import.meta.url);
const sql = await readFile(migrationUrl, 'utf8');
const registry = await readFile(new URL('../frontend/src/capability-registry.js', import.meta.url), 'utf8');
const instructors = await readFile(new URL('../frontend/src/screens/instructors.js', import.meta.url), 'utf8');
const coordinationEdge = await readFile(new URL('../supabase/functions/activity-coordination-photo-approval/index.ts', import.meta.url), 'utf8');
const onboardingFilesEdge = await readFile(new URL('../supabase/functions/instructor-onboarding-files/index.ts', import.meta.url), 'utf8');
const onboardingFolderEdge = await readFile(new URL('../supabase/functions/instructor-onboarding-folder/index.ts', import.meta.url), 'utf8');

const quoted = (value) => [...value.matchAll(/'([^']+)'/g)].map((match) => match[1]);
const keyBlock = sql.match(/with permission_keys as \([\s\S]*?\]::text\[\]\) permission/)[0];
const allKeys = new Set(quoted(keyBlock));
const common = ['view_dashboard','view_activities','view_activity_calendar','view_activity_exceptions','view_activity_end_dates','view_activity_archive','view_contacts','view_instructors','view_instructor_list','view_instructor_contacts','view_instructor_work_schedule','view_employee_files','view_operations_management','view_workshop_stock','view_workshop_stock_distributions','view_orders','view_catalog','view_certificates','manage_workshop_training','manage_course_training','manage_print_kits','view_proposals_agreements','manage_proposals_agreements'];
const extras = {
  '8000': [...allKeys],
  '6000': ['can_add_activity','can_edit_direct','can_review_requests','send_activity_coordination_approvals','view_operations_scheduling','view_attendance_control','manage_instructor_maintenance','manage_instructor_onboarding','can_access_personal_reports'],
  '3000': ['can_request_edit','can_request_create_activity'],
  '3030': ['can_request_edit','can_request_create_activity','manage_instructor_onboarding','can_access_personal_reports','view_israa_management'],
  '7000': ['can_request_edit','view_attendance_control','manage_instructor_onboarding','finance_access','view_finance_payroll','view_finance_collection','manage_finance_transactions','can_access_personal_reports','personal_reports_manager'],
  '1500': ['can_request_edit','can_request_create_activity','manage_instructor_onboarding','can_access_personal_reports'],
  '5000': ['can_request_edit','can_request_create_activity','manage_instructor_onboarding','can_access_personal_reports']
};

function migrationYesSet(userId) {
  if (userId === '8000') return new Set(allKeys);
  const row = sql.match(new RegExp(`\\('${userId}', array\\[([^\\]]*)\\]\\)`));
  assert.ok(row, `matrix row ${userId}`);
  return new Set(quoted(row[1]));
}

test('all seven users exactly match the approved matrix with no additional business grant', () => {
  assert.equal(allKeys.size, 50);
  for (const [userId, userExtras] of Object.entries(extras)) {
    const expected = userId === '8000' ? new Set(allKeys) : new Set([...common, ...userExtras]);
    assert.deepEqual([...migrationYesSet(userId)].sort(), [...expected].sort(), userId);
  }
  assert.match(sql, /where u\.user_id = p\.user_id/);
  assert.match(sql, /where user_id = any\(array\['8000','6000','3000','3030','7000','1500','5000'\]\)/);
  assert.match(sql, /approve_proposals_agreements = p\.user_id = '8000'/);
  assert.match(sql, /approved_permission_matrix_admin_role_mismatch/);
});

test('runtime enforces approved review, coordination, onboarding and canonical legacy behavior', () => {
  const user = (id) => ({ role: id === '8000' ? 'admin' : 'authorized_user', permissions: Object.fromEntries([...allKeys].map((key) => [key, migrationYesSet(id).has(key) ? 'yes' : 'no'])) });
  assert.equal(canReviewRequests(user('1500')), false, 'Hila cannot review');
  assert.equal(canReviewRequests(user('6000')), true, 'Eden can review');
  for (const id of Object.keys(extras)) assert.equal(canSendActivityCoordinationApprovals(user(id)), ['8000','6000'].includes(id), id);
  for (const id of Object.keys(extras)) assert.equal(canManageInstructorOnboarding(user(id)), id !== '3000', id);
  assert.equal(canManageInstructorOnboarding({ permissions: { view_instructors: 'yes', view_employee_files: 'yes', manage_instructor_onboarding: 'no' } }), false);
  assert.equal(canSendActivityCoordinationApprovals({ permissions: { view_activities: 'yes', can_edit_direct: 'yes', send_activity_coordination_approvals: 'no' } }), false);
  assert.equal(hasPermission({ permissions: { view_proposals: 'yes', view_proposals_agreements: 'no' } }, 'view_proposals_agreements'), false);
});

test('three-level parent chains are identical in frontend and database contracts', () => {
  assert.equal(hasPermission({ permissions: { view_activities: 'yes', view_activity_archive: 'no', manage_activity_archive: 'yes' } }, 'manage_activity_archive'), false);
  assert.equal(hasPermission({ permissions: { view_operations_management: 'yes', view_workshop_stock: 'no', view_workshop_stock_distributions: 'yes' } }, 'view_workshop_stock_distributions'), false);
  assert.equal(hasPermission({ permissions: { view_operations_management: 'no', view_catalog: 'yes', manage_catalog: 'yes' } }, 'manage_catalog'), false);
  assert.match(sql, /manage_activity_archive' then 'view_activity_archive'/);
  assert.match(sql, /view_workshop_stock_distributions' then 'view_workshop_stock'/);
  assert.match(sql, /manage_catalog' then 'view_catalog'/);
  assert.match(sql, /with recursive/);
});

test('new permissions are independently wired through UI, RPC and Edge Functions', () => {
  assert.match(registry, /send_activity_coordination_approvals/);
  assert.match(registry, /manage_instructor_onboarding/);
  assert.match(instructors, /canManageInstructorOnboarding/);
  assert.doesNotMatch(instructors, /employeeFilesAllowed\s*\?\s*'<button[^']*data-open-instructor-onboarding/);
  assert.match(sql, /create or replace function public\.create_instructor_onboarding[\s\S]*app_has_permission\('manage_instructor_onboarding'\)/);
  assert.match(coordinationEdge, /send_activity_coordination_approvals/);
  assert.doesNotMatch(coordinationEdge, /can_edit_direct/);
  assert.match(onboardingFilesEdge, /manage_instructor_onboarding/);
  assert.match(onboardingFolderEdge, /manage_instructor_onboarding/);
});

test('only the new forward migration carries this matrix', () => {
  assert.doesNotMatch(sql, /20260823150000/);
  assert.match(migrationUrl.pathname, /20260823200000_apply_approved_permission_matrix\.sql$/);
});
