import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import {
  DISTRICT_SIMULATION_STATUSES,
  applyDistrictSimulationSaveOutcome,
  buildDistrictSimulationRows,
  defaultSelectedSimulationCourseIds,
  districtSimulationConfirmMessage,
  districtSimulationDraftSaveBlockReason,
  districtSimulationPanelHtml,
  districtSimulationSaveButtonLabel,
  districtSimulationSaveResultMessage,
  isDistrictSimulationRowSelectable,
  normalizeSelectedSimulationCourseIds,
  runDistrictSchedulingSimulation
} from '../frontend/src/screens/course-scheduling-district-simulation.js';
import {
  buildCourseAssignmentDraftRpc,
  candidateHardBlockReason,
  courseSchedulingScreen
} from '../frontend/src/screens/course-scheduling.js';
import { supabase } from '../frontend/src/supabase-client.js';

const weekdayRules = [
  { weekday: 0, available: true, start_time: '08:00', end_time: '16:00' },
  { weekday: 1, available: true, start_time: '08:00', end_time: '16:00' },
  { weekday: 2, available: true, start_time: '08:00', end_time: '16:00' },
  { weekday: 3, available: true, start_time: '08:00', end_time: '16:00' },
  { weekday: 4, available: true, start_time: '08:00', end_time: '16:00' }
];

const instructor = {
  emp_id: '100',
  full_name: 'הילה רוזן',
  active: 'yes',
  address: 'צה״ל 68, גן יבנה'
};

const profile = {
  gender: 'female',
  instruction_languages: ['he'],
  friday_allowed: false
};

function course(id, extra = {}) {
  const meetings = extra.meetings || [{ date: '2026-09-06', start_time: '10:00', end_time: '11:30' }];
  return {
    row_id: id,
    activity_name: `קורס ${id}`,
    activity_no: id,
    activity_type: 'קורס',
    activity_season: 'school_2027',
    status: 'פתוח',
    school: `בית ספר ${id}`,
    school_id: `school-${id}`,
    school_address: 'רחוב בר אילן 1, נתניה',
    authority: 'נתניה',
    district: 'מרכז',
    instruction_language: 'he',
    required_instructor_gender: 'female',
    start_date: meetings[0].date,
    start_time: meetings[0].start_time,
    end_time: meetings[0].end_time,
    meetings,
    ...extra
  };
}

function travelFor(courseId, empId = '100', home = { distance_km: 8, duration_minutes: 15 }) {
  return {
    [courseId]: {
      [empId]: { home, homeReturn: home, transitions: {} }
    }
  };
}

function mergeTravel(...parts) {
  const merged = {};
  for (const part of parts) {
    for (const [courseId, byEmp] of Object.entries(part || {})) {
      merged[courseId] = { ...(merged[courseId] || {}), ...byEmp };
    }
  }
  return merged;
}

function simulationInput({
  activities,
  travel,
  periodKey = 'first',
  district = 'מרכז',
  instructors = [instructor],
  profiles
} = {}) {
  return {
    activities,
    instructors,
    profiles: profiles || Object.fromEntries(instructors.map((row) => [row.emp_id, profile])),
    rules: Object.fromEntries(instructors.map((row) => [row.emp_id, weekdayRules])),
    exceptions: {},
    travel,
    routeMatrix: {},
    periodKey,
    district,
    referenceDate: '2026-09-01'
  };
}

function reliableCandidate(name = 'הילה רוזן', empId = '100', score = 80) {
  return {
    instructor: { emp_id: empId, full_name: name },
    score,
    eligible: true,
    travel: { home: { distance_km: 8, duration_minutes: 12 }, transitions: {} },
    checks: {
      language: { passed: true },
      gender: { passed: true },
      availability: { passed: true }
    }
  };
}

