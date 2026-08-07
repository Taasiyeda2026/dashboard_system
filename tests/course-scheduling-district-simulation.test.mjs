import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import {
  DISTRICT_SIMULATION_LABEL,
  DISTRICT_SIMULATION_ROUTE_MISSING_MESSAGE,
  DISTRICT_SIMULATION_STATUSES,
  buildDistrictSimulationRows,
  filterDistrictSimulationRows,
  mapEngineStatusToSimulation,
  resolveDistrictSimulationStatus,
  runDistrictSchedulingSimulation,
  summarizeDistrictSimulation,
  courseScheduleSlot,
  districtSimulationPanelHtml
} from '../frontend/src/screens/course-scheduling-district-simulation.js';
import { courseSchedulingScreen } from '../frontend/src/screens/course-scheduling.js';
import { calculateCourseSchedule } from '../frontend/src/screens/course-scheduling-engine.js';

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
  profiles,
  authority,
  travelUnavailableReason = '',
  routeMatrix = {}
} = {}) {
  return {
    activities,
    instructors,
    profiles: profiles || Object.fromEntries(instructors.map((row) => [row.emp_id, profile])),
    rules: Object.fromEntries(instructors.map((row) => [row.emp_id, weekdayRules])),
    exceptions: {},
    travel,
    routeMatrix,
    periodKey,
    district,
    ...(authority !== undefined ? { authority } : {}),
    ...(travelUnavailableReason ? { travelUnavailableReason } : {}),
    referenceDate: '2026-09-01'
  };
}

test('1. district filtering keeps only selected district courses', () => {
  const north = course('north', { district: 'מחוז צפון', authority: 'חיפה', school: 'ספר צפון' });
  const center = course('center', { district: 'ירושלים', authority: 'ירושלים', school: 'ספר מרכז' });
  const south = course('south', { district: 'דרום', authority: 'באר שבע', school: 'ספר דרום' });
  const travel = mergeTravel(travelFor('north'), travelFor('center'), travelFor('south'));
  const simulation = runDistrictSchedulingSimulation(simulationInput({
    activities: [north, center, south],
    travel,
    district: 'מרכז'
  }));
  assert.equal(simulation.ok, true);
  assert.deepEqual(simulation.rows.map((row) => row.courseId), ['center']);
  assert.equal(simulation.rows[0].authority, 'ירושלים');
});

test('2. half-year filtering keeps only selected half-year meetings', () => {
  const firstOnly = course('a', {
    meetings: [{ date: '2026-09-06', start_time: '10:00', end_time: '11:00' }]
  });
  const secondOnly = course('b', {
    meetings: [{ date: '2027-02-07', start_time: '10:00', end_time: '11:00' }]
  });
  const travel = mergeTravel(travelFor('a'), travelFor('b'));
  const first = runDistrictSchedulingSimulation(simulationInput({
    activities: [firstOnly, secondOnly],
    travel,
    periodKey: 'first'
  }));
  const second = runDistrictSchedulingSimulation(simulationInput({
    activities: [firstOnly, secondOnly],
    travel,
    periodKey: 'second'
  }));
  assert.deepEqual(first.rows.map((row) => row.courseId), ['a']);
  assert.deepEqual(second.rows.map((row) => row.courseId), ['b']);
});

test('3. approved assignments are excluded from simulation targets', () => {
  const open = course('open');
  const approved = course('approved', {
    emp_id: '200',
    instructor_name: 'מדריך מאושר',
    instructor_assignment_locked: true
  });
  const simulation = runDistrictSchedulingSimulation(simulationInput({
    activities: [open, approved],
    travel: travelFor('open')
  }));
  assert.deepEqual(simulation.rows.map((row) => row.courseId), ['open']);
  assert.ok(!simulation.rows.some((row) => row.courseId === 'approved'));
});

test('4. saved drafts are excluded from simulation targets', () => {
  const open = course('open');
  const draft = course('draft', {
    draft_emp_id: '300',
    draft_instructor_name: 'טיוטה שמורה'
  });
  const simulation = runDistrictSchedulingSimulation(simulationInput({
    activities: [open, draft],
    travel: travelFor('open')
  }));
  assert.deepEqual(simulation.rows.map((row) => row.courseId), ['open']);
  assert.ok(!simulation.rows.some((row) => row.courseId === 'draft'));
});

