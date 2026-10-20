import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createManualOperation, manualOperationPayload, canCommitManualOperation,
  createManualOperationsController, manualOperationsDialogHtml, weeklyManualDates
} from '../frontend/src/screens/course-scheduling-manual-operations.js';

const activity = { row_id: 'manual-a', updated_at: '2026-10-20T10:00:00Z', sessions: '2',
  activity_name: 'בדיקה', school: 'בית ספר', authority: 'רשות',
  date_1: '2026-11-04', date_2: '2026-11-11', start_time: '08:15:00', end_time: '09:45:00' };
const ready = { previewHash: 'hash-a', blockers: [], warnings: [], reasonRequired: false,
  instructorName: 'מדריך', previousInstructorName: null };
function setup(impl) {
  const state = {}, calls = [], saved = [];
  const controller = createManualOperationsController({ state,
    rpc: async (name, args) => { calls.push({ name, args }); return impl ? impl(name, args) : { data: ready }; },
    onSaved: row => saved.push(row)
  });
  controller.open(activity, [{ emp_id: 1507, full_name: 'מדריך' }]);
  controller.edit('empId', '1507');
  return { state, calls, saved, controller, editor: () => state.courseSchedulingManualOperation };
}

test('manual editor retains all dates and times and uses the activity revision only', () => {
  const editor = createManualOperation({ ...activity, emp_id: 1507 }, []);
  const payload = manualOperationPayload(editor);
  assert.equal(payload.p_action, 'confirm');
  assert.deepEqual(payload.p_meetings, [{ date: '2026-11-04' }, { date: '2026-11-11' }]);
  assert.equal(payload.p_start_time, '08:15');
  assert.equal(payload.p_expected_updated_at, activity.updated_at);
  assert.equal('p_expected_workspace_revision' in payload, false);
});

test('saved draft dates take precedence in the manual editor', () => {
  const editor = createManualOperation({ ...activity, draft_emp_id: '1507',
    draft_proposed_meetings: [{ date: '2026-11-18' }, { date: '2026-11-25' }] });
  assert.deepEqual(editor.dates, ['2026-11-18', '2026-11-25']);
  assert.equal(editor.empId, '1507');
});

test('manual preview and commit use dedicated RPCs without invoking the agent', async () => {
  const f = setup(async name => name === 'get_scheduling_manual_assignment_preview'
    ? { data: ready } : { data: { ...activity, draft_emp_id: '1507', updated_at: '2026-10-20T10:01:00Z' } });
  await f.controller.preview();
  assert.equal(canCommitManualOperation(f.editor()), true);
  await f.controller.commit();
  assert.deepEqual(f.calls.map(c => c.name), ['get_scheduling_manual_assignment_preview', 'commit_scheduling_manual_assignment']);
  assert.equal(f.calls[1].args.p_preview_hash, 'hash-a');
  assert.equal(f.saved.length, 1);
  assert.equal(f.editor(), null);
});

test('route warnings require the operator acknowledgement and a reason', async () => {
  const f = setup(async () => ({ data: { ...ready, warnings: [{ code: 'manual_home_route_unknown' }], reasonRequired: true } }));
  await f.controller.preview();
  assert.equal(canCommitManualOperation(f.editor()), false);
  f.controller.edit('reason', 'נבדק עם המדריך');
  assert.equal(canCommitManualOperation(f.editor()), false);
  f.controller.edit('acknowledged', true);
  assert.equal(canCommitManualOperation(f.editor()), true);
});

test('overlap is a warning the operator can acknowledge before saving', async () => {
  const f = setup(async name => name === 'get_scheduling_manual_assignment_preview'
    ? { data: { ...ready, warnings: [{ code: 'scheduling_conflict_detected', date: '2026-11-04', otherActivity: 'other' }], reasonRequired: true } }
    : { data: { ...activity, emp_id: 1507, updated_at: '2026-10-20T10:01:00Z' } });
  await f.controller.preview();
  assert.equal(canCommitManualOperation(f.editor()), false);
  assert.match(manualOperationsDialogHtml(f.state), /role="alertdialog"/);
  f.controller.edit('reason', 'החלטה עסקית שאושרה מראש');
  f.controller.edit('acknowledged', true);
  await f.controller.commit();
  assert.equal(f.calls.length, 2);
  assert.equal(f.saved.length, 1);
});