function rowFromStatus(id, status, extra = {}) {
  const candidate = extra.candidate === null
    ? null
    : (extra.candidate || reliableCandidate());
  const courseRow = course(id, extra.courseExtra || {});
  const engineResult = {
    course: courseRow,
    status: status === DISTRICT_SIMULATION_STATUSES.ready
      ? 'הצעה מוכנה'
      : status === DISTRICT_SIMULATION_STATUSES.review
        ? 'נדרש טיפול'
        : status === DISTRICT_SIMULATION_STATUSES.recruit
          ? 'נדרש גיוס'
          : 'חסר מידע',
    recommended: status === DISTRICT_SIMULATION_STATUSES.ready ? candidate : null,
    bestAvailable: status === DISTRICT_SIMULATION_STATUSES.review ? candidate : null,
    checked: candidate ? [candidate] : [],
    treatmentReason: extra.treatmentReason || '',
    missing: extra.missing || []
  };
  return buildDistrictSimulationRows([engineResult])[0];
}

function mixedSimulationRows() {
  return [
    rowFromStatus('ready-1', DISTRICT_SIMULATION_STATUSES.ready),
    rowFromStatus('review-1', DISTRICT_SIMULATION_STATUSES.review, {
      candidate: reliableCandidate('בדיקה לוי', '101', 45),
      treatmentReason: 'ציון נמוך'
    }),
    rowFromStatus('recruit-1', DISTRICT_SIMULATION_STATUSES.recruit, {
      candidate: null,
      treatmentReason: 'אין מדריך'
    }),
    rowFromStatus('missing-1', DISTRICT_SIMULATION_STATUSES.missing, {
      candidate: null,
      missing: ['כתובת בית הספר']
    }),
    rowFromStatus('no-instructor', DISTRICT_SIMULATION_STATUSES.ready, {
      candidate: {
        instructor: { emp_id: '', full_name: '' },
        score: 70,
        eligible: true,
        travel: { home: { distance_km: 8, duration_minutes: 12 }, transitions: {} },
        checks: { language: { passed: true }, gender: { passed: true }, availability: { passed: true } }
      }
    })
  ];
}

test('1. ready rows are selected by default', () => {
  const rows = mixedSimulationRows();
  const selected = defaultSelectedSimulationCourseIds(rows);
  assert.deepEqual(selected, ['ready-1']);
  assert.equal(isDistrictSimulationRowSelectable(rows[0]), true);
});

test('2. review rows are not selected by default but can be selected', () => {
  const rows = mixedSimulationRows();
  const selected = defaultSelectedSimulationCourseIds(rows);
  assert.ok(!selected.includes('review-1'));
  assert.equal(isDistrictSimulationRowSelectable(rows[1]), true);
  assert.deepEqual(
    normalizeSelectedSimulationCourseIds(rows, ['ready-1', 'review-1']),
    ['ready-1', 'review-1']
  );
});

test('3. recruitment rows cannot be selected', () => {
  const rows = mixedSimulationRows();
  assert.equal(isDistrictSimulationRowSelectable(rows[2]), false);
  assert.deepEqual(normalizeSelectedSimulationCourseIds(rows, ['recruit-1']), []);
});

test('4. missing-data rows cannot be selected', () => {
  const rows = mixedSimulationRows();
  assert.equal(isDistrictSimulationRowSelectable(rows[3]), false);
  assert.deepEqual(normalizeSelectedSimulationCourseIds(rows, ['missing-1']), []);
});

test('5. rows without an instructor cannot be selected', () => {
  const rows = mixedSimulationRows();
  assert.equal(rows[4].proposedInstructor, '—');
  assert.equal(isDistrictSimulationRowSelectable(rows[4]), false);
});

