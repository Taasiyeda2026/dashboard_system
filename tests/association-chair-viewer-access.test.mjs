import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  ASSOCIATION_CHAIR_ROUTES,
  ASSOCIATION_CHAIR_USER_ID,
  isAssociationChairViewer,
  restrictRoutesForAssociationChair
} from '../frontend/src/association-chair-access.js';
import { canViewImpactFeedback, canEditImpactFeedbackWording } from '../frontend/src/impact-feedback/feedback-access.js';
import { enforceManagedRoutes } from '../frontend/src/permission-policy.js';

const chair = {
  user_id: ASSOCIATION_CHAIR_USER_ID,
  role: 'authorized_user',
  is_active: true,
  view_dashboard: 'yes',
  view_activities: 'yes'
};

test('association chair identity is stable by user_id', () => {
  assert.equal(isAssociationChairViewer(chair), true);
  assert.equal(isAssociationChairViewer({ ...chair, is_active: false }), false);
  assert.equal(isAssociationChairViewer({ ...chair, user_id: '3091' }), false);
  assert.equal(isAssociationChairViewer({ user_id: ASSOCIATION_CHAIR_USER_ID, display_role: 'יו"ר העמותה' }), true);
});

test('association chair can view feedback results but cannot edit wording', () => {
  assert.equal(canViewImpactFeedback(chair), true);
  assert.equal(canEditImpactFeedbackWording(chair), false);
  assert.equal(canViewImpactFeedback({ ...chair, user_id: '3091' }), false);
});

test('association chair routes stay limited to dashboard/activities/feedback', () => {
  const restricted = restrictRoutesForAssociationChair(
    ['dashboard', 'activities', 'edit-requests', 'contacts', 'impact-feedback', 'finance'],
    chair
  );
  assert.deepEqual(restricted, ['dashboard', 'activities', 'impact-feedback']);
  assert.deepEqual(ASSOCIATION_CHAIR_ROUTES, ['dashboard', 'activities', 'impact-feedback']);
});

test('association chair does not inherit edit-requests via managed route enforcement', () => {
  const routes = enforceManagedRoutes(['dashboard', 'activities', 'edit-requests'], chair);
  assert.equal(routes.includes('edit-requests'), false);
  assert.equal(routes.includes('dashboard'), true);
  assert.equal(
    enforceManagedRoutes(['edit-requests'], {
      role: 'authorized_user',
      user_id: '9999',
      is_active: true,
      view_activities: 'yes'
    }).includes('edit-requests'),
    true
  );
});

test('feedback results SQL migration grants chair by user_id only', () => {
  const sql = readFileSync(
    new URL('../supabase/migrations/20261109204328_feedback_association_chair_results_access.sql', import.meta.url),
    'utf8'
  );
  assert.match(sql, /u\.user_id = '3090'/);
  assert.match(sql, /private\.feedback_can_view_results\(\)/);
  assert.match(sql, /feedback_chair_results_write_guard_expanded/);
  assert.doesNotMatch(sql, /feedback_is_admin\(\)\s*or/);
});

test('password recovery edge function allows only chair authorized_user', () => {
  const source = readFileSync(
    new URL('../supabase/functions/management-password-reset/index.ts', import.meta.url),
    'utf8'
  );
  assert.match(source, /ASSOCIATION_CHAIR_USER_ID = '3090'/);
  assert.match(source, /if \(role === 'authorized_user'\) return userId === ASSOCIATION_CHAIR_USER_ID;/);
  assert.match(source, /'authorized_user'/);
});
