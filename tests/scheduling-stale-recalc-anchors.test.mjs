/**
 * P0: dirty unprotected planning proposals must not act as lawful occupancy
 * anchors or fail whole-plan validation during point/incremental runs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDynamicCoursePlan,
  validatePlanningPlanCoherence
} from '../frontend/src/screens/course-scheduling-planning.js';
import { createRouteClient } from '../frontend/src/screens/course-scheduling-travel.js';
import { isStaleUnprotectedPlanningRow } from '../frontend/src/screens/scheduling-core/constraints.js';
import { prepareServerPlanningSnapshot } from '../services/scheduling-agent/github-adapter.mjs';

const meeting = (date, start = '09:00', end = '10:00') => ({
  date, meeting_no: 1, start_time: start, end_time: end
});

const activity = (id, extra = {}) => ({
  row_id: id,
  activity_season: 'school_2027',
  activity_type: 'קורס',
  activity_name: 'Fixture',
  status: 'פתוח',
  school_id: '1',
  school: 'School',
  school_address: 'school1',
  calendar_sector: 'jewish',
  authority: 'Authority',
  instruction_language: 'he',
  required_instructor_gender: 'any',
  sessions: 1,
  start_time: '09:00',
  end_time: '10:00',
  date_1: '2026-10-12',
  ...extra
});

function routeClient(points = ['home1', 'home2', 'home3', 'school1', 'school2']) {
  return createRouteClient({
    preloadedRows: points.flatMap((origin) => points.filter((to) => to !== origin).map((destination) => ({
      origin_key: origin,
      destination_key: destination,
      distance_km: 5,
      duration_minutes: 10
    }))),
    invoke: async () => {
      throw new Error('Network forbidden');
    }
  });
}

function input(activities, extra = {}) {
  const instructors = ['1', '2', '3'].map((id) => ({
    emp_id: id, active: 'yes', address: `home${id}`, full_name: `Instructor ${id}`
  }));
  return {
    activities,
    instructors,
    profiles: Object.fromEntries(instructors.map((person) => [person.emp_id, {
      gender: 'female', instruction_languages: ['he'], friday_allowed: false
    }])),
    rules: Object.fromEntries(instructors.map((person) => [person.emp_id,
      Array.from({ length: 7 }, (_, weekday) => ({
        weekday, available: true, start_time: '08:00', end_time: '18:00'
      }))
    ])),
    exceptions: {},
    schoolCalendar: [],
    catalog: [],
    today: '2026-10-09',
    periodKey: 'year',
    planningProfile: 'fast',
    skipSoftOptimization: true,
    allowGlobalRepair: false,
    existingRows: [],
    committedRows: [],
    lockedOptions: {},
    routeClient: routeClient(),
    ...extra
  };
}

test('isStaleUnprotectedPlanningRow ignores approved and locked rows', () => {
  const dirty = { courseId: 'a', needsRecalc: true, instructorEmpId: '1' };
  assert.equal(isStaleUnprotectedPlanningRow(dirty, activity('a'), null), true);
  assert.equal(isStaleUnprotectedPlanningRow(dirty, activity('a', { emp_id: '9' }), null), false);
  assert.equal(isStaleUnprotectedPlanningRow(dirty, activity('a'), { instructorEmpId: '1' }), false);
  assert.equal(isStaleUnprotectedPlanningRow({ ...dirty, needsRecalc: false }, activity('a'), null), false);
});

test('point plan keeps a dirty overlapping proposal visible but does not fail validation against an approved assignment', async () => {
  const approved = activity('approved', {
    emp_id: '1',
    instructor_assignment_locked: true,
    school_id: '2',
    school_address: 'school2',
    start_time: '09:00',
    end_time: '10:30'
  });
  const staleTarget = activity('stale');
  const pointTarget = activity('point', {
    school_id: '2',
    school_address: 'school2',
    start_time: '11:00',
    end_time: '12:00'
  });
  const staleProposal = {
    courseId: 'stale',
    kind: 'proposal',
    needsRecalc: true,
    instructorEmpId: '1',
    instructorName: 'Instructor 1',
    meetings: [meeting('2026-10-12', '09:00', '10:00')],
    options: []
  };
  const data = input([approved, staleTarget, pointTarget], {
    existingRows: [staleProposal],
    committedRows: [staleProposal],
    targetCourseIds: ['point']
  });

  const before = structuredClone(staleProposal);
  const plan = await buildDynamicCoursePlan(data);

  assert.equal(plan.finalPlanValidation.valid, true);
  assert.equal(plan.finalPlanValidation.failures.some((item) => item.reason === 'overlap'), false);

  const approvedRow = plan.rows.find((row) => row.courseId === 'approved');
  const staleRow = plan.rows.find((row) => row.courseId === 'stale');
  const pointRow = plan.rows.find((row) => row.courseId === 'point');

  assert.equal(approvedRow.kind, 'live');
  assert.equal(approvedRow.instructorEmpId, '1');
  assert.deepEqual(approvedRow.meetings.map((item) => item.date), ['2026-10-12']);

  assert.equal(staleRow.needsRecalc, true);
  assert.equal(staleRow.instructorEmpId, '1');
  assert.deepEqual(staleRow.meetings, before.meetings);
  assert.ok(plan.finalPlanValidation.warnings.some((item) =>
    item.courseId === 'stale' && item.reason === 'stale_needs_recalc'));

  assert.ok(pointRow?.instructorEmpId);
  // Instructor 1 may still be used after the approved block ends; the stale
  // dirty proposal must not occupy the calendar or force a false conflict.
  const approvedEnd = approvedRow.meetings[0].end_time;
  const pointStart = pointRow.meetings[0].start_time;
  if (pointRow.instructorEmpId === '1') {
    assert.ok(pointStart >= approvedEnd || pointRow.meetings[0].date !== approvedRow.meetings[0].date);
  }
  assert.equal(validatePlanningPlanCoherence({ ...data, rows: plan.rows }).valid, true);
});

test('two parallel same-school courses require different instructors and remain valid after point recompute', async () => {
  const left = activity('ai-left', {
    school_id: '250',
    school: "מקיף ה'",
    school_address: 'school1',
    start_time: '08:00',
    end_time: '09:30',
    date_1: '2027-02-08'
  });
  const right = activity('ai-right', {
    school_id: '250',
    school: "מקיף ה'",
    school_address: 'school1',
    start_time: '08:00',
    end_time: '09:30',
    date_1: '2027-02-08'
  });
  const data = input([left, right], {
    targetCourseIds: ['ai-left', 'ai-right'],
    skipSoftOptimization: true
  });
  const plan = await buildDynamicCoursePlan(data);
  assert.equal(plan.finalPlanValidation.valid, true);
  const leftRow = plan.rows.find((row) => row.courseId === 'ai-left');
  const rightRow = plan.rows.find((row) => row.courseId === 'ai-right');
  assert.ok(leftRow.instructorEmpId);
  assert.ok(rightRow.instructorEmpId);
  assert.notEqual(leftRow.instructorEmpId, rightRow.instructorEmpId);
});

test('prepareServerPlanningSnapshot stamps needsRecalc onto engine existingRows', () => {
  const payload = {
    workspace: { revision: '12681' },
    sourceRevision: '1291',
    activities: [],
    instructors: [{ emp_id: '1', active: 'yes', address: 'home1', full_name: 'A' }],
    schoolLocations: [],
    externalBlockers: [],
    meetingInstructorHistory: [],
    profiles: [],
    rules: [],
    exceptions: [],
    schoolCalendar: [{ external_key: 'x', start_date: '2026-09-01', end_date: '2026-09-01', is_active: true, show_on_main_calendar: true }],
    catalog: [{ activity_name: 'Fixture', meetings_count: 1, hours_count: 1 }],
    routes: [],
    existingRows: [{
      activityId: 'stale',
      row: { courseId: 'stale', kind: 'proposal', instructorEmpId: '1', meetings: [] },
      needsRecalc: true,
      lockedOption: null
    }],
    targetCourseIds: ['point'],
    cancellations: [],
    planningIntents: [],
    sourceComplete: true,
    routesComplete: true,
    catalogComplete: true,
    schoolCalendarComplete: true
  };
  const prepared = prepareServerPlanningSnapshot(payload);
  assert.equal(prepared.snapshot.existingRows[0].needsRecalc, true);
  assert.equal(prepared.snapshot.existingRows[0].courseId, 'stale');
  assert.equal(prepared.snapshot.committedRows[0].needsRecalc, true);
});

test('readonly point compute with stale dirty overlap does not invent new certified overlaps', async () => {
  const approved = activity('approved', {
    emp_id: '1',
    instructor_assignment_locked: true,
    start_time: '08:00',
    end_time: '09:30'
  });
  const staleA = activity('stale-a');
  const staleB = activity('stale-b', { start_time: '08:00', end_time: '09:30' });
  const target = activity('target', {
    school_id: '2',
    school_address: 'school2',
    start_time: '10:30',
    end_time: '12:00'
  });
  const existingRows = [
    {
      courseId: 'stale-a',
      kind: 'proposal',
      needsRecalc: true,
      instructorEmpId: '1',
      meetings: [meeting('2026-10-12', '08:15', '09:15')]
    },
    {
      courseId: 'stale-b',
      kind: 'proposal',
      needsRecalc: true,
      instructorEmpId: '1',
      meetings: [meeting('2026-10-12', '08:00', '09:30')]
    }
  ];
  const data = input([approved, staleA, staleB, target], {
    existingRows,
    committedRows: existingRows,
    targetCourseIds: ['target']
  });
  const plan = await buildDynamicCoursePlan(data);
  assert.equal(plan.finalPlanValidation.valid, true);
  const certified = plan.rows.filter((row) =>
    row.instructorEmpId && row.needsRecalc !== true && row.kind !== 'live');
  for (let i = 0; i < certified.length; i += 1) {
    for (let j = i + 1; j < certified.length; j += 1) {
      const left = certified[i];
      const right = certified[j];
      if (left.instructorEmpId !== right.instructorEmpId) continue;
      const overlap = (left.meetings || []).some((m) => (right.meetings || []).some((n) =>
        m.date === n.date
        && m.start_time < n.end_time
        && m.end_time > n.start_time));
      assert.equal(overlap, false, `${left.courseId} must not overlap certified ${right.courseId}`);
    }
  }
  assert.equal(plan.rows.find((row) => row.courseId === 'stale-a').instructorEmpId, '1');
  assert.equal(plan.rows.find((row) => row.courseId === 'stale-b').instructorEmpId, '1');
});