test('6. save button is disabled when nothing is selected', () => {
  const rows = mixedSimulationRows();
  const html = districtSimulationPanelHtml({
    rows,
    counts: {
      [DISTRICT_SIMULATION_STATUSES.ready]: 2,
      [DISTRICT_SIMULATION_STATUSES.review]: 1,
      [DISTRICT_SIMULATION_STATUSES.recruit]: 1,
      [DISTRICT_SIMULATION_STATUSES.missing]: 1
    },
    selectedCourseIds: [],
    district: 'מרכז'
  });
  assert.match(html, /data-save-simulation-drafts[^>]*disabled/);
  assert.match(html, new RegExp(districtSimulationSaveButtonLabel(0)));
  const withSelection = districtSimulationPanelHtml({
    rows,
    counts: {},
    selectedCourseIds: ['ready-1'],
    district: 'מרכז'
  });
  assert.match(withSelection, /שמור 1 הצעות כטיוטות/);
  assert.doesNotMatch(withSelection, /data-save-simulation-drafts[^>]*disabled/);
});

test('7. simulation calculation remains read-only', async () => {
  const source = await readFile(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8');
  const start = source.indexOf('const runDistrictSimulation = async');
  const end = source.indexOf('root.querySelector(\'[data-run-district-simulation]\')');
  assert.ok(start > 0 && end > start);
  const handler = source.slice(start, end);
  assert.match(handler, /Read-only: never save drafts/);
  assert.doesNotMatch(handler, /supabase\.rpc/);
  assert.doesNotMatch(handler, /save_course_assignment_draft/);
  assert.doesNotMatch(handler, /assign_activity_instructor/);

  const moduleSource = await readFile(new URL('../frontend/src/screens/course-scheduling-district-simulation.js', import.meta.url), 'utf8');
  assert.doesNotMatch(moduleSource, /supabase/);
  assert.doesNotMatch(moduleSource, /\.rpc\(/);
  assert.match(moduleSource, /Read-only district simulation/);
});

test('8. saving uses the existing draft-save path and payload', () => {
  const selected = reliableCandidate('הילה רוזן', '100', 82);
  selected.dateAdjustment = {
    meetings: [{ date: '2026-09-13', original_date: '2026-09-06', moved: true }]
  };
  const top = reliableCandidate('הילה רוזן', '100', 90);
  const withDates = buildCourseAssignmentDraftRpc({
    activityId: 'course-a',
    selected,
    topCandidate: top
  });
  assert.equal(withDates.rpc, 'save_course_assignment_draft_with_dates');
  assert.deepEqual(withDates.payload, {
    p_activity_id: 'course-a',
    p_emp_id: 100,
    p_instructor_name: 'הילה רוזן',
    p_top_emp_id: 100,
    p_selected_score: 82,
    p_top_score: 90,
    p_proposed_meetings: [{ date: '2026-09-13' }]
  });

  const plain = buildCourseAssignmentDraftRpc({
    activityId: 'course-b',
    selected: reliableCandidate('הילה רוזן', '100', 70),
    topCandidate: reliableCandidate('הילה רוזן', '100', 70)
  });
  assert.equal(plain.rpc, 'save_course_assignment_draft');
  assert.equal(plain.payload.p_activity_id, 'course-b');
  assert.ok(!Object.prototype.hasOwnProperty.call(plain.payload, 'p_proposed_meetings'));
});

test('9. approved assignments are never overwritten', () => {
  const row = rowFromStatus('approved-course', DISTRICT_SIMULATION_STATUSES.ready);
  const reason = districtSimulationDraftSaveBlockReason({
    row,
    course: course('approved-course', { emp_id: '999', instructor_name: 'מאושר' }),
    instructors: [instructor],
    candidateHardBlockReason
  });
  assert.equal(reason, 'הקורס כבר שובץ');
  assert.equal(isDistrictSimulationRowSelectable(row, course('approved-course', { emp_id: '999' })), false);
});

test('10. existing drafts are never overwritten', () => {
  const row = rowFromStatus('draft-course', DISTRICT_SIMULATION_STATUSES.ready);
  const reason = districtSimulationDraftSaveBlockReason({
    row,
    course: course('draft-course', { draft_emp_id: '300', draft_instructor_name: 'טיוטה' }),
    instructors: [instructor],
    candidateHardBlockReason
  });
  assert.equal(reason, 'הקורס כבר נשמר כטיוטה');
  assert.equal(
    isDistrictSimulationRowSelectable(row, course('draft-course', { draft_emp_id: '300' })),
    false
  );
});

test('11-13. successful saves are removed, failures remain, and successes are kept', () => {
  const rows = [
    rowFromStatus('ok-1', DISTRICT_SIMULATION_STATUSES.ready),
    rowFromStatus('fail-1', DISTRICT_SIMULATION_STATUSES.ready, {
      candidate: reliableCandidate('רמון', '102', 75)
    }),
    rowFromStatus('ok-2', DISTRICT_SIMULATION_STATUSES.review, {
      candidate: reliableCandidate('בדיקה', '101', 50),
      treatmentReason: 'בדיקה'
    })
  ];
  const results = rows.map((row) => row.engineResult);
  const applied = applyDistrictSimulationSaveOutcome({
    rows,
    results,
    selectedIds: ['ok-1', 'fail-1', 'ok-2'],
    outcomes: [
      { ok: true, courseId: 'ok-1', courseLabel: 'בית ספר ok-1' },
      { ok: false, courseId: 'fail-1', courseLabel: 'רמון', reason: 'המדריך אינו זמין עוד' },
      { ok: true, courseId: 'ok-2', courseLabel: 'בית ספר ok-2' }
    ]
  });
  assert.deepEqual(applied.rows.map((row) => row.courseId), ['fail-1']);
  assert.equal(applied.rows[0].saveFailureReason, 'המדריך אינו זמין עוד');
  assert.equal(applied.savedCount, 2);
  assert.equal(applied.failedCount, 1);
  assert.match(applied.message, /2 נשמרו, 1 לא נשמרו/);
  assert.deepEqual(applied.failures, [{
    courseId: 'fail-1',
    courseLabel: 'רמון',
    reason: 'המדריך אינו זמין עוד'
  }]);
  assert.equal(applied.results.length, 1);
  assert.equal(applied.counts[DISTRICT_SIMULATION_STATUSES.ready], 1);
});

test('14. saved drafts block the next scheduling calculation', () => {
  const open = course('open-next');
  const justSaved = course('saved-as-draft', {
    draft_emp_id: '100',
    draft_instructor_name: 'הילה רוזן'
  });
  const simulation = runDistrictSchedulingSimulation(simulationInput({
    activities: [open, justSaved],
    travel: mergeTravel(travelFor('open-next'), travelFor('saved-as-draft'))
  }));
  assert.deepEqual(simulation.rows.map((row) => row.courseId), ['open-next']);
  assert.ok(!simulation.rows.some((row) => row.courseId === 'saved-as-draft'));
});

test('15. no final-assignment RPC is called from district draft save', async () => {
  const source = await readFile(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8');
  const start = source.indexOf('const saveSelectedSimulationDrafts = async');
  const end = source.indexOf('root.querySelector(\'[data-confirm-simulation-draft-save]\')');
  assert.ok(start > 0 && end > start, 'expected district draft-save handler');
  const handler = source.slice(start, end);
  assert.match(handler, /buildCourseAssignmentDraftRpc/);
  assert.match(handler, /supabase\.rpc\(rpc, payload\)/);
  assert.doesNotMatch(handler, /assign_activity_instructor/);
  assert.doesNotMatch(handler, /assign_activity_instructor_with_dates/);
  assert.match(source, /save_course_assignment_draft_with_dates' : 'save_course_assignment_draft'/);
});

test('16. no Supabase schema or RPC change is introduced', async () => {
  const moduleSource = await readFile(new URL('../frontend/src/screens/course-scheduling-district-simulation.js', import.meta.url), 'utf8');
  const screenSource = await readFile(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8');
  assert.doesNotMatch(moduleSource, /create table|alter table|create or replace function/i);
  assert.doesNotMatch(screenSource, /save_district_|bulk_save_course_assignment_draft|district_assignment_draft/);
  const { readdirSync } = await import('node:fs');
  const migrations = readdirSync(new URL('../supabase/migrations', import.meta.url)).filter((name) => name.endsWith('.sql'));
  // This feature PR must not add migration files; assert current tree has no district-draft migration name.
  assert.ok(!migrations.some((name) => /district.*draft|draft.*district|bulk.*draft/i.test(name)));
});

test('17. existing individual-course draft saving remains unchanged', async () => {
  const source = await readFile(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8');
  const start = source.lastIndexOf("detailRoot.querySelector('[data-save-draft]')");
  const end = source.indexOf("detailRoot.querySelector('[data-confirm-draft]')");
  assert.ok(start > 0 && end > start);
  const handler = source.slice(start, end);
  assert.match(handler, /buildCourseAssignmentDraftRpc/);
  assert.match(handler, /supabase\.rpc\(rpc, payload\)/);
  assert.doesNotMatch(handler, /assign_activity_instructor/);
  assert.match(handler, /actionDisabledReason/);
});

test('18. existing district simulation filtering and route classifications remain unchanged', () => {
  const ready = course('keep-ready');
  const recruit = course('keep-recruit', { required_instructor_gender: 'male' });
  const missing = course('keep-missing', { school_address: '', instruction_language: '' });
  const simulation = runDistrictSchedulingSimulation(simulationInput({
    activities: [ready, recruit, missing],
    travel: mergeTravel(travelFor('keep-ready'), travelFor('keep-recruit'), travelFor('keep-missing'))
  }));
  const byId = Object.fromEntries(simulation.rows.map((row) => [row.courseId, row.status]));
  assert.equal(byId['keep-ready'], DISTRICT_SIMULATION_STATUSES.ready);
  assert.equal(byId['keep-recruit'], DISTRICT_SIMULATION_STATUSES.recruit);
  assert.equal(byId['keep-missing'], DISTRICT_SIMULATION_STATUSES.missing);
  assert.equal(isDistrictSimulationRowSelectable(simulation.rows.find((row) => row.courseId === 'keep-ready')), true);
  assert.equal(isDistrictSimulationRowSelectable(simulation.rows.find((row) => row.courseId === 'keep-recruit')), false);
  assert.equal(isDistrictSimulationRowSelectable(simulation.rows.find((row) => row.courseId === 'keep-missing')), false);
});

test('confirm dialog copy and save-result message match the product wording', () => {
  assert.equal(
    districtSimulationConfirmMessage(12),
    'עומדים לשמור 12 הצעות כטיוטות. השיבוצים עדיין לא יאושרו סופית.'
  );
  assert.equal(
    districtSimulationSaveResultMessage({ saved: 10, failed: 2 }),
    'שמירת הטיוטות הסתיימה: 10 נשמרו, 2 לא נשמרו.'
  );
  const panel = districtSimulationPanelHtml({
    rows: [rowFromStatus('ready-1', DISTRICT_SIMULATION_STATUSES.ready)],
    counts: { [DISTRICT_SIMULATION_STATUSES.ready]: 1 },
    selectedCourseIds: ['ready-1'],
    confirmSave: true,
    district: 'מרכז'
  });
  assert.match(panel, /data-district-simulation-confirm/);
  assert.match(panel, /data-cancel-simulation-draft-save/);
  assert.match(panel, /data-confirm-simulation-draft-save/);
  assert.match(panel, /שמור כטיוטות/);
  assert.match(panel, /ביטול/);
});

test('bind: only selected valid proposals are saved through the existing draft RPC', async () => {
  const openReady = course('save-ready');
  const openReview = course('save-review');
  const simulation = runDistrictSchedulingSimulation(simulationInput({
    activities: [openReady, openReview],
    travel: mergeTravel(travelFor('save-ready'), travelFor('save-review'))
  }));
  assert.ok(simulation.rows.length >= 1);
  const readyRow = simulation.rows.find((row) => row.status === DISTRICT_SIMULATION_STATUSES.ready)
    || simulation.rows[0];
  const state = {
    user: { role: 'admin' },
    courseSchedulingTab: 'courses',
    courseSchedulingDistrict: 'מרכז',
    courseSchedulingPeriodKey: 'first',
    courseSchedulingSimulationView: true,
    courseSchedulingSimulationRows: simulation.rows,
    courseSchedulingSimulationCounts: simulation.counts,
    courseSchedulingSimulationResults: simulation.results,
    courseSchedulingSimulationSelectedIds: [readyRow.courseId],
    courseSchedulingSimulationConfirmSave: true,
    courseSchedulingResults: [],
    courseSchedulingSelectedId: ''
  };
  const html = courseSchedulingScreen.render({
    activities: [openReady, openReview],
    instructors: [instructor],
    scheduling: { profiles: [{ emp_id: '100', ...profile }], rules: weekdayRules.map((rule) => ({ ...rule, emp_id: '100' })), exceptions: [] },
    meetingState: { loaded: true, approvedDates: new Map(), cancelledDates: new Map(), error: '' }
  }, { state });
  assert.match(html, /data-save-simulation-drafts/);
  assert.match(html, /data-confirm-simulation-draft-save/);

  const rpcCalls = [];
  const originalRpc = supabase.rpc;
  supabase.rpc = async (name, payload) => {
    rpcCalls.push({ name, payload });
    return { data: null, error: null };
  };

  const dom = new JSDOM(`<!doctype html><html><body><div id="root">${html}</div></body></html>`, { url: 'https://example.test' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  const root = document.getElementById('root');
  let renders = 0;
  courseSchedulingScreen.bind({
    root,
    data: {
      activities: [openReady, openReview],
      instructors: [instructor],
      scheduling: { profiles: [{ emp_id: '100', ...profile }], rules: weekdayRules.map((rule) => ({ ...rule, emp_id: '100' })), exceptions: [] },
      meetingState: { loaded: true, approvedDates: new Map(), cancelledDates: new Map(), error: '' },
      schoolLocations: [],
      schoolCalendar: []
    },
    state,
    clearScreenDataCache: () => {},
    rerender: () => { renders += 1; }
  });

  root.querySelector('[data-confirm-simulation-draft-save]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.ok(rpcCalls.length >= 1);
  for (const call of rpcCalls) {
    assert.ok(
      call.name === 'save_course_assignment_draft' || call.name === 'save_course_assignment_draft_with_dates',
      `unexpected rpc ${call.name}`
    );
    assert.equal(call.payload.p_activity_id, readyRow.courseId);
    assert.equal(Number(call.payload.p_emp_id), 100);
  }
  assert.ok(!rpcCalls.some((call) => String(call.name).includes('assign_activity_instructor')));
  assert.ok(renders >= 1);
  assert.ok(state.courseSchedulingSimulationSaveResult?.saved >= 1);
  assert.ok(!state.courseSchedulingSimulationRows.some((row) => row.courseId === readyRow.courseId));

  supabase.rpc = originalRpc;
  delete globalThis.window;
  delete globalThis.document;
});

test('checkbox defaults: ready checked, review unchecked, recruit/missing disabled', () => {
  const rows = mixedSimulationRows();
  const html = districtSimulationPanelHtml({
    rows,
    counts: {},
    selectedCourseIds: defaultSelectedSimulationCourseIds(rows),
    district: 'מרכז'
  });
  assert.match(html, /data-simulation-select-course="ready-1"[^>]*checked/);
  assert.match(html, /data-simulation-select-course="review-1"/);
  assert.doesNotMatch(html, /data-simulation-select-course="review-1"[^>]*checked/);
  assert.doesNotMatch(html, /data-simulation-select-course="recruit-1"/);
  assert.doesNotMatch(html, /data-simulation-select-course="missing-1"/);
  assert.doesNotMatch(html, /data-simulation-select-course="no-instructor"/);
});
