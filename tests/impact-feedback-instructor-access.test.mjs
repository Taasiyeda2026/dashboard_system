import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isFeedbackInstructor, canViewImpactFeedback } from '../frontend/src/impact-feedback/feedback-access.js';

const main = readFileSync(new URL('../frontend/src/main.js', import.meta.url), 'utf8');
const screen = readFileSync(new URL('../frontend/src/screens/impact-feedback.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../frontend/src/impact-feedback/feedback-api.js', import.meta.url), 'utf8');
const sql = readFileSync(new URL('../supabase/migrations/20261013060000_feedback_instructor_portal_scope.sql', import.meta.url), 'utf8');

test('instructor access does not widen admin/Israa access', () => {
  assert.equal(isFeedbackInstructor({ role: 'instructor', is_active: true }), true);
  assert.equal(isFeedbackInstructor({ role: 'instructor', is_active: false }), false);
  assert.equal(isFeedbackInstructor({ role: 'admin' }), false);
  assert.equal(isFeedbackInstructor({ role: 'business_development_manager', user_id: '3030' }), false);
  assert.equal(canViewImpactFeedback({ role: 'instructor', user_id: '1503' }), false);
  assert.equal(canViewImpactFeedback({ role: 'business_development_manager', user_id: '3030' }), true);
});

test('uses the existing feedback route and screen rather than a separate module', () => {
  assert.match(main, /'instructor-guidelines', 'impact-feedback'/);
  assert.match(main, /\{ route: 'impact-feedback', label: 'משובים' \}/);
  assert.match(main, /'impact-feedback': \(\) => import\('\.\/screens\/impact-feedback\.js'\)/);
  assert.match(screen, /if \(isFeedbackInstructor\(state\?\.user\)\) \{\s*mountInstructorFeedback\(host\);\s*return;/);
  assert.match(screen, /feedback_instructor_portal_items|fetchInstructorPortalItems/);
  assert.match(screen, /openQrProjection/);
  assert.match(screen, /campaignLink/);
});

test('instructor data retrieval uses its own server-enforced scope, not admin result RPCs', () => {
  assert.match(api, /rpc\('feedback_instructor_portal_items'/);
  assert.match(sql, /u\.auth_user_id = \(select auth\.uid\(\)\)/);
  assert.match(sql, /u\.role = 'instructor'/);
  assert.match(sql, /u\.is_active is true/);
  assert.match(sql, /a\.emp_id::text = v_emp_id or a\.emp_id_2 = v_emp_id/);
  assert.match(sql, /c\.instructor_emp_id = v_emp_id/);
  assert.match(sql, /r\.instructor_emp_id = v_emp_id/);
  assert.match(sql, /c\.opens_at <= now\(\)/);
  assert.match(sql, /revoke all on function public\.feedback_instructor_portal_items\(text\) from public, anon/);
  assert.doesNotMatch(sql, /feedback_answer_facts|feedback_responses|feedback_answers|grant select on public\.feedback_/);
});

test('student tokens and personal links stay separate', () => {
  assert.match(sql, /c\.public_token is not null/);
  assert.match(sql, /c\.audience = 'student'/);
  assert.match(sql, /c\.audience = 'instructor'/);
  assert.match(screen, /audience: 'student', stage: item\.stage, public_token: item\.token/);
  assert.match(screen, /audience: 'instructor', recipient: \{ token: item\.token \}/);
  assert.match(screen, /'סיום מחצית ב׳'/);
  assert.match(screen, /'סיום מחצית א׳'/);
});
