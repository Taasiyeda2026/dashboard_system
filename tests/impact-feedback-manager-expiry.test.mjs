import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canExtendAssignedInstructorExpiry } from '../frontend/src/impact-feedback/feedback-access.js';

const now = Date.parse('2026-10-28T12:00:00+02:00');
const gil = { role: 'activities_manager', is_active: true, full_name: 'גיל נאמן' };
const hila = { role: 'activities_manager', is_active: true, full_name: 'הילה רוזן' };
const assignment = { program_key: 'ai_applications', activity_managers: ['גיל נאמן'] };
const expired = {
  id: 'example', audience: 'instructor', program_key: 'ai_applications',
  status: 'active', expires_at: '2026-10-27T19:00:00+02:00',
  recipient: { status: 'pending' }, responses: 0
};

test('only the currently responsible active manager sees expired instructor expiry control', () => {
  assert.equal(canExtendAssignedInstructorExpiry(gil, assignment, expired, now), true);
  assert.equal(canExtendAssignedInstructorExpiry(hila, assignment, expired, now), false);
  assert.equal(canExtendAssignedInstructorExpiry({ ...gil, is_active: false }, assignment, expired, now), false);
  assert.equal(canExtendAssignedInstructorExpiry({ role: 'operation_manager', full_name: 'גיל נאמן' }, assignment, expired, now), false);
});

test('never displays manager expiry control for active, completed or non-instructor questionnaires', () => {
  assert.equal(canExtendAssignedInstructorExpiry(gil, assignment,
    { ...expired, expires_at: '2026-11-01T00:00:00+02:00' }, now), false);
  assert.equal(canExtendAssignedInstructorExpiry(gil, assignment,
    { ...expired, recipient: { status: 'completed' } }, now), false);
  assert.equal(canExtendAssignedInstructorExpiry(gil, assignment,
    { ...expired, responses: 1 }, now), false);
  assert.equal(canExtendAssignedInstructorExpiry(gil, assignment,
    { ...expired, audience: 'student' }, now), false);
  assert.equal(canExtendAssignedInstructorExpiry(gil, { ...assignment, program_key: 'pharma' }, expired, now), false);
});

test('manager UI calls a dedicated owner-scoped RPC without widening admin update actions', () => {
  const api = readFileSync(new URL('../frontend/src/impact-feedback/feedback-api.js', import.meta.url), 'utf8');
  const screen = readFileSync(new URL('../frontend/src/screens/impact-feedback.js', import.meta.url), 'utf8');
  const sql = readFileSync(new URL('../supabase/migrations/20261028124500_feedback_manager_extend_expired_instructor_campaign.sql', import.meta.url), 'utf8');
  assert.match(api, /rpc\('feedback_manager_extend_instructor_expiry'/);
  assert.match(screen, /data-ifb-manager-extend/);
  assert.match(screen, /allowedManagerExpiryForm/);
  assert.match(sql, /private\.feedback_can_share_staff_activity\(a\.row_id\)/);
  assert.match(sql, /v_campaign\.expires_at > now\(\)/);
  assert.match(sql, /public\.feedback_responses/);
  assert.match(sql, /REVOKE ALL ON FUNCTION.*feedback_manager_extend_instructor_expiry/s);
  assert.doesNotMatch(sql, /feedback_admin_update_campaign/);
});