test('5. every result receives exactly one simulation status', () => {
  const readyCourse = course('ready');
  const missingCourse = course('missing', { school_address: '', instruction_language: '' });
  const recruitCourse = course('recruit', {
    required_instructor_gender: 'male',
    school: 'בית ספר גיוס',
    authority: 'רשות גיוס'
  });
  const travel = mergeTravel(travelFor('ready'), travelFor('missing'), travelFor('recruit'));
  const simulation = runDistrictSchedulingSimulation(simulationInput({
    activities: [readyCourse, missingCourse, recruitCourse],
    travel
  }));
  const allowed = new Set(Object.values(DISTRICT_SIMULATION_STATUSES));
  assert.equal(simulation.rows.length, 3);
  for (const row of simulation.rows) {
    assert.ok(allowed.has(row.status), `unexpected status ${row.status}`);
    assert.equal(typeof row.status, 'string');
    assert.ok(row.status.length > 0);
  }
  const byId = Object.fromEntries(simulation.rows.map((row) => [row.courseId, row.status]));
  assert.equal(byId.ready, DISTRICT_SIMULATION_STATUSES.ready);
  assert.equal(byId.missing, DISTRICT_SIMULATION_STATUSES.missing);
  assert.equal(byId.recruit, DISTRICT_SIMULATION_STATUSES.recruit);
  assert.deepEqual(
    Object.values(DISTRICT_SIMULATION_STATUSES).sort(),
    ['הצעה מוכנה', 'חסרים נתונים', 'נדרש גיוס', 'נדרשת בדיקה'].sort()
  );
  assert.equal(mapEngineStatusToSimulation('חסר מידע'), DISTRICT_SIMULATION_STATUSES.missing);
  assert.equal(mapEngineStatusToSimulation('נדרש טיפול'), DISTRICT_SIMULATION_STATUSES.review);
});

test('6. recruitment rows include authority, school, weekday and hours', () => {
  const recruitCourse = course('recruit', {
    required_instructor_gender: 'male',
    authority: 'רשות גיוס',
    school: 'בית ספר לגיוס',
    meetings: [{ date: '2026-09-06', start_time: '09:15', end_time: '10:45' }]
  });
  const simulation = runDistrictSchedulingSimulation(simulationInput({
    activities: [recruitCourse],
    travel: travelFor('recruit')
  }));
  assert.equal(simulation.rows.length, 1);
  const row = simulation.rows[0];
  assert.equal(row.status, DISTRICT_SIMULATION_STATUSES.recruit);
  assert.equal(row.authority, 'רשות גיוס');
  assert.equal(row.school, 'בית ספר לגיוס');
  assert.equal(row.weekday, 'יום ראשון');
  assert.equal(row.startTime, '09:15');
  assert.equal(row.endTime, '10:45');
  const slot = courseScheduleSlot(recruitCourse, 'first');
  assert.equal(slot.weekday, 'יום ראשון');
  assert.equal(slot.startTime, '09:15');
  assert.equal(slot.endTime, '10:45');
});

test('7. missing-data rows are not counted as recruitment', () => {
  const missingCourse = course('missing', {
    school_address: '',
    instruction_language: ''
  });
  const simulation = runDistrictSchedulingSimulation(simulationInput({
    activities: [missingCourse],
    travel: travelFor('missing')
  }));
  assert.equal(simulation.rows.length, 1);
  assert.equal(simulation.rows[0].status, DISTRICT_SIMULATION_STATUSES.missing);
  assert.equal(simulation.counts[DISTRICT_SIMULATION_STATUSES.missing], 1);
  assert.equal(simulation.counts[DISTRICT_SIMULATION_STATUSES.recruit], 0);
  assert.notEqual(simulation.rows[0].status, DISTRICT_SIMULATION_STATUSES.recruit);
});

