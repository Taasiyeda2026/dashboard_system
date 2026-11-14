import test from 'node:test';
import assert from 'node:assert/strict';
import { buildManagementEvidence, loadActivityManagement, managementFilterMatches, ensureActivityManagement, cachedManagement } from '../frontend/src/screens/shared/activity-management-data.js';
import { activityManagementSummary } from '../frontend/src/screens/shared/activity-management-summary.js';

const row = { RowID: 'a', id: 42, emp_id: '7', activity_season: 'school_2027', sessions: 4, start_date: '2026-01-01', end_date: '2026-12-01', meeting_dates: ['2026-01-01', '2026-01-01', '2026-01-08', '2026-12-01'] };
function mockClient(data = {}, errors = {}, role = 'admin') {
  const calls = [];
  const source = (name, args) => {
    const call = { name, args, select: '', in: null }; calls.push(call);
    const query = {
      select(columns) { call.select = columns; return this; },
      in(column, ids) { call.in = { column, ids }; return this; },
      eq() { return this; }, or() { return this; }, order() { return this; },
      range(from, to) { return Promise.resolve({ data: (data[name] || []).slice(from, to + 1), error: errors[name] || null }); }
    }; return query;
  };
  return { calls, from: source, rpc: (name, args) => name === 'app_current_role' ? Promise.resolve({ data: role, error: null }) : source(name, args) };
}

test('exact row identity and approved source separate cancelled, verified, expired-unverified and double-meeting reports', () => {
  const evidence = buildManagementEvidence([row], {
    approvalsAvailable: true, approvals: [{ activity_row_id: ' a, other ', activity_date: '2026-01-01', status: 'approved' }, { activity_row_id: 'aa', activity_date: '2026-01-08', status: 'approved' }],
    cancellationsAvailable: true, cancellations: [{ activity_id: 'a', meeting_date: '2026-01-08' }],
    attendanceAvailable: true, attendanceComplete: true, attendance: [{ activity_row_id: 'a', activity_numeric_id: 42, attendance_date: '2026-01-01', session_number: '1' }, { activity_row_id: 'a', activity_numeric_id: 99, attendance_date: '2026-01-01', session_number: '2' }]
  }).a;
  const summary = activityManagementSummary({ ...row, management: evidence }, '2026-11-14');
  assert.equal(summary.verified, 2);
  assert.equal(summary.cancelled, 1);
  assert.equal(summary.elapsedUnverified, 0);
  assert.equal(summary.missingReports, 1);
  assert.equal(summary.next, '2026-12-01');
});

test('batch loader selects minimal report fields, strips feedback secrets and retains independent source failures', async () => {
  const client = mockClient({ activity_completion_approval_uploads: [{ activity_row_id: 'a', activity_date: '2026-01-01', status: 'approved' }] }, { course_meeting_cancellations: { message: 'denied' } });
  const result = await loadActivityManagement([row], {
    client, user: { role: 'admin' }, state: { routes: [] }, waitForSession: async () => {},
    groupsLoader: async () => [{ row_id: 'a', program_key: 'p', campaigns: [{ audience: 'student', stage: 'pre', status: 'active', responses: 0, expires_at: '2020-01-01', public_token: 'PRIVATE' }] }],
    assignmentsLoader: async () => [], staffLoader: async () => []
  });
  assert.equal(result.a.approvalsAvailable, true);
  assert.equal(result.a.cancellationsAvailable, false);
  assert.ok(result.a.errors.includes('cancellations'));
  assert.equal(result.a.feedback.needsAttention, true);
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  assert.equal(client.calls.find((c) => c.name === 'get_payroll_attendance_records').select.includes('expenses'), false);
  assert.equal(client.calls.filter((c) => c.name === 'activity_completion_approval_uploads').length, 1);
});

test('unprivileged instructor never loads manager, cancellation, feedback or completion sources', async () => {
  const client = mockClient();
  const result = await loadActivityManagement([row], { client, user: { role: 'instructor' }, state: { routes: [] }, waitForSession: async () => {} });
  assert.equal(client.calls.length, 0);
  assert.equal(result.a.approvalsAvailable, false);
  assert.equal(result.a.attendanceAvailable, false);
  assert.equal(result.a.feedback.available, false);
  assert.equal(activityManagementSummary({ ...row, management: result.a }).verified, null);
});

test('management filters exclude unavailable evidence and use canonical warning statuses', () => {
  const management = { exceptionsAvailable: true, exceptions: ['missing_instructor'], feedback: { available: true, needsAttention: true }, coordination: { available: true, status: 'draft' } };
  for (const filter of ['exceptions', 'feedback', 'coordination']) assert.equal(managementFilterMatches({ ...row, management }, filter, '2026-12'), true);
  assert.equal(managementFilterMatches(row, 'missing-reports'), false);
  assert.equal(managementFilterMatches(row, 'ending', '2026-12'), true);
  assert.equal(managementFilterMatches(row, 'ending', '2026-11'), false);
});

