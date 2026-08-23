import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canOpenOperationsTab,
  enforceManagedRoutes,
  hasPermission
} from '../frontend/src/permission-policy.js';

const managedRoutes = [
  'dashboard', 'activities', 'catalog', 'invitations', 'proposals-agreements',
  'finance', 'personal-reports', 'israa-management', 'operations-management',
  'course-scheduling'
];

test('roles never override an explicit unchecked managed permission', () => {
  for (const role of [
    'operation_manager', 'activities_manager', 'finance', 'domain_manager',
    'business_development_manager', 'instructor_manager', 'instructor'
  ]) {
    const user = { role, permissions: {} };
    assert.deepEqual(enforceManagedRoutes(managedRoutes, user), [], role);
    assert.equal(canOpenOperationsTab(user, 'completion_approval'), false, role);
    assert.equal(canOpenOperationsTab(user, 'workshops'), false, role);
  }
});

test('individual grants control routes and operations tabs independent of role', () => {
  const user = {
    role: 'instructor',
    permissions: {
      view_dashboard: 'yes',
      view_activities: 'yes',
      view_operations_management: 'yes',
      view_instructors: 'yes',
      view_operations_scheduling: 'yes',
      view_activity_approvals: 'yes',
      view_workshop_stock: 'no'
    }
  };
  assert.deepEqual(enforceManagedRoutes(managedRoutes, user), [
    'dashboard', 'activities', 'operations-management', 'course-scheduling'
  ]);
  assert.equal(canOpenOperationsTab(user, 'completion_approval'), true);
  assert.equal(canOpenOperationsTab(user, 'workshops'), false);
});

test('admin receives full access and aliases remain compatible', () => {
  assert.deepEqual(enforceManagedRoutes(managedRoutes, { role: 'admin' }), managedRoutes);
  assert.equal(canOpenOperationsTab({ role: 'admin' }, 'workshops'), true);
  assert.equal(hasPermission({ role: 'instructor', permissions: { view_operations_management: 'yes', view_inventory: 'yes' } }, 'view_workshop_stock'), true);
  assert.equal(hasPermission({ role: 'instructor', permissions: { view_activities: 'yes', can_request_edit_2: 'yes' } }, 'can_request_edit'), true);
  assert.equal(hasPermission({ role: 'instructor', permissions: { view_finance: 'yes' } }, 'finance_access'), true);
  assert.equal(hasPermission({ role: 'operation_manager', permissions: { approve_proposals_agreements: 'yes' } }, 'approve_proposals_agreements'), false);
  assert.equal(hasPermission({ role: 'admin' }, 'approve_proposals_agreements'), true);
});

test('flat values loaded after login and nested values loaded after refresh are equivalent', () => {
  const flat = { role: 'finance', finance_access: 'no', view_catalog: 'yes' };
  const restored = { role: 'finance', permissions: { finance_access: 'no', view_catalog: 'yes' } };
  assert.equal(hasPermission(flat, 'finance_access'), false);
  assert.equal(hasPermission(restored, 'finance_access'), false);
  assert.deepEqual(enforceManagedRoutes(managedRoutes, flat), enforceManagedRoutes(managedRoutes, restored));
});