test('8. district simulation path does not call write API or assignment RPCs', async () => {
  const source = await readFile(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8');
  const start = source.indexOf('const runDistrictSimulation = async');
  const end = source.indexOf('root.querySelector(\'[data-run-district-simulation]\')');
  assert.ok(start > 0 && end > start, 'expected district simulation handler');
  const handler = source.slice(start, end);
  assert.match(handler, /runDistrictSchedulingSimulation/);
  assert.doesNotMatch(handler, /supabase\.rpc/);
  assert.doesNotMatch(handler, /assign_activity_instructor/);
  assert.doesNotMatch(handler, /save_course_assignment_draft/);
  assert.doesNotMatch(handler, /cancel_course_assignment_draft/);
  assert.doesNotMatch(handler, /saveCalculationSnapshot/);
  assert.doesNotMatch(handler, /authority:\s*text\(state\.courseSchedulingAuthority/);
  assert.doesNotMatch(handler, /ניתן להמשיך לפי זמינות והתאמה בלבד/);
  assert.match(handler, /DISTRICT_SIMULATION_ROUTE_MISSING_MESSAGE/);

  const moduleSource = await readFile(new URL('../frontend/src/screens/course-scheduling-district-simulation.js', import.meta.url), 'utf8');
  assert.doesNotMatch(moduleSource, /supabase/);
  assert.doesNotMatch(moduleSource, /\.rpc\(/);
  assert.match(moduleSource, /Read-only district simulation/);
  assert.match(moduleSource, /authority:\s*''/);
});

test('9. clicking a simulation row opens the existing course detail', () => {
  const open = course('open-detail');
  const simulation = runDistrictSchedulingSimulation(simulationInput({
    activities: [open],
    travel: travelFor('open-detail')
  }));
  const state = {
    user: { role: 'admin' },
    courseSchedulingTab: 'courses',
    courseSchedulingDistrict: 'מרכז',
    courseSchedulingPeriodKey: 'first',
    courseSchedulingSimulationView: true,
    courseSchedulingSimulationRows: simulation.rows,
    courseSchedulingSimulationCounts: simulation.counts,
    courseSchedulingSimulationResults: simulation.results,
    courseSchedulingSimulationStatusFilter: '',
    courseSchedulingResults: [],
    courseSchedulingSelectedId: ''
  };
  const html = courseSchedulingScreen.render({
    activities: [open],
    instructors: [instructor],
    scheduling: { profiles: [{ emp_id: '100', ...profile }], rules: weekdayRules.map((rule) => ({ ...rule, emp_id: '100' })), exceptions: [] },
    meetingState: { loaded: true, approvedDates: new Map(), cancelledDates: new Map(), error: '' }
  }, { state });
  assert.match(html, /data-district-simulation-panel/);
  assert.match(html, new RegExp(DISTRICT_SIMULATION_LABEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(html, /data-simulation-course-row="open-detail"/);

  const dom = new JSDOM(`<!doctype html><html><body><div id="root">${html}</div></body></html>`, { url: 'https://example.test' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  const root = document.getElementById('root');
  let renders = 0;
  courseSchedulingScreen.bind({
    root,
    data: {
      activities: [open],
      instructors: [instructor],
      scheduling: { profiles: [{ emp_id: '100', ...profile }], rules: weekdayRules.map((rule) => ({ ...rule, emp_id: '100' })), exceptions: [] },
      meetingState: { loaded: true, approvedDates: new Map(), cancelledDates: new Map(), error: '' },
      schoolLocations: [],
      schoolCalendar: []
    },
    state,
    rerender: () => { renders += 1; }
  });
  root.querySelector('[data-simulation-course-row="open-detail"]').click();
  assert.equal(state.courseSchedulingSelectedId, 'open-detail');
  assert.equal(state.courseSchedulingSimulationView, false);
  assert.equal(state.courseSchedulingTab, 'courses');
  assert.ok((state.courseSchedulingResults || []).some((result) => result.course?.row_id === 'open-detail'));
  assert.ok(renders >= 1);
  delete globalThis.window;
  delete globalThis.document;
});

test('10. existing single-course scheduling controls remain unchanged', () => {
  const open = course('single');
  const html = courseSchedulingScreen.render({
    activities: [open],
    instructors: [instructor],
    scheduling: {},
    meetingState: { loaded: true, approvedDates: new Map(), cancelledDates: new Map(), error: '' }
  }, {
    state: {
      user: { role: 'admin' },
      courseSchedulingTab: 'courses',
      courseSchedulingDistrict: 'מרכז',
      courseSchedulingSelectedId: 'single',
      courseSchedulingSimulationView: false
    }
  });
  assert.match(html, /data-find-instructors/);
  assert.match(html, /מצא מדריכים מתאימים|בדיקה מחדש של מדריכים/);
  assert.match(html, /data-run-district-simulation/);
  assert.match(html, /הפעל תכנון מחוזי/);
  assert.doesNotMatch(html, /data-district-simulation-panel/);
  assert.match(html, /data-course-detail/);
});

test('simulation summary cards and status filter cover all four statuses', () => {
  const reliableTravel = { home: { distance_km: 8, duration_minutes: 12 }, transitions: {} };
  const rows = buildDistrictSimulationRows([
    {
      course: course('r1'),
      status: 'הצעה מוכנה',
      recommended: { instructor: { full_name: 'א' }, score: 80, travel: reliableTravel },
      checked: [{ instructor: { full_name: 'א' }, travel: reliableTravel }]
    },
    {
      course: course('r2'),
      status: 'נדרש טיפול',
      bestAvailable: { instructor: { full_name: 'ב' }, score: 45, travel: reliableTravel },
      treatmentReason: 'ציון נמוך',
      checked: [{ instructor: { full_name: 'ב' }, travel: reliableTravel }]
    },
    {
      course: course('r3'),
      status: 'נדרש גיוס',
      treatmentReason: 'אין מדריך',
      checked: [{ travel: { home: { distance_km: 55, duration_minutes: 70 } }, failures: ['מרחק הנסיעה לבית הספר הוא 55 ק״מ ועולה על המגבלה של 40 ק״מ'] }]
    },
    { course: course('r4'), status: 'חסר מידע', missing: ['כתובת בית הספר'] }
  ]);
  const counts = summarizeDistrictSimulation(rows);
  assert.deepEqual(counts, {
    [DISTRICT_SIMULATION_STATUSES.ready]: 1,
    [DISTRICT_SIMULATION_STATUSES.review]: 1,
    [DISTRICT_SIMULATION_STATUSES.recruit]: 1,
    [DISTRICT_SIMULATION_STATUSES.missing]: 1
  });
  assert.equal(filterDistrictSimulationRows(rows, DISTRICT_SIMULATION_STATUSES.recruit).length, 1);
  const panel = districtSimulationPanelHtml({
    rows,
    counts,
    statusFilter: DISTRICT_SIMULATION_STATUSES.recruit,
    district: 'מרכז'
  });
  assert.match(panel, /סימולציה בלבד - השיבוצים טרם נשמרו/);
  assert.match(panel, /data-simulation-status-filter="נדרש גיוס"/);
  assert.match(panel, /data-simulation-course-row="r3"/);
  assert.doesNotMatch(panel, /data-simulation-course-row="r1"/);
});

test('review fix 1: district simulation ignores ordinary authority filter and returns both authorities', () => {
  const authorityA = course('a1', { authority: 'רשות א', district: 'מרכז', school: 'ספר א' });
  const authorityB = course('b1', { authority: 'רשות ב', district: 'מרכז', school: 'ספר ב' });
  const otherDistrict = course('c1', { authority: 'רשות ג', district: 'צפון', school: 'ספר ג' });
  const travel = mergeTravel(travelFor('a1'), travelFor('b1'), travelFor('c1'));

  // Even if the normal screen has an authority selected, district simulation must ignore it.
  const simulation = runDistrictSchedulingSimulation(simulationInput({
    activities: [authorityA, authorityB, otherDistrict],
    travel,
    district: 'מרכז',
    authority: 'רשות א'
  }));

  assert.equal(simulation.ok, true);
  assert.deepEqual(simulation.rows.map((row) => row.courseId).sort(), ['a1', 'b1']);
  assert.deepEqual(simulation.rows.map((row) => row.authority).sort(), ['רשות א', 'רשות ב']);

  // Engine direct call with authority would wrongly narrow — simulation wrapper clears it.
  const authorityNarrowed = calculateCourseSchedule(simulationInput({
    activities: [authorityA, authorityB, otherDistrict],
    travel,
    district: 'מרכז',
    authority: 'רשות א'
  }));
  assert.deepEqual(authorityNarrowed.map((result) => result.course.row_id), ['a1']);
});

test('review fix 1: changing authority filter resets open district simulation', () => {
  const open = course('auth-reset');
  const simulation = runDistrictSchedulingSimulation(simulationInput({
    activities: [open],
    travel: travelFor('auth-reset')
  }));
  const state = {
    user: { role: 'admin' },
    courseSchedulingTab: 'courses',
    courseSchedulingDistrict: 'מרכז',
    courseSchedulingAuthority: 'נתניה',
    courseSchedulingSimulationView: true,
    courseSchedulingSimulationRows: simulation.rows,
    courseSchedulingSimulationCounts: simulation.counts,
    courseSchedulingSimulationResults: simulation.results,
    courseSchedulingSelectedId: ''
  };
  const html = courseSchedulingScreen.render({
    activities: [open],
    instructors: [instructor],
    scheduling: {},
    meetingState: { loaded: true, approvedDates: new Map(), cancelledDates: new Map(), error: '' }
  }, { state });
  const dom = new JSDOM(`<!doctype html><html><body><div id="root">${html}</div></body></html>`, { url: 'https://example.test' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  const root = document.getElementById('root');
  courseSchedulingScreen.bind({
    root,
    data: {
      activities: [open],
      instructors: [instructor],
      scheduling: {},
      meetingState: { loaded: true, approvedDates: new Map(), cancelledDates: new Map(), error: '' },
      schoolLocations: [],
      schoolCalendar: []
    },
    state,
    rerender: () => {}
  });
  const select = root.querySelector('[data-authority-filter]');
  select.value = '';
  select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(state.courseSchedulingSimulationView, false);
  assert.deepEqual(state.courseSchedulingSimulationRows, []);
  delete globalThis.window;
  delete globalThis.document;
});

test('review fix 2: unknown routes become חסרים נתונים; known >40km stays נדרש גיוס; known eligible stays proposal/review', () => {
  const unknownCourse = course('unknown-route');
  const farCourse = course('far-route', { school: 'בית ספר רחוק', authority: 'רשות רחוקה' });
  const nearCourse = course('near-route');

  const unknown = runDistrictSchedulingSimulation(simulationInput({
    activities: [unknownCourse],
    travel: { 'unknown-route': { 100: { home: null, transitions: {} } } },
    travelUnavailableReason: 'google_key_not_configured'
  }));
  assert.equal(unknown.rows.length, 1);
  assert.equal(unknown.rows[0].status, DISTRICT_SIMULATION_STATUSES.missing);
  assert.equal(unknown.counts[DISTRICT_SIMULATION_STATUSES.recruit], 0);
  assert.match(unknown.rows[0].reason, /מסלול נסיעה אמין/);
  assert.equal(unknown.hasRouteMissing, true);
  assert.equal(
    resolveDistrictSimulationStatus(unknown.results[0]),
    DISTRICT_SIMULATION_STATUSES.missing
  );

  const far = runDistrictSchedulingSimulation(simulationInput({
    activities: [farCourse],
    travel: travelFor('far-route', '100', { distance_km: 55, duration_minutes: 70 })
  }));
  assert.equal(far.rows.length, 1);
  assert.equal(far.rows[0].status, DISTRICT_SIMULATION_STATUSES.recruit);
  assert.equal(far.counts[DISTRICT_SIMULATION_STATUSES.missing], 0);
  assert.match(far.rows[0].reason, /40|מרחק|גיוס|מדריך/);

  const near = runDistrictSchedulingSimulation(simulationInput({
    activities: [nearCourse],
    travel: travelFor('near-route', '100', { distance_km: 8, duration_minutes: 12 })
  }));
  assert.equal(near.rows.length, 1);
  assert.ok(
    [DISTRICT_SIMULATION_STATUSES.ready, DISTRICT_SIMULATION_STATUSES.review].includes(near.rows[0].status),
    `expected proposal/review, got ${near.rows[0].status}`
  );
  assert.equal(near.counts[DISTRICT_SIMULATION_STATUSES.recruit], 0);
  assert.equal(near.counts[DISTRICT_SIMULATION_STATUSES.missing], 0);

  assert.match(DISTRICT_SIMULATION_ROUTE_MISSING_MESSAGE, /חסרים נתונים/);
  assert.doesNotMatch(DISTRICT_SIMULATION_ROUTE_MISSING_MESSAGE, /ניתן להמשיך לפי זמינות/);
});

test('final review: gender-rejected candidates without routes stay נדרש גיוס', () => {
  const target = course('gender-only', { required_instructor_gender: 'female' });
  const maleOnly = {
    emp_id: '200',
    full_name: 'יוסי כהן',
    active: 'yes',
    address: 'כתובת מדריך'
  };
  const simulation = runDistrictSchedulingSimulation(simulationInput({
    activities: [target],
    instructors: [maleOnly],
    profiles: {
      200: { gender: 'male', instruction_languages: ['he'], friday_allowed: false }
    },
    travel: { 'gender-only': { 200: { home: null, transitions: {} } } }
  }));
  assert.equal(simulation.rows.length, 1);
  assert.equal(simulation.rows[0].status, DISTRICT_SIMULATION_STATUSES.recruit);
  assert.notEqual(simulation.rows[0].status, DISTRICT_SIMULATION_STATUSES.missing);
  assert.equal(simulation.counts[DISTRICT_SIMULATION_STATUSES.missing], 0);
  assert.equal(simulation.rows[0].proposedInstructor, '—');
});

test('final review: >40km plus otherwise-viable unknown route becomes חסרים נתונים', () => {
  const target = course('mixed-route');
  const farInstructor = {
    emp_id: '201',
    full_name: 'רחוקה לוי',
    active: 'yes',
    address: 'כתובת רחוקה'
  };
  const unknownInstructor = {
    emp_id: '202',
    full_name: 'ממתינה למסלול',
    active: 'yes',
    address: 'כתובת קרובה'
  };
  const simulation = runDistrictSchedulingSimulation(simulationInput({
    activities: [target],
    instructors: [farInstructor, unknownInstructor],
    profiles: {
      201: { gender: 'female', instruction_languages: ['he'], friday_allowed: false },
      202: { gender: 'female', instruction_languages: ['he'], friday_allowed: false }
    },
    travel: {
      'mixed-route': {
        201: { home: { distance_km: 55, duration_minutes: 70 }, transitions: {} },
        202: { home: null, transitions: {} }
      }
    }
  }));
  assert.equal(simulation.rows.length, 1);
  assert.equal(simulation.rows[0].status, DISTRICT_SIMULATION_STATUSES.missing);
  assert.equal(simulation.rows[0].proposedInstructor, '—');
  assert.equal(simulation.rows[0].score, null);
  assert.match(simulation.rows[0].reason, /מסלול נסיעה אמין/);
  assert.equal(simulation.hasRouteMissing, true);
});

test('final review: reliable selected candidate stays valid despite rejected candidates without routes', () => {
  const target = course('reliable-selected');
  const goodInstructor = {
    emp_id: '301',
    full_name: 'הילה מומלצת',
    active: 'yes',
    address: 'כתובת טובה'
  };
  const rejectedInstructor = {
    emp_id: '302',
    full_name: 'נדחה מגדר',
    active: 'yes',
    address: 'כתובת אחרת'
  };
  const simulation = runDistrictSchedulingSimulation(simulationInput({
    activities: [target],
    instructors: [goodInstructor, rejectedInstructor],
    profiles: {
      301: { gender: 'female', instruction_languages: ['he'], friday_allowed: false },
      302: { gender: 'male', instruction_languages: ['he'], friday_allowed: false }
    },
    travel: {
      'reliable-selected': {
        301: { home: { distance_km: 8, duration_minutes: 12 }, transitions: {} },
        302: { home: null, transitions: {} }
      }
    }
  }));
  assert.equal(simulation.rows.length, 1);
  assert.ok(
    [DISTRICT_SIMULATION_STATUSES.ready, DISTRICT_SIMULATION_STATUSES.review].includes(simulation.rows[0].status),
    `expected proposal/review, got ${simulation.rows[0].status}`
  );
  assert.equal(simulation.rows[0].proposedInstructor, 'הילה מומלצת');
  assert.notEqual(simulation.rows[0].status, DISTRICT_SIMULATION_STATUSES.missing);
  assert.equal(simulation.counts[DISTRICT_SIMULATION_STATUSES.missing], 0);
});
