import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentAssignmentClient } from '../frontend/src/screens/course-scheduling-agent-selection.js';

function setup(activity = { row_id: 'course-a', updated_at: '2026-10-20T10:00:00Z' }, response = null) {
  const calls = [], conflicts = [], updates = [];
  const snapshots = new Map([['course-a', { sourceRevision: 12, workspaceRevision: 34 }]]);
  const client = createAgentAssignmentClient({
    getActivity: () => activity, snapshots,
    rpc: async (name, args) => {
      calls.push({ name, args });
      return response || { data: activity, error: null };
    },
    onConflict: (...args) => conflicts.push(args), onActivity: row => updates.push(row)
  });
  return { client, calls, conflicts, updates, snapshots, activity };
}
const args = { p_activity_id: 'course-a', p_emp_id: 1507 };

test('manual draft does not depend on the agent snapshot but retains the activity revision', async () => {
  const s = setup();
  const result = await s.client.mutate('save_course_assignment_manual_draft', args);
  assert.equal(result.error, null);
  assert.equal(s.calls[0].name, 'scheduling_dashboard_assignment');
  assert.equal(s.calls[0].args.p_expected_updated_at, s.activity.updated_at);
  assert.equal(s.calls[0].args.p_expected_source_revision, null);
  assert.equal(s.calls[0].args.p_expected_workspace_revision, null);
  assert.deepEqual(s.calls[0].args.p_args, args);
});

test('replacement cancellation and operational unavailability do not depend on agent revisions', async () => {
  for (const name of ['reassign_locked_course_instructor', 'replace_locked_course_instructor',
    'cancel_course_assignment_draft', 'cancel_confirmed_course_assignment', 'scheduling_confirm_permanent_unavailability']) {
    const s = setup();
    await s.client.mutate(name, args);
    assert.equal(s.calls[0].args.p_expected_source_revision, null, name);
    assert.equal(s.calls[0].args.p_expected_workspace_revision, null, name);
    assert.equal(s.calls[0].args.p_expected_updated_at, s.activity.updated_at);
  }
});

test('accepting a stored proposal still checks source and workspace revisions', async () => {
  for (const name of ['save_course_assignment_draft', 'save_course_assignment_draft_with_dates',
    'assign_activity_instructor', 'assign_activity_instructor_with_dates']) {
    const s = setup();
    await s.client.mutate(name, args);
    assert.equal(s.calls[0].args.p_expected_source_revision, 12, name);
    assert.equal(s.calls[0].args.p_expected_workspace_revision, 34, name);
  }
});

test('confirmation of the matching saved draft does not depend on recalculated agent proposals', async () => {
  for (const name of ['assign_activity_instructor', 'assign_activity_instructor_with_dates']) {
    const s = setup({ row_id: 'course-a', updated_at: '2026-10-20T10:00:00Z', draft_emp_id: '1507' });
    await s.client.mutate(name, args);
    assert.equal(s.calls[0].args.p_expected_source_revision, null);
    assert.equal(s.calls[0].args.p_expected_workspace_revision, null);
    assert.equal(s.calls[0].args.p_expected_updated_at, s.activity.updated_at);
  }
});

test('a different instructor is not treated as confirmation of the saved draft', async () => {
  const s = setup({ row_id: 'course-a', updated_at: '2026-10-20T10:00:00Z', draft_emp_id: '9999' });
  await s.client.mutate('assign_activity_instructor', args);
  assert.equal(s.calls[0].args.p_expected_source_revision, 12);
  assert.equal(s.calls[0].args.p_expected_workspace_revision, 34);
});

test('manual actions cannot save without a current activity version', async () => {
  const s = setup({ row_id: 'course-a' });
  const result = await s.client.mutate('save_course_assignment_manual_draft', args);
  assert.equal(result.error.message, 'scheduling_activity_revision_conflict');
  assert.equal(s.calls.length, 0);
});

test('server overlap and activity revision failures still propagate to the operator', async () => {
  for (const message of ['scheduling_conflict_detected', 'scheduling_activity_revision_conflict']) {
    const error = { message };
    const s = setup(undefined, { data: null, error });
    const result = await s.client.mutate('save_course_assignment_manual_draft', args);
    assert.equal(result.error, error);
    assert.equal(s.updates.length, 0);
    assert.equal(s.conflicts.length, message.includes('revision_conflict') ? 1 : 0);
    assert.equal(s.snapshots.has('course-a'), !message.includes('revision_conflict'));
  }
});
