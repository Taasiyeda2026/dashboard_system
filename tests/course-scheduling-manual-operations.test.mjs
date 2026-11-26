import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createManualOperation, manualOperationPayload, canCommitManualOperation,
  createManualOperationsController, manualOperationsDialogHtml
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
  assert.equal(payload.p_meetings, null);
  assert.equal(payload.p_start_time, null);
  assert.equal(payload.p_expected_updated_at, activity.updated_at);
  assert.equal('p_expected_workspace_revision' in payload, false);
});

test('official dates take precedence over saved legacy draft dates', () => {
  const editor = createManualOperation({ ...activity, draft_emp_id: '1507',
    draft_proposed_meetings: [{ date: '2026-11-18' }, { date: '2026-11-25' }] });
  assert.deepEqual(editor.dates, ['2026-11-04', '2026-11-11']);
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

test('changing the instructor invalidates the preview and acknowledgement', async () => {
  const f = setup();
  await f.controller.preview();
  f.controller.edit('acknowledged', true);
  f.controller.edit('empId', '1508');
  assert.equal(f.editor().preview, null);
  assert.equal(f.editor().acknowledged, false);
  assert.equal(canCommitManualOperation(f.editor()), false);
});

test('late preview cannot certify a newly opened activity and busy edits are rejected', async () => {
  let finish;
  const f = setup(() => new Promise(resolve => { finish = resolve; }));
  const pending = f.controller.preview();
  assert.equal(f.controller.edit('empId', '1508'), false);
  f.controller.open({ ...activity, row_id: 'manual-b' }, []);
  finish({ data: ready }); await pending;
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

test('schedule edits are rejected and official schedule controls are read-only', () => {
  const f = setup();
  assert.equal(f.controller.edit('dates', '2026-11-18', 0), false);
  assert.equal(f.controller.edit('startTime', '10:00'), false);
  assert.equal(f.calls.length, 0);
});

test('manual editor escapes source data and has collapsed meeting details without schedule inputs', () => {
  const state = { courseSchedulingManualOperation: createManualOperation({ ...activity, activity_name: '<script>alert(1)</script>' }) };
  const html = manualOperationsDialogHtml(state);
  assert.equal(html.includes('<script>'), false);
  assert.match(html, /&lt;script&gt;/);
  assert.equal((html.match(/data-manual-operation-date=/g) || []).length, 0);
  assert.match(html, /<details><summary>/);
  assert.doesNotMatch(html, /type="time"|data-manual-operation-check|<textarea/);
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
  assert.equal((html.match(/<ul>[\s\S]*?<\/ul>/)?.[0].match(/<li>/g) || []).length, codes.length);
  assert.equal(canCommitManualOperation(f.editor()), false);
  f.controller.edit('reason', 'החלטה תפעולית');f.controller.edit('acknowledged',true);
  assert.equal(canCommitManualOperation(f.editor()), true);
});

test('manager instructor selection is visibly marked and admin-only error is clear', () => {
  const state = { courseSchedulingManualOperation: createManualOperation(activity, [
    { emp_id: 1500, full_name: 'הילה רוזן', isManagementEmployee: true, active: 'yes' }
  ]) };
  const html = manualOperationsDialogHtml(state);
  assert.match(html, /הילה רוזן · מנהל\/ת<\/option>/);
  assert.doesNotMatch(html, /הילה רוזן[^<]*אישור אדמין/);
  assert.match(html, /אדמין בלבד/);
});

test('one click previews and saves a valid assignment with single-flight double click protection', async () => {
  let finish;
  const f = setup(async name => name === 'get_scheduling_manual_assignment_preview'
    ? new Promise(resolve => { finish = resolve; })
    : { data: { ...activity, updated_at: '2026-10-20T10:01:00Z' } });
  const pending = f.controller.submit();
  await f.controller.submit();
  assert.equal(f.calls.length, 1);
  finish({ data: ready }); await pending;
  assert.equal(f.calls.length, 2); assert.equal(f.saved.length, 1);
});

test('one click stops for blockers, warnings and reason-only requirements', async () => {
  for (const data of [
    { ...ready, blockers: ['scheduling_permission_denied'] },
    { ...ready, warnings: [{ code: 'manual_home_route_unknown' }] },
    { ...ready, reasonRequired: true }
  ]) {
    const f = setup(async () => ({ data })); await f.controller.submit();
    assert.equal(f.calls.length, 1); assert.equal(f.saved.length, 0);
    assert.equal(canCommitManualOperation(f.editor()), false);
    assert.equal(manualOperationsDialogHtml(f.state).includes('<textarea'), !!data.reasonRequired);
  }
});

test('changed warning set is rechecked and previous consent is cleared without automatic retry', async () => {
  let previews = 0;
  const f = setup(async name => name === 'get_scheduling_manual_assignment_preview'
    ? { data: { ...ready, previewHash: 'v' + ++previews, warnings: [{ code: previews === 1 ? 'manual_home_route_unknown' : 'manual_transition_unknown' }], reasonRequired: true } }
    : { error: { message: 'scheduling_manual_preview_changed' } });
  await f.controller.submit(); f.controller.edit('reason', 'נבדק'); f.controller.edit('acknowledged', true);
  await f.controller.submit();
  assert.equal(previews, 2); assert.equal(f.editor().acknowledged, false);
  assert.equal(f.editor().reason, ''); assert.equal(f.saved.length, 0);
  assert.equal(f.calls.filter(c => c.name === 'commit_scheduling_manual_assignment').length, 1);
});

test('missing official dates or hours prevent all RPC calls', async () => {
  for (const changes of [{ date_1: null }, { start_time: null }, { sessions: null }]) {
    const f = setup(); f.controller.open({ ...activity, ...changes }, []); f.controller.edit('empId', '1507');
    await f.controller.submit(); assert.equal(f.calls.length, 0); assert.ok(f.editor().error);
  }
});

test('activity revision conflict reloads official data and checks again without saving or retaining consent', async () => {
  const state = {}; let checks = 0, reloads = 0, saves = 0;
  const controller = createManualOperationsController({ state,
    reloadActivity: async () => { reloads++; return { ...activity, date_2: '2026-11-18', updated_at: '2026-11-01T12:00:00Z' }; },
    rpc: async name => {
      if (name === 'commit_scheduling_manual_assignment') { saves++; return { error: { message: 'scheduling_activity_revision_conflict' } }; }
      checks++; return { data: ready };
    }
  });
  controller.open(activity, []); controller.edit('empId', '1507');
  await controller.submit();
  assert.equal(saves, 1); assert.equal(reloads, 1); assert.equal(checks, 2);
  assert.equal(state.courseSchedulingManualOperation.dates[1], '2026-11-18');
  assert.equal(state.courseSchedulingManualOperation.acknowledged, false);
  assert.match(state.courseSchedulingManualOperation.error, /הפעילות השתנתה/);
});

test('network errors leave the editor open and never invoke saved callback', async () => {
  const f = setup(async name => {
    if (name === 'get_scheduling_manual_assignment_preview') return { data: ready };
    throw Error('offline');
  });
  await f.controller.submit();
  assert.equal(f.saved.length, 0); assert.ok(f.editor().error); assert.equal(f.editor().busy, '');
});