test('cache coalesces duplicate loads and never reuses another identity or inactive user scope', async () => {
  const state = { user: { role: 'instructor', user_id: 'one' }, screenDataCache: {} };
  const client = mockClient();
  const options = { state, user: state.user, client, waitForSession: async () => {} };
  await Promise.all([ensureActivityManagement([row], options), ensureActivityManagement([row], options)]);
  assert.ok(cachedManagement(row, state));
  state.user = { role: 'instructor', user_id: 'two' };
  assert.equal(cachedManagement(row, state), null);
  state.user = { role: 'instructor', user_id: 'one', is_active: false };
  assert.equal(cachedManagement(row, state), null);
});

test('checkpoints share the established manager-board midpoint rule and do not invent a missing total', async () => {
  const { midpointMeetingNumbers, activityMeetingCheckpoints } = await import('../frontend/src/screens/shared/activity-meeting-checkpoints.js');
  assert.deepEqual([...midpointMeetingNumbers(4)], [2, 3]);
  assert.deepEqual([...midpointMeetingNumbers(5)], [3]);
  assert.deepEqual([...midpointMeetingNumbers(1)], []);
  assert.equal(activityMeetingCheckpoints({ meeting_dates: ['2026-01-01', '2026-01-02'] }).some((p) => p.label.includes('אמצע')), false);
  assert.equal(activityMeetingCheckpoints(row).filter((p) => p.label.includes('אמצע')).length, 2);
  assert.deepEqual(activityMeetingCheckpoints({ sessions: 3, date_1: '2026-01-01', date_3: '2026-01-08', meeting_dates: ['2026-01-01', '2026-01-08'] }).map((p) => p.label), ['התחלה לפי לוח', 'סיום לפי לוח']);
});

test('instructor feedback remains in the activity academic year when a batch spans seasons', async () => {
  const client = mockClient();
  const result = await loadActivityManagement([row, { ...row, RowID: 'b', activity_season: 'school_2026' }], {
    client, user: { role: 'admin' }, state: { routes: [] }, waitForSession: async () => {},
    groupsLoader: async (season) => [{ row_id: season === 'school_2027' ? 'a' : 'b', program_key: 'p', campaigns: [] }],
    assignmentsLoader: async (season) => [{ program_key: 'p', instructor_emp_id: '7', pre_campaign: { status: season === 'school_2027' ? 'closed' : 'active', expires_at: '2020-01-01' } }],
    staffLoader: async () => []
  });
  assert.equal(result.a.feedback.slots.filter((slot) => slot.audience === 'instructor').length, 2);
  assert.equal(result.a.feedback.needsAttention, false);
  assert.equal(result.b.feedback.needsAttention, true);
});

test('an activity edit invalidates management evidence immediately rather than waiting for TTL', async () => {
  const state = { user: { role: 'instructor', user_id: 'one' }, screenDataCache: {} };
  await ensureActivityManagement([row], { state, user: state.user, client: mockClient(), waitForSession: async () => {} });
  assert.ok(cachedManagement(row, state));
  assert.equal(cachedManagement({ ...row, end_date: '2027-01-01' }, state), null);
});

test('a stale privileged UI profile cannot turn RLS-hidden rows into verified zero counts', async () => {
  const client = mockClient({}, {}, 'instructor');
  const evidence = await loadActivityManagement([row], { client, user: { role: 'admin' }, state: { routes: [] }, waitForSession: async () => {} });
  assert.equal(client.calls.length, 0);
  assert.equal(evidence.a.approvalsAvailable, false);
  assert.equal(evidence.a.cancellationsAvailable, false);
  assert.ok(evidence.a.errors.includes('identity_changed'));
});

test('source requests are bounded batches rather than one request per activity', async () => {
  const rows = Array.from({ length: 125 }, (_, index) => ({ ...row, RowID: 'activity-' + index }));
  const client = mockClient();
  await loadActivityManagement(rows, { client, user: { role: 'admin' }, state: { routes: [] }, waitForSession: async () => {}, groupsLoader: async () => [], assignmentsLoader: async () => [], staffLoader: async () => [] });
  assert.ok(client.calls.length < rows.length / 5);
  assert.ok(client.calls.filter((call) => call.in).every((call) => call.in.ids.length <= 60));
  assert.equal(client.calls.find((call) => call.name === 'get_payroll_attendance_records').args.p_employee_ids, null, 'historical instructors are not excluded by the current assignment');
});

test('a cancelled future date is never the next meeting or an active future meeting', () => {
  const management = { approvalsAvailable: true, approvedDates: [], cancellationsAvailable: true, cancelledDates: ['2099-01-01'] };
  const summary = activityManagementSummary({ sessions: 2, date_1: '2099-01-01', date_2: '2099-01-08', management }, '2026-11-14');
  assert.equal(summary.future, 1);
  assert.equal(summary.next, '2099-01-08');
});

test('numbered date columns keep attendance identity when the normalized date array has gaps', () => {
  const management = { approvalsAvailable: true, approvedDates: [], cancellationsAvailable: true, cancelledDates: [], attendanceAvailable: true, attendanceComplete: true, attendance: [{ date: '2026-01-08', meetingNo: '3' }] };
  const summary = activityManagementSummary({ sessions: 3, date_1: '2026-01-01', date_3: '2026-01-08', meeting_dates: ['2026-01-01', '2026-01-08'], management }, '2026-11-14');
  assert.equal(summary.missingDates,1);
  assert.equal(summary.missingReports,1);
});