test('changing the instructor or dates invalidates the preview and acknowledgement', async () => {
  const f = setup();
  await f.controller.preview();
  f.controller.edit('acknowledged', true);
  f.controller.edit('dates', '2026-11-05', 0);
  assert.equal(f.editor().preview, null);
  assert.equal(f.editor().acknowledged, false);
  assert.equal(canCommitManualOperation(f.editor()), false);
});

test('late preview cannot certify edited dates or a newly opened activity', async () => {
  let finish;
  const f = setup(() => new Promise(resolve => { finish = resolve; }));
  const pending = f.controller.preview();
  f.controller.edit('dates', '2026-11-05', 0);
  finish({ data: ready }); await pending;
  assert.equal(f.editor().preview, null);
  const second = f.controller.preview();
  f.controller.open({ ...activity, row_id: 'manual-b' }, []);
  finish({ data: ready }); await second;
  assert.equal(f.editor().activity.row_id, 'manual-b');
  assert.equal(f.editor().preview, null);
});

test('server revision conflict leaves the editor open for recovery without claiming a save', async () => {
  const f = setup(async name => name === 'get_scheduling_manual_assignment_preview'
    ? { data: ready } : { error: { message: 'scheduling_activity_revision_conflict' } });
  await f.controller.preview(); await f.controller.commit();
  assert.equal(f.saved.length, 0);
  assert.equal(f.editor().preview, null);
  assert.match(f.editor().error, /הפעילות השתנתה/);
});

test('malformed save response never closes the dialog or reports success', async () => {
  const f = setup(async name => ({ data: name === 'get_scheduling_manual_assignment_preview' ? ready : { row_id: 'wrong' } }));
  await f.controller.preview(); await f.controller.commit();
  assert.equal(f.saved.length, 0);
  assert.equal(f.editor().activity.row_id, 'manual-a');
  assert.equal(f.editor().preview, null);
});

test('manual weekly fill is explicit and does not calculate holidays or routes', () => {
  assert.deepEqual(weeklyManualDates('2026-11-04', 3), ['2026-11-04', '2026-11-11', '2026-11-18']);
  assert.throws(() => weeklyManualDates('2026-02-30', 3), /scheduling_proposed_dates_invalid/);
  const f = setup(); f.controller.edit('dates', '2026-11-18', 0); f.controller.fillWeekly();
  assert.deepEqual(f.editor().dates, ['2026-11-18', '2026-11-25']);
  assert.equal(f.calls.length, 0);
});

test('manual editor escapes source data and includes mobile sized date inputs', () => {
  const state = { courseSchedulingManualOperation: createManualOperation({ ...activity, activity_name: '<script>alert(1)</script>' }) };
  const html = manualOperationsDialogHtml(state);
  assert.equal(html.includes('<script>'), false);
  assert.match(html, /&lt;script&gt;/);
  assert.equal((html.match(/data-manual-operation-date=/g) || []).length, 2);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /100vw/);
});

test('every scheduling business warning is shown in the explicit confirmation popup', async () => {
  const codes = ['instructor_inactive','scheduling_instructor_profile_incomplete','scheduling_language_mismatch',
    'scheduling_gender_mismatch','scheduling_course_blocked','scheduling_authority_blocked',
    'scheduling_availability_missing','scheduling_instructor_unavailable','scheduling_friday_not_allowed',
    'scheduling_saturday_blocked','scheduling_conflict_detected','scheduling_full_day_tour_conflict',
    'scheduling_transition_insufficient','scheduling_school_calendar_blocked','manual_short_school_day'];
  const f = setup(async () => ({ data: { ...ready, warnings: codes.map(code => ({ code })), reasonRequired: true } }));
  await f.controller.preview();
  const html = manualOperationsDialogHtml(f.state);
  assert.match(html, /התראה: קיימות מגבלות/);
  assert.match(html, /מאשר\/ת את החריגות/);
  assert.equal((html.match(/<li>/g) || []).length, codes.length);
  assert.equal(canCommitManualOperation(f.editor()), false);
  f.controller.edit('reason', 'החלטה תפעולית');f.controller.edit('acknowledged',true);
  assert.equal(canCommitManualOperation(f.editor()), true);
});
